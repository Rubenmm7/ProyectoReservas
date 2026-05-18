const db = require('../config/db');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const auditLogger = require('../utils/auditLogger');
const { sendReservationNotification, notifyStaffAboutWorkshop } = require('../utils/reservationMailer');
const { markReservationMailSent } = require('../utils/reservationMailState');
const { validateSpanishPlate, normalizePlate } = require('../utils/licensePlateValidator');
const { emitToCentreAndAdmin } = require('../utils/socketManager');
const { getIO } = require('../utils/socketManager');
const { parseMySqlDateTime, formatMySqlDateTime } = require('../utils/dateTime');
const { syncCentresFromUnifica } = require('../utils/centresSync');
const { syncReservationStatusesByTime } = require('../utils/reservationStatusSync');

const normalizeMySqlDateTime = (value) => {
  return formatMySqlDateTime(value);
};

const normalizeStatus = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, '-');

const ALLOWED_VEHICLE_STATUSES = new Set([
  'disponible',
  'no-disponible',
  'reservado',
  'en-uso',
  'pendiente-validacion',
  'formulario-entrega-pendiente',
  'en-taller',
]);

const normalizeVehicleStatusInput = (value) => normalizeStatus(value || 'disponible');

const validateVehicleStatus = (value) => {
  const status = normalizeVehicleStatusInput(value);
  if (!ALLOWED_VEHICLE_STATUSES.has(status)) {
    return { ok: false, status, error: 'Estado de vehículo no válido' };
  }
  return { ok: true, status };
};

const normalizeNullableText = (value) => {
  const text = String(value ?? '').trim();
  return text.length > 0 ? text : null;
};

const normalizeOptionalInteger = (value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const formatVehicleLabel = (vehicle = {}) => {
  const brand = String(vehicle.brand ?? '').trim();
  const model = String(vehicle.model ?? '').trim();
  const plate = String(vehicle.license_plate ?? '').trim();
  const name = [brand, model].filter(Boolean).join(' / ') || model || brand || 'Vehículo';
  return plate ? `${name} (${plate})` : name;
};

const syncVehicleStatusFromReservations = async (connection, vehicleId) => {
  const [vehicleRows] = await connection.query('SELECT status FROM vehicles WHERE id = ?', [vehicleId]);
  if (vehicleRows.length === 0) return null;

  const currentVehicleStatus = normalizeStatus(vehicleRows[0].status);

  // ===== PROTEGER ESTADOS TERMINALES =====
  // Estos estados NUNCA deben cambiar automáticamente
  if (currentVehicleStatus === 'no-disponible' ||
    currentVehicleStatus === 'pendiente-validacion' ||
    currentVehicleStatus === 'formulario-entrega-pendiente' ||
    currentVehicleStatus === 'en-taller') {
    return null;
  }

  const [reservationRows] = await connection.query(
    'SELECT id, status FROM reservations WHERE vehicle_id = ?',
    [vehicleId]
  );

  const reservations = Array.isArray(reservationRows) ? reservationRows : [];
  const statuses = reservations.map((row) => normalizeStatus(row.status));

  let desiredStatus = 'disponible';

  if (statuses.some((s) => s === 'activa')) {
    desiredStatus = 'en-uso';
  } else if (statuses.some((s) => s === 'pendiente' || s === 'aprobada')) {
    desiredStatus = 'reservado';
  } else if (statuses.some((s) => s === 'finalizada')) {
    // Comprobar si la reserva finalizada ya tiene km_entrega en validations
    const finalized = reservations.filter((r) => normalizeStatus(r.status) === 'finalizada');

    if (finalized.length > 0) {
      const placeholders = finalized.map(() => '?').join(',');
      const [valRows] = await connection.query(
        `SELECT km_entrega FROM validations WHERE reservation_id IN (${placeholders}) AND deleted_at IS NULL`,
        finalized.map((r) => r.id)
      );

      const hasKm = valRows.some((v) => v.km_entrega !== null && v.km_entrega !== undefined);
      desiredStatus = hasKm ? 'pendiente-validacion' : 'formulario-entrega-pendiente';
    } else {
      // No hay reservas finalizadas (pueden haber sido todas eliminadas)
      desiredStatus = 'disponible';
    }
  }

  if (currentVehicleStatus !== desiredStatus) {
    await connection.query('UPDATE vehicles SET status = ? WHERE id = ?', [desiredStatus, vehicleId]);
  }

  return desiredStatus;
};



const rejectReservationsForVehicle = async (connection, vehicleId, reason, actorUserId, actorRole, statusesToReject = ['activa', 'aprobada', 'pendiente']) => {
  if (!statusesToReject || statusesToReject.length === 0) return;

  // Generar placeholders dinámicamente para asegurar compatibilidad
  const placeholders = statusesToReject.map(() => '?').join(',');
  const [toReject] = await connection.query(
    `SELECT r.id, v.centre_id, r.status 
     FROM reservations r
     JOIN vehicles v ON r.vehicle_id = v.id
     WHERE r.vehicle_id = ? AND r.status IN (${placeholders})`,
    [vehicleId, ...statusesToReject]
  );

  for (const resv of toReject) {
    const previousStatus = resv.status;
    await connection.query(
      'UPDATE reservations SET status = ?, motivo_rechazo = ? WHERE id = ?',
      ['rechazada', reason, resv.id]
    );

    const [updatedResRows] = await connection.query(`
      SELECT 
        r.id, u.username, v.brand, v.license_plate, v.model, v.status AS vehicle_status,
        v.centre_id, c.nombre AS centre_name, r.start_time, r.end_time, r.status,
        r.user_id, r.vehicle_id, r.motivo_rechazo
      FROM reservations r
      JOIN users u ON r.user_id = u.id
      JOIN vehicles v ON r.vehicle_id = v.id
      LEFT JOIN centres c ON v.centre_id = c.id
      WHERE r.id = ?
    `, [resv.id]);

    if (updatedResRows.length > 0) {
      const updatedRes = updatedResRows[0];
      emitToCentreAndAdmin('updated_reservation', updatedRes.centre_id, updatedRes);

      try {
        await sendReservationNotification({
          reservation: updatedRes,
          previousStatus: previousStatus,
          currentStatus: 'rechazada',
          action: 'updated',
          actorUserId: actorUserId,
          actorRole: actorRole,
        });
      } catch (mailError) {
        console.error('Error enviando correo de rechazo:', mailError);
      }
    }
  }
};

const validateReservationCentreCompatibility = async (connection, {
  userId,
  userRole,
  creatingUserRole,
  vehicleCentreId,
  requestedCentreId = null,
}) => {
  // Los admins que crean la reserva no tienen restricciones de centro
  if (creatingUserRole === 'admin') {
    return { ok: true };
  }

  const [userCentreRows] = await connection.query(
    'SELECT centre_id FROM user_centres WHERE user_id = ?',
    [userId]
  );

  const userCentreIds = Array.isArray(userCentreRows)
    ? userCentreRows
      .map((row) => String(row.centre_id ?? '').trim())
      .filter((centreId) => centreId !== '')
    : [];

  const vehicleCentreValue = String(vehicleCentreId ?? '').trim();
  const requestedCentreValue = String(requestedCentreId ?? '').trim();

  if (!vehicleCentreValue) {
    return { ok: false, error: 'El vehículo no tiene un centro asociado' };
  }

  if (userCentreIds.length === 0) {
    if (userRole === 'admin') {
      return { ok: true };
    } else {
      return { ok: false, error: 'El usuario no tiene centros asociados' };
    }
  }

  if (requestedCentreValue && requestedCentreValue !== vehicleCentreValue) {
    return { ok: false, error: 'El centro seleccionado no coincide con el vehículo' };
  }

  if (!userCentreIds.includes(vehicleCentreValue)) {
    return { ok: false, error: 'El vehículo no pertenece a un centro asociado al usuario' };
  }

  if (requestedCentreValue && !userCentreIds.includes(requestedCentreValue)) {
    return { ok: false, error: 'El centro seleccionado no pertenece a los centros asociados al usuario' };
  }

  return { ok: true };
};

// Configuración de Multer para Documentos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/documents');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Nombre de archivo "encriptado" (hash/random + timestamp)
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'DOC-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos PDF'), false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
}).single('pdf');



exports.syncCentres = async (req, res) => {
  try {
    console.log('Iniciando sincronización directa desde el controlador...');
    const result = await syncCentresFromUnifica({ localConnection: db, logger: console });

    if (result.total === 0) {
      return res.json({ message: 'No hay datos nuevos para sincronizar' });
    }

    res.json({
      message: `Sincronización completada con éxito: ${result.count} registros procesados`,
      errors: result.errors,
    });
  } catch (error) {
    console.error('Error durante la sincronización directa:', error);
    res.status(500).json({
      error: 'Error al sincronizar centros',
      details: error.message
    });
  }
};

// Funciones para centros
exports.getCentres = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 50, 100));
    const offset = (page - 1) * limit;
    const search = req.query.search ? `%${req.query.search}%` : null;

    const whereClause = search
      ? 'WHERE (nombre LIKE ? OR provincia LIKE ? OR localidad LIKE ? OR direccion LIKE ?)'
      : '';
    const searchParams = search ? [search, search, search, search] : [];

    const CENTRE_SORT_MAP = { nombre: 'nombre', localidad: 'localidad', provincia: 'provincia' };
    const cSortCol = CENTRE_SORT_MAP[req.query.sortBy] || 'nombre';
    const cSortDir = req.query.sortDir === 'desc' ? 'DESC' : 'ASC';

    const [[{ total: totalRecords }]] = await db.query(
      `SELECT COUNT(*) as total FROM centres ${whereClause}`,
      searchParams
    );
    const totalPages = Math.ceil(totalRecords / limit);

    const [rows] = await db.query(
      `SELECT id, id_unifica, nombre, provincia, localidad, direccion, telefono, codigo_postal FROM centres ${whereClause} ORDER BY ${cSortCol} ${cSortDir} LIMIT ? OFFSET ?`,
      [...searchParams, limit, offset]
    );

    if (req.query.page || req.query.limit) {
      return res.json({
        data: rows,
        pagination: { currentPage: page, totalPages, totalRecords, recordsPerPage: limit }
      });
    }

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener centros' });
  }
};

exports.createCentre = async (req, res) => {
  try {
    const { id_unifica, nombre, provincia, localidad, direccion, telefono, codigo_postal } = req.body;
    if (!nombre || !provincia) return res.status(400).json({ error: 'El nombre y la provincia son obligatorios' });

    const [result] = await db.query(
      'INSERT INTO centres (id_unifica, nombre, provincia, localidad, direccion, telefono, codigo_postal) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id_unifica && id_unifica !== '' ? id_unifica : null, nombre, provincia || null, localidad || null, direccion || null, telefono || null, codigo_postal || null]
    );

    await auditLogger.logAction(req.user.id, 'CREATE', 'centres', result.insertId, req.user.role, {
      nombre,
      provincia,
      localidad
    });

    res.status(201).json({ id: result.insertId, message: 'Centro creado exitosamente' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al crear centro' });
  }
};

exports.updateCentre = async (req, res) => {
  try {
    const { id } = req.params;
    const { id_unifica, nombre, provincia, localidad, direccion, telefono, codigo_postal } = req.body;

    const [existing] = await db.query('SELECT * FROM centres WHERE id = ?', [id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Centro no encontrado' });

    await db.query(
      'UPDATE centres SET id_unifica = ?, nombre = ?, provincia = ?, localidad = ?, direccion = ?, telefono = ?, codigo_postal = ? WHERE id = ?',
      [id_unifica || existing[0].id_unifica, nombre || existing[0].nombre, provincia || existing[0].provincia, localidad || existing[0].localidad, direccion || existing[0].direccion, telefono || existing[0].telefono, codigo_postal || existing[0].codigo_postal, id]
    );

    await auditLogger.logAction(req.user.id, 'UPDATE', 'centres', id, req.user.role, {
      previous: existing[0],
      current: { id_unifica, nombre, provincia, localidad, direccion, telefono, codigo_postal }
    });

    res.json({ message: 'Centro actualizado exitosamente' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar centro' });
  }
};

exports.deleteCentre = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const { id } = req.params;
    await connection.beginTransaction();

    // 1. Obtener los vehículos del centro
    const [vehicles] = await connection.query('SELECT id FROM vehicles WHERE centre_id = ?', [id]);
    const vehicleIds = vehicles.map(v => v.id);

    if (vehicleIds.length > 0) {
      const vehicleIdsPlaceholders = vehicleIds.map(() => '?').join(',');

      // 2. Obtener las reservas de esos vehículos
      const [reservations] = await connection.query(`SELECT id FROM reservations WHERE vehicle_id IN (${vehicleIdsPlaceholders})`, vehicleIds);
      const reservationIds = reservations.map(r => r.id);

      if (reservationIds.length > 0) {
        const resIdsPlaceholders = reservationIds.map(() => '?').join(',');

        // 3. Borrar validaciones de las reservas
        await connection.query(`DELETE FROM validations WHERE reservation_id IN (${resIdsPlaceholders})`, reservationIds);

        // 4. Borrar las reservas
        await connection.query(`DELETE FROM reservations WHERE id IN (${resIdsPlaceholders})`, reservationIds);
      }

      // 5. Borrar documentos de los vehículos
      await connection.query(`DELETE FROM documents WHERE vehicle_id IN (${vehicleIdsPlaceholders})`, vehicleIds);

      // 6. Borrar los vehículos
      await connection.query(`DELETE FROM vehicles WHERE id IN (${vehicleIdsPlaceholders})`, vehicleIds);
    }

    // 7. Borrar vinculaciones de usuarios con el centro
    await connection.query('DELETE FROM user_centres WHERE centre_id = ?', [id]);

    // 8. Borrar el centro (obtener nombre antes para auditoría)
    const [existing] = await connection.query('SELECT nombre FROM centres WHERE id = ?', [id]);
    if (existing.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Centro no encontrado' });
    }

    await connection.query('DELETE FROM centres WHERE id = ?', [id]);

    // Registrar auditoría
    await auditLogger.logAction(req.user.id, 'DELETE', 'centres', id, req.user.role, {
      nombre: existing[0].nombre,
      cascade: true,
      deleted_vehicles_count: vehicleIds.length
    });

    await connection.commit();
    res.json({ message: 'Centro y todos sus datos asociados eliminados exitosamente' });
  } catch (error) {
    await connection.rollback();
    console.error('Error en deleteCentre cascade:', error);
    res.status(500).json({ error: 'Error al eliminar centro en cascada' });
  } finally {
    connection.release();
  }
};

exports.getCentreDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const [vehicles] = await db.query('SELECT id, brand, license_plate, model, status FROM vehicles WHERE centre_id = ?', [id]);
    const [users] = await db.query(`
            SELECT u.id, u.username, u.role,
                   GROUP_CONCAT(DISTINCT uc2.centre_id ORDER BY uc2.centre_id SEPARATOR ',') as centre_ids,
                   GROUP_CONCAT(DISTINCT c.nombre ORDER BY c.nombre SEPARATOR '||') as centre_names
            FROM users u
            JOIN user_centres uc ON u.id = uc.user_id
            LEFT JOIN user_centres uc2 ON u.id = uc2.user_id
            LEFT JOIN centres c ON uc2.centre_id = c.id
            WHERE uc.centre_id = ?
            GROUP BY u.id, u.username, u.role
        `, [id]);

    const formattedUsers = users.map((user) => ({
      ...user,
      centre_ids: user.centre_ids ? user.centre_ids.split(',').map(Number) : [],
      centre_names: user.centre_names ? user.centre_names.split('||').filter(Boolean) : []
    }));

    res.json({ vehicles, users: formattedUsers });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener detalles del centro' });
  }
};

// Recogemos todas las funciones relacionadas con el dashboard (estadísticas, gestión de reservas, vehículos y usuarios)
exports.getStats = async (req, res) => {
  try {
    let vehiculosParams = [];
    let vehiculosWhere = '';
    let docWhere = 'WHERE expiration_date < CURDATE()';
    let docParams = [];
    let partesWhere = "WHERE v.status != 'baja'";
    let partesParams = [];
    let resWhere = 'WHERE status = "activa"';
    let resParams = [];
    let resJoin = '';
    let docJoin = '';

    if (req.centreIds !== null) {
      if (req.centreIds.length === 0) {
        return res.json({ totalVehiculos: 0, reservasActivas: 0, vehiculosReservados: 0, vehiculosPendientesValidacion: 0, documentosExpirados: 0, partesTallerDesactualizados: 0 });
      }
      const inClause = req.centreIds.map(() => '?').join(',');
      vehiculosWhere = `WHERE centre_id IN (${inClause})`;
      vehiculosParams = req.centreIds;

      resJoin = 'JOIN vehicles v ON reservations.vehicle_id = v.id';
      resWhere = `WHERE v.centre_id IN (${inClause}) AND reservations.status = "activa"`;
      resParams = req.centreIds;

      docJoin = 'JOIN vehicles v ON documents.vehicle_id = v.id';
      docWhere = `WHERE v.centre_id IN (${inClause}) AND documents.expiration_date < CURDATE()`;
      docParams = req.centreIds;

      partesWhere = `WHERE v.status != 'baja' AND v.centre_id IN (${inClause})`;
      partesParams = req.centreIds;
    }

    const [vehiculos] = await db.query(`SELECT COUNT(*) as total FROM vehicles ${vehiculosWhere}`, vehiculosParams);

    let resQuery = `SELECT COUNT(*) as total FROM reservations ${resWhere}`;
    if (resJoin) resQuery = `SELECT COUNT(*) as total FROM reservations ${resJoin} ${resWhere}`;
    const [reservas] = await db.query(resQuery, resParams);

    const [reservados] = await db.query(`SELECT COUNT(*) as total FROM vehicles ${vehiculosWhere ? vehiculosWhere + ' AND' : 'WHERE'} status = "reservado"`, vehiculosParams);
    const [pendientes] = await db.query(`SELECT COUNT(*) as total FROM vehicles ${vehiculosWhere ? vehiculosWhere + ' AND' : 'WHERE'} status = "pendiente-validacion"`, vehiculosParams);

    let docQuery = `SELECT COUNT(*) as total FROM documents ${docWhere}`;
    if (docJoin) docQuery = `SELECT COUNT(*) as total FROM documents ${docJoin} ${docWhere}`;
    const [documentos] = await db.query(docQuery, docParams);

    const [partesTaller] = await db.query(`
      SELECT COUNT(*) as total FROM vehicles v
      ${partesWhere}
      AND v.km_taller_acumulados >= 15000
    `, partesParams);

    res.json({
      totalVehiculos: vehiculos[0].total,
      reservasActivas: reservas[0].total,
      vehiculosReservados: reservados[0].total,
      vehiculosPendientesValidacion: pendientes[0].total,
      documentosExpirados: documentos[0].total,
      partesTallerDesactualizados: partesTaller[0].total
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
};

// conseguimos las reservas más recientes y las mostramos con su informacion relacionada
exports.getRecentReservations = async (req, res) => {
  try {
    // Solo sincronizar si es explícitamente solicitado (parámetro query)
    // Para evitar sincronizaciones innecesarias después de eliminaciones
    const shouldSync = req.query.sync !== 'false';

    if (shouldSync) {
      try {
        await syncReservationStatusesByTime();
      } catch (syncError) {
        console.error('Error sincronizando reservas por tiempo antes de listar:', syncError);
      }
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 50, 100));
    const offset = (page - 1) * limit;
    const search = req.query.search ? `%${req.query.search}%` : null;
    const startDate = req.query.startDate ? req.query.startDate.replace('T', ' ') : null;
    const endDate = req.query.endDate ? req.query.endDate.replace('T', ' ') : null;
    const RESERVATION_SORT_MAP = {
      username: 'u.username',
      model: 'v.model',
      start_time: 'r.start_time',
      end_time: 'r.end_time',
      status: 'r.status',
      upcoming_start_time: 'upcoming_start_time'
    };
    const requestedSortBy = typeof req.query.sortBy === 'string' ? req.query.sortBy : '';
    const sortCol = RESERVATION_SORT_MAP[requestedSortBy] || 'r.start_time';
    const sortDir = req.query.sortDir === 'desc' ? 'DESC' : 'ASC';
    const orderByClause = sortCol === 'upcoming_start_time'
      ? 'ORDER BY CASE WHEN r.start_time >= NOW() THEN 0 ELSE 1 END ASC, CASE WHEN r.start_time >= NOW() THEN r.start_time END ASC, CASE WHEN r.start_time < NOW() THEN r.start_time END DESC, r.id DESC'
      : `ORDER BY ${sortCol} ${sortDir}`;
    const statusFilter = typeof req.query.statusFilter === 'string' ? req.query.statusFilter.toLowerCase() : '';
    let whereClause = '';
    let params = [];
    const isAdmin = req.user && req.user.role === 'admin';

    if (req.centreIds !== null) {
      if (req.centreIds.length === 0) return res.json([]);
      const inClause = req.centreIds.map(() => '?').join(',');
      whereClause = `WHERE v.centre_id IN (${inClause})`;
      params = req.centreIds;
    }

    if (!isAdmin) {
      const additionalClause = `${whereClause ? 'AND' : 'WHERE'} u.role != 'admin'`;
      whereClause = whereClause ? `${whereClause} ${additionalClause}` : additionalClause;
    }

    const isOwnReservationsOnly = req.user && (req.user.role === 'gestor' || req.user.role === 'empleado');
    if (isOwnReservationsOnly) {
      whereClause += ` AND r.user_id = ?`;
      params.push(req.user.id);
    }

    const hideOldFinalizedClause = `${whereClause ? 'AND' : 'WHERE'} NOT (r.status = 'finalizada' AND val.km_entrega IS NOT NULL AND r.end_time < DATE_SUB(NOW(), INTERVAL 10 DAY))`;
    whereClause = whereClause ? `${whereClause} ${hideOldFinalizedClause}` : hideOldFinalizedClause;

    if (search) {
      whereClause += ` AND (u.username LIKE ? OR v.license_plate LIKE ? OR v.model LIKE ? OR r.status LIKE ?)`;
      params.push(search, search, search, search);
    }

    if (startDate) {
      whereClause += ` AND r.start_time >= ?`;
      params.push(startDate);
    }

    if (endDate) {
      whereClause += ` AND r.end_time <= ?`;
      params.push(endDate);
    }

    const baseWhereClause = whereClause;

    const allowedStatusFilters = new Set(['pendiente', 'aprobada', 'activa', 'finalizada', 'rechazada']);
    if (allowedStatusFilters.has(statusFilter)) {
      whereClause += ` AND r.status = ?`;
      params.push(statusFilter);
    }

    const [statusCountRows] = await db.query(`
      SELECT
        SUM(r.status = 'pendiente') AS pendiente,
        SUM(r.status = 'aprobada') AS aprobada,
        SUM(r.status = 'activa') AS activa,
        SUM(r.status = 'finalizada') AS finalizada,
        SUM(r.status = 'rechazada') AS rechazada
      FROM reservations r
      JOIN users u ON r.user_id = u.id
      JOIN vehicles v ON r.vehicle_id = v.id
      LEFT JOIN validations val ON r.id = val.reservation_id AND val.deleted_at IS NULL
      ${baseWhereClause}
    `, params.slice(0, params.length - (allowedStatusFilters.has(statusFilter) ? 1 : 0)));

    const [countRows] = await db.query(`
      SELECT COUNT(*) as total
      FROM reservations r
      JOIN users u ON r.user_id = u.id
      JOIN vehicles v ON r.vehicle_id = v.id
      LEFT JOIN validations val ON r.id = val.reservation_id AND val.deleted_at IS NULL
      ${whereClause}
    `, params);
    const totalRecords = countRows?.[0]?.total || 0;
    const totalPages = Math.ceil(totalRecords / limit);

    const [rows] = await db.query(`
      SELECT 
        r.id,
        u.username,
        v.brand,
        v.license_plate,
        v.model,
        v.status AS vehicle_status,
        v.centre_id,
        r.start_time,
        r.end_time,
        r.status,
        r.user_id,
        r.vehicle_id,
        r.motivo_rechazo,
        val.km_inicial,
        val.km_entrega,
        val.informe_entrega,
        val.incidencias
      FROM reservations r
      JOIN users u ON r.user_id = u.id
      JOIN vehicles v ON r.vehicle_id = v.id
      LEFT JOIN validations val ON r.id = val.reservation_id AND val.deleted_at IS NULL
      ${whereClause}
      ${orderByClause}
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    if (req.query.page || req.query.limit) {
      return res.json({
        data: rows,
        pagination: {
          currentPage: page,
          totalPages,
          totalRecords,
          recordsPerPage: limit,
          statusCounts: {
            pendiente: Number(statusCountRows?.[0]?.pendiente || 0),
            aprobada: Number(statusCountRows?.[0]?.aprobada || 0),
            activa: Number(statusCountRows?.[0]?.activa || 0),
            finalizada: Number(statusCountRows?.[0]?.finalizada || 0),
            rechazada: Number(statusCountRows?.[0]?.rechazada || 0),
          }
        }
      });
    }

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener reservas recientes' });
  }
};

// Funcion para crear una reserva, con protecciones contra suplantación y validación de colisiones para evitar dobles reservas en el mismo horario.
exports.createReservation = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { user_id, vehicle_id, start_time, end_time, status, centre_id } = req.body;
    const normalizedStartTime = normalizeMySqlDateTime(start_time);
    const normalizedEndTime = normalizeMySqlDateTime(end_time);

    // Si es empleado, forzamos que la reserva sea para él mismo
    let finalUserId = user_id;
    if (req.user.role === 'empleado' || req.user.role === 'gestor') {
      finalUserId = req.user.id;
    }

    if (!finalUserId || !vehicle_id || !normalizedStartTime || !normalizedEndTime) {
      await connection.rollback();
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    if (!parseMySqlDateTime(normalizedStartTime) || !parseMySqlDateTime(normalizedEndTime)) {
      await connection.rollback();
      return res.status(400).json({ error: 'Formato de fecha y hora inválido' });
    }

    if (parseMySqlDateTime(normalizedStartTime) >= parseMySqlDateTime(normalizedEndTime)) {
      await connection.rollback();
      return res.status(400).json({ error: 'La fecha de inicio debe ser anterior a la fecha de fin' });
    }

    // No permitir reservas en el pasado (excepto para admins/supervisores)
    const now = new Date();
    const isSpecialRole = req.user.role === 'admin' || req.user.role === 'supervisor';
    if (!isSpecialRole && parseMySqlDateTime(normalizedStartTime) < now) {
      await connection.rollback();
      return res.status(400).json({ error: 'La fecha de inicio no puede estar en el pasado' });
    }

    // Fuerza Estado Pendiente para Empleados
    let finalStatus = status || 'pendiente';
    if (req.user.role === 'empleado' || req.user.role === 'gestor') {
      finalStatus = 'pendiente';
    }

    // Bloqueo para solo permitir reservas si el vehículo está en "disponible"
    const [vehicleRows] = await connection.query('SELECT status, centre_id FROM vehicles WHERE id = ?', [vehicle_id]);
    if (vehicleRows.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'Vehículo no encontrado' });
    }
    if (String(vehicleRows[0].status || '').toLowerCase() !== 'disponible') {
      await connection.rollback();
      return res.status(400).json({ error: 'Este vehículo no está disponible para reservar' });
    }

    const centreValidation = await validateReservationCentreCompatibility(connection, {
      userId: finalUserId,
      userRole: req.user.role,
      creatingUserRole: req.user.role,
      vehicleCentreId: vehicleRows[0].centre_id,
      requestedCentreId: centre_id,
    });

    if (!centreValidation.ok) {
      await connection.rollback();
      return res.status(400).json({ error: centreValidation.error });
    }

    const [collisions] = await connection.query(`
      SELECT id FROM reservations 
      WHERE vehicle_id = ? 
      AND status NOT IN ('rechazada', 'finalizada')
      AND (
        (start_time <= ? AND end_time >= ?) OR
        (start_time <= ? AND end_time >= ?) OR
        (start_time >= ? AND end_time <= ?)
      )
    `, [vehicle_id, normalizedStartTime, normalizedStartTime, normalizedEndTime, normalizedEndTime, normalizedStartTime, normalizedEndTime]);

    if (collisions.length > 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'El vehículo ya está reservado en ese horario' });
    }

    // Verificar que el USUARIO no tenga ya otra reserva en el mismo horario
    const [userCollisions] = await connection.query(`
      SELECT id FROM reservations 
      WHERE user_id = ? 
      AND status NOT IN ('rechazada', 'finalizada')
      AND (
        (start_time <= ? AND end_time >= ?) OR
        (start_time <= ? AND end_time >= ?) OR
        (start_time >= ? AND end_time <= ?)
      )
    `, [finalUserId, normalizedStartTime, normalizedStartTime, normalizedEndTime, normalizedEndTime, normalizedStartTime, normalizedEndTime]);

    if (userCollisions.length > 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'Ya tienes una reserva activa en este horario' });
    }

    const [result] = await connection.query(
      'INSERT INTO reservations (user_id, vehicle_id, start_time, end_time, status) VALUES (?, ?, ?, ?, ?)',
      [finalUserId, vehicle_id, normalizedStartTime, normalizedEndTime, finalStatus]
    );

    // Sincronizar estado inicial del vehículo (pendiente o aprobada -> reservado)
    let initialVehicleStatus = 'reservado';
    if (String(finalStatus || '').toLowerCase() === 'activa') initialVehicleStatus = 'en-uso';
    await connection.query('UPDATE vehicles SET status = ? WHERE id = ?', [initialVehicleStatus, vehicle_id]);

    await connection.commit();

    // Obtener info del vehículo para el audit y la respuesta
    const [vehicleInfoRows] = await connection.query('SELECT brand, model, license_plate FROM vehicles WHERE id = ?', [vehicle_id]);
    const vehiculoInfo = vehicleInfoRows.length > 0
      ? formatVehicleLabel(vehicleInfoRows[0])
      : `ID: ${vehicle_id}`;

    // Registrar auditoría de creación de reserva
    try {
      await auditLogger.logAction(req.user.id, 'CREATE', 'reservations', result.insertId, req.user.role, {
        user_id: finalUserId,
        vehicle_id: vehicle_id,
        vehiculo: vehiculoInfo,
        start_time: normalizedStartTime,
        end_time: normalizedEndTime,
        status: finalStatus
      });
    } catch (auditError) {
      console.error('Error registrando auditoría de creación de reserva:', auditError);
    }

    // Obtener los datos de la nueva reserva para emitir al admin y al centro
    const [newReservation] = await connection.query(`
      SELECT 
        r.id,
        u.username,
        v.brand,
        v.license_plate,
        v.model,
        v.status AS vehicle_status,
        v.centre_id,
        c.nombre AS centre_name,
        r.start_time,
        r.end_time,
        r.status,
        r.user_id,
        r.vehicle_id,
        val.km_inicial,
        val.km_entrega,
        val.informe_entrega,
        val.incidencias
      FROM reservations r
      JOIN users u ON r.user_id = u.id
      JOIN vehicles v ON r.vehicle_id = v.id
      LEFT JOIN centres c ON v.centre_id = c.id
      LEFT JOIN validations val ON r.id = val.reservation_id
      WHERE r.id = ?
    `, [result.insertId]);

    // Emitir evento de nueva reserva al centro y a todos los admins conectados
    if (newReservation.length > 0) {
      const { emitToCentreAndAdmin } = require('../utils/socketManager');
      emitToCentreAndAdmin('new_reservation', newReservation[0].centre_id, newReservation[0]);

      try {
        const mailResult = await sendReservationNotification({
          reservation: newReservation[0],
          currentStatus: newReservation[0].status,
          action: 'created',
          actorUserId: req.user.id,
          actorRole: req.user.role,
        });
        if (mailResult?.eventType === 'finalized' && !mailResult?.skipped) {
          await markReservationMailSent(id, 'finalization_mail_sent_at');
        }
      } catch (mailError) {
        console.error('Error enviando correo de nueva reserva:', mailError);
      }
    }

    res.status(201).json({ id: result.insertId, message: 'Reserva creada exitosamente' });
  } catch (error) {
    try {
      await connection.rollback();
    } catch { }
    console.error(error);
    res.status(500).json({ error: 'Error al crear reserva' });
  } finally {
    connection.release();
  }
};

// Función para actualizar una reserva.
exports.updateReservation = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { id } = req.params;
    const {
      user_id,
      vehicle_id,
      start_time,
      end_time,
      status,
      centre_id,
      km_entrega,
      estado_entrega,
      informe_entrega,
      foto_contador,
      motivo_rechazo,
    } = req.body;

    const [original] = await connection.query(
      'SELECT user_id, vehicle_id, start_time, end_time, status FROM reservations WHERE id = ?',
      [id]
    );
    if (original.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }

    if ((req.user.role === 'empleado' || req.user.role === 'gestor') && original[0].user_id !== req.user.id) {
      await connection.rollback();
      return res.status(403).json({ error: 'No tienes permiso para editar esta reserva' });
    }

    let finalUserId = user_id ?? original[0].user_id;
    const finalVehicleId = vehicle_id ?? original[0].vehicle_id;
    const normalizedStartTime = normalizeMySqlDateTime(start_time ?? original[0].start_time);
    const normalizedEndTime = normalizeMySqlDateTime(end_time ?? original[0].end_time);
    let finalStatus = status ?? original[0].status;
    const requestedStatus = String(status || '').toLowerCase();
    const currentStatus = String(original[0].status || '').toLowerCase();

    if (req.user.role === 'empleado' || req.user.role === 'gestor') {
      finalUserId = req.user.id;

      if (requestedStatus === 'finalizada' && ['pendiente', 'aprobada', 'activa'].includes(currentStatus)) {
        finalStatus = 'finalizada';
      } else if (requestedStatus === 'activa' && currentStatus === 'aprobada') {
        finalStatus = 'activa';
      } else {
        finalStatus = original[0].status;
      }
    }

    if (!parseMySqlDateTime(normalizedStartTime) || !parseMySqlDateTime(normalizedEndTime)) {
      await connection.rollback();
      return res.status(400).json({ error: 'Formato de fecha y hora inválido' });
    }

    if (parseMySqlDateTime(normalizedStartTime) >= parseMySqlDateTime(normalizedEndTime)) {
      await connection.rollback();
      return res.status(400).json({ error: 'La fecha de inicio debe ser anterior a la fecha de fin' });
    }

    const isEmployee = req.user.role === 'empleado' || req.user.role === 'gestor';
    const isDeliveryUpdate =
      requestedStatus === 'finalizada' &&
      (km_entrega !== undefined || estado_entrega !== undefined || informe_entrega !== undefined);
    const isEmployeeFinalizingReservation =
      isEmployee &&
      isDeliveryUpdate &&
      ['activa', 'finalizada'].includes(currentStatus);
    const isEmployeeActivatingApprovedReservation = isEmployee && requestedStatus === 'activa' && currentStatus === 'aprobada';
    const isPendingOriginalReservation = currentStatus === 'pendiente';
    const allowPastStartForEdit =
      !isEmployee ||
      isPendingOriginalReservation ||
      isEmployeeFinalizingReservation ||
      isEmployeeActivatingApprovedReservation;

    const now = new Date();
    if (parseMySqlDateTime(normalizedStartTime) < now && !allowPastStartForEdit) {
      await connection.rollback();
      return res.status(400).json({ error: 'La fecha de inicio no puede estar en el pasado' });
    }

    const [vehicleRows] = await connection.query('SELECT centre_id FROM vehicles WHERE id = ?', [finalVehicleId]);
    if (vehicleRows.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'Vehículo no encontrado' });
    }

    const centreValidation = await validateReservationCentreCompatibility(connection, {
      userId: finalUserId,
      userRole: req.user.role,
      creatingUserRole: req.user.role,
      vehicleCentreId: vehicleRows[0].centre_id,
      requestedCentreId: centre_id,
    });

    if (!centreValidation.ok) {
      await connection.rollback();
      return res.status(400).json({ error: centreValidation.error });
    }

    const [collisions] = await connection.query(`
      SELECT id FROM reservations 
      WHERE vehicle_id = ? 
      AND id != ?
      AND status NOT IN ('rechazada', 'finalizada')
      AND (
        (start_time <= ? AND end_time >= ?) OR
        (start_time <= ? AND end_time >= ?) OR
        (start_time >= ? AND end_time <= ?)
      )
    `, [finalVehicleId, id, normalizedStartTime, normalizedStartTime, normalizedEndTime, normalizedEndTime, normalizedStartTime, normalizedEndTime]);

    if (collisions.length > 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'El vehículo ya está reservado en ese horario' });
    }

    const [userCollisions] = await connection.query(`
      SELECT id FROM reservations 
      WHERE user_id = ? 
      AND id != ?
      AND status NOT IN ('rechazada', 'finalizada')
      AND (
        (start_time <= ? AND end_time >= ?) OR
        (start_time <= ? AND end_time >= ?) OR
        (start_time >= ? AND end_time <= ?)
      )
    `, [finalUserId, id, normalizedStartTime, normalizedStartTime, normalizedEndTime, normalizedEndTime, normalizedStartTime, normalizedEndTime]);

    if (userCollisions.length > 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'Ya tienes una reserva activa en este horario' });
    }

    // Guardar motivo de rechazo si se está rechazando
    const finalMotivoRechazo = String(finalStatus || '').toLowerCase() === 'rechazada'
      ? (typeof motivo_rechazo === 'string' ? motivo_rechazo.trim() : null)
      : null;

    const [result] = await connection.query(
      'UPDATE reservations SET user_id = ?, vehicle_id = ?, start_time = ?, end_time = ?, status = ?, motivo_rechazo = ? WHERE id = ?',
      [finalUserId, finalVehicleId, normalizedStartTime, normalizedEndTime, finalStatus, finalMotivoRechazo, id]
    );

    if (String(finalStatus || '').toLowerCase() === 'finalizada') {
      const [vehicleRows] = await connection.query('SELECT kilometers FROM vehicles WHERE id = ?', [finalVehicleId]);
      const kmInicial = vehicleRows.length > 0 ? vehicleRows[0].kilometers : 0;

      if (km_entrega !== undefined && km_entrega !== null) {
        const parsedKm = Number(km_entrega);
        if (Number.isNaN(parsedKm) || parsedKm <= 0) {
          await connection.rollback();
          return res.status(400).json({ error: 'Kilometraje de entrega inválido' });
        }

        const incidencias = String(estado_entrega || '').toLowerCase() === 'incorrecto';
        const informe = typeof informe_entrega === 'string' ? informe_entrega.trim() : null;
        const fotoContadorVal = typeof foto_contador === 'string' && foto_contador.length > 0 ? foto_contador : null;

        // Obtener validación existente para evitar duplicar km
        const [existingVal] = await connection.query(
          'SELECT km_entrega FROM validations WHERE reservation_id = ? AND deleted_at IS NULL',
          [id]
        );

        // Calcular kilómetros acumulados para parte de taller
        const kmRecorridos = Math.max(0, parsedKm - kmInicial);
        const kmAnteriores = existingVal.length > 0 && existingVal[0].km_entrega !== null
          ? Math.max(0, existingVal[0].km_entrega - kmInicial)
          : 0;
        const kmDiff = kmRecorridos - kmAnteriores;

        // Insertar/actualizar validación
        await connection.query(`
          INSERT INTO validations (reservation_id, km_inicial, km_entrega, informe_entrega, incidencias, status, foto_contador)
          VALUES (?, ?, ?, ?, ?, 'pendiente', ?)
          ON DUPLICATE KEY UPDATE
            km_entrega = VALUES(km_entrega),
            informe_entrega = VALUES(informe_entrega),
            incidencias = VALUES(incidencias),
            foto_contador = COALESCE(VALUES(foto_contador), foto_contador),
            deleted_at = NULL
        `, [id, kmInicial, parsedKm, informe, incidencias, fotoContadorVal]);

        // Actualizar km_taller_acumulados del vehículo solo si hay diferencia
        if (kmDiff !== 0) {
          await connection.query(
            'UPDATE vehicles SET km_taller_acumulados = GREATEST(0, km_taller_acumulados + ?) WHERE id = ?',
            [kmDiff, finalVehicleId]
          );

          // Verificar si hay que notificar a los admins
          const [vData] = await connection.query('SELECT brand, model, license_plate, km_taller_acumulados, centre_id FROM vehicles WHERE id = ?', [finalVehicleId]);
          if (vData.length > 0 && vData[0].km_taller_acumulados >= 15000) {
            const [cData] = await connection.query('SELECT nombre FROM centres WHERE id = ?', [vData[0].centre_id]);
            notifyStaffAboutWorkshop({
              vehicle: {
                model: vData[0].model,
                license_plate: vData[0].license_plate,
                centre_name: cData.length > 0 ? cData[0].nombre : 'Sin centro'
              },
              centreId: vData[0].centre_id
            }).catch(err => console.error('Error enviando notificación de taller:', err));
          }
        }
      } else {
        await connection.query(`
          INSERT INTO validations (reservation_id, km_inicial, km_entrega, status)
          VALUES (?, ?, NULL, 'pendiente')
          ON DUPLICATE KEY UPDATE
            km_inicial = IF(km_inicial IS NULL OR km_inicial = 0, VALUES(km_inicial), km_inicial),
            deleted_at = NULL
        `, [id, kmInicial]);
      }
    }

    // DESPUÉS - decide el estado conociendo el km_entrega real
    let vehicleStatus = null;
    const s = String(finalStatus || '').toLowerCase();
    if (s === 'aprobada' || s === 'pendiente') vehicleStatus = 'reservado';
    else if (s === 'activa') vehicleStatus = 'en-uso';
    else if (s === 'rechazada') vehicleStatus = 'disponible';
    else if (s === 'finalizada') {
      // km_entrega viene del body de esta misma petición
      const parsedKm = Number(km_entrega);
      const kmEntregaFinal = (!Number.isNaN(parsedKm) && km_entrega !== undefined && km_entrega !== null)
        ? parsedKm
        : null;

      vehicleStatus = (kmEntregaFinal !== null && kmEntregaFinal > 0)
        ? 'pendiente-validacion'
        : 'formulario-entrega-pendiente';
    }

    if (vehicleStatus) {
      await connection.query('UPDATE vehicles SET status = ? WHERE id = ?', [vehicleStatus, finalVehicleId]);
    }

    const oldVehicleId = original[0].vehicle_id;
    const [oldVehicleRows] = await connection.query('SELECT brand, model, license_plate FROM vehicles WHERE id = ?', [oldVehicleId]);
    const [newVehicleRows] = await connection.query('SELECT brand, model, license_plate FROM vehicles WHERE id = ?', [finalVehicleId]);
    const oldVehiculoInfo = oldVehicleRows.length > 0
      ? formatVehicleLabel(oldVehicleRows[0])
      : `ID: ${oldVehicleId}`;
    const newVehiculoInfo = newVehicleRows.length > 0
      ? formatVehicleLabel(newVehicleRows[0])
      : `ID: ${finalVehicleId}`;

    const previousReservation = {
      user_id: original[0].user_id,
      vehicle_id: original[0].vehicle_id,
      vehiculo: oldVehiculoInfo,
      start_time: original[0].start_time,
      end_time: original[0].end_time,
      status: original[0].status
    };

    const currentReservation = {
      user_id: finalUserId,
      vehicle_id: finalVehicleId,
      vehiculo: newVehiculoInfo,
      start_time: normalizedStartTime,
      end_time: normalizedEndTime,
      status: finalStatus
    };

    const reservationChanges = {
      user_id: { from: previousReservation.user_id, to: currentReservation.user_id },
      vehicle_id: { from: previousReservation.vehicle_id, to: currentReservation.vehicle_id },
      vehiculo: { from: oldVehiculoInfo, to: newVehiculoInfo },
      start_time: { from: previousReservation.start_time, to: currentReservation.start_time },
      end_time: { from: previousReservation.end_time, to: currentReservation.end_time },
      status: { from: previousReservation.status, to: currentReservation.status }
    };

    const modifiedReservationFields = Object.keys(reservationChanges).filter(key =>
      String(reservationChanges[key].from) !== String(reservationChanges[key].to)
    );

    await connection.commit();

    try {
      await auditLogger.logAction(req.user.id, 'UPDATE', 'reservations', id, req.user.role, {
        previous: previousReservation,
        current: currentReservation,
        changes: reservationChanges,
        modifiedFields: modifiedReservationFields
      });
    } catch (auditError) {
      console.error('Error registrando auditoría de actualización de reserva:', auditError);
    }

    const [updatedReservation] = await connection.query(`
      SELECT 
        r.id,
        u.username,
        v.brand,
        v.license_plate,
        v.model,
        v.status AS vehicle_status,
        v.centre_id,
        c.nombre AS centre_name,
        r.start_time,
        r.end_time,
        r.status,
        r.user_id,
        r.vehicle_id,
        val.km_inicial,
        val.km_entrega,
        val.informe_entrega,
        val.incidencias
      FROM reservations r
      JOIN users u ON r.user_id = u.id
      JOIN vehicles v ON r.vehicle_id = v.id
      LEFT JOIN centres c ON v.centre_id = c.id
      LEFT JOIN validations val ON r.id = val.reservation_id
      WHERE r.id = ?
    `, [id]);

    if (updatedReservation.length > 0) {
      const { emitToCentreAndAdmin } = require('../utils/socketManager');
      emitToCentreAndAdmin('updated_reservation', updatedReservation[0].centre_id, updatedReservation[0]);

      try {
        await sendReservationNotification({
          reservation: updatedReservation[0],
          previousStatus: original[0].status,
          currentStatus: updatedReservation[0].status,
          action: 'updated',
          actorUserId: req.user.id,
          actorRole: req.user.role,
        });
      } catch (mailError) {
        console.error('Error enviando correo de actualización de reserva:', mailError);
      }
    }

    res.json({ message: 'Reserva actualizada exitosamente' });
  } catch (error) {
    try {
      await connection.rollback();
    } catch { }
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar reserva' });
  } finally {
    connection.release();
  }
};

// Función para eliminar una reserva.
exports.deleteReservation = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { id } = req.params;

    // Verificar Propiedad (Solo el dueño o admin/supervisor pueden borrar)
    const [original] = await connection.query(`
      SELECT
        r.user_id,
        r.vehicle_id,
        r.status,
        r.start_time,
        r.end_time,
        v.centre_id,
        u.username,
        v.brand,
        v.license_plate,
        v.model,
        c.nombre AS centre_name
      FROM reservations r
      JOIN vehicles v ON r.vehicle_id = v.id
      JOIN users u ON r.user_id = u.id
      LEFT JOIN centres c ON v.centre_id = c.id
      WHERE r.id = ?
    `, [id]);
    if (original.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }

    if (req.user.role === 'empleado' && original[0].user_id !== req.user.id) {
      await connection.rollback();
      return res.status(403).json({ error: 'No tienes permiso para eliminar esta reserva' });
    }

    const vehicleId = original[0].vehicle_id;
    const centreId = original[0].centre_id;
    const reservationStatus = normalizeStatus(original[0].status);


    // Eliminar validaciones asociadas a esta reserva ANTES de eliminar la reserva
    await connection.query('DELETE FROM validations WHERE reservation_id = ?', [id]);

    const [result] = await connection.query('DELETE FROM reservations WHERE id = ?', [id]);

    // IMPORTANTE: Si es una reserva finalizada, NO hacer nada con el vehículo
    // El vehículo mantiene su estado actual (pendiente-validacion o formulario-entrega-pendiente)
    // Solo cambiar estado si la reserva NO era finalizada
    if (reservationStatus !== 'finalizada') {
      await syncVehicleStatusFromReservations(connection, vehicleId);
    } else {
    }

    await connection.commit();

    // Registrar auditoría de eliminación de reserva
    try {
      await auditLogger.logAction(req.user.id, 'DELETE', 'reservations', id, req.user.role, {
        user_id: original[0].user_id,
        vehicle_id: vehicleId,
        vehiculo: formatVehicleLabel(original[0]),
        start_time: original[0].start_time,
        end_time: original[0].end_time,
        status: original[0].status,
        action: 'Reserva eliminada'
      });
    } catch (auditError) {
      console.error('Error registrando auditoría de eliminación de reserva:', auditError);
    }

    // Emitir evento de eliminación de reserva al centro y a todos los admins conectados
    const { emitToCentreAndAdmin } = require('../utils/socketManager');
    emitToCentreAndAdmin('deleted_reservation', centreId, { id, centre_id: centreId });

    if (reservationStatus !== 'rechazada') {
      try {
        await sendReservationNotification({
          reservation: original[0],
          previousStatus: original[0].status,
          currentStatus: original[0].status,
          action: 'deleted',
          actorUserId: req.user.id,
          actorRole: req.user.role,
        });
      } catch (mailError) {
        console.error('Error enviando correo de reserva eliminada:', mailError);
      }
    }

    res.json({ message: 'Reserva eliminada exitosamente' });
  } catch (error) {
    try {
      await connection.rollback();
    } catch { }
    console.error('[DELETE RESERVATION ERROR]', error);
    res.status(500).json({ error: 'Error al eliminar reserva' });
  } finally {
    connection.release();
  }
};

// Funciones para gestionar vehículos (CRUD)
exports.getVehicles = async (req, res) => {
  try {
    const { start, end, excludeRes } = req.query;
    const isCentreManagementScope = req.user?.role === 'supervisor' && req.query?.scope === 'centres';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 50, 100));
    const offset = (page - 1) * limit;
    const search = req.query.search ? `%${req.query.search}%` : null;
    const VEHICLE_SORT_MAP = {
      license_plate: 'v.license_plate',
      brand: 'v.brand',
      model: 'v.model',
      vehicle_type: 'v.vehicle_type',
      seats: 'v.seats',
      trunk_capacity_l: 'v.trunk_capacity_l',
      energy_type: 'v.energy_type',
      fuel_level: 'v.fuel_level',
      location: 'v.location',
      cost_centre: 'v.cost_centre',
      status: 'v.status',
      kilometers: 'v.kilometers',
      centre_name: 'c.nombre',
      has_expired_documents: 'has_expired_documents',
      is_workshop_report_outdated: 'is_workshop_report_outdated',
    };
    const vSortCol = VEHICLE_SORT_MAP[req.query.sortBy] || 'v.license_plate';
    const vSortDir = req.query.sortDir === 'desc' ? 'DESC' : 'ASC';
    const optionsFilter = typeof req.query.optionsFilter === 'string' ? req.query.optionsFilter : 'all';
    const brand = normalizeNullableText(req.query.brand);
    const vehicleType = normalizeNullableText(req.query.vehicleType);
    const energyType = normalizeNullableText(req.query.energyType);
    const fuelLevel = normalizeNullableText(req.query.fuelLevel);
    const location = normalizeNullableText(req.query.location);
    const costCentre = normalizeNullableText(req.query.costCentre);
    const extras = normalizeNullableText(req.query.extras);
    const seatsMin = normalizeOptionalInteger(req.query.seatsMin);
    const seatsMax = normalizeOptionalInteger(req.query.seatsMax);
    const trunkMin = normalizeOptionalInteger(req.query.trunkMin);
    const trunkMax = normalizeOptionalInteger(req.query.trunkMax);

    let query = `
      SELECT v.*, c.nombre as centre_name,
      (SELECT COUNT(*) FROM documents d WHERE d.vehicle_id = v.id AND d.expiration_date < CURDATE()) as has_expired_documents,
      (v.km_taller_acumulados >= 15000) as is_workshop_report_outdated
      FROM vehicles v
      LEFT JOIN centres c ON v.centre_id = c.id
    `;
    let params = [];
    let whereClauses = [];

    if (!isCentreManagementScope && req.centreIds !== null) {
      if (req.centreIds.length === 0) return res.json([]);
      const inClause = req.centreIds.map(() => '?').join(',');
      whereClauses.push(`v.centre_id IN (${inClause})`);
      params.push(...req.centreIds);
    }

    if (search) {
      whereClauses.push('(v.license_plate LIKE ? OR v.brand LIKE ? OR v.model LIKE ? OR v.vehicle_type LIKE ? OR v.location LIKE ? OR v.cost_centre LIKE ? OR v.extras LIKE ? OR c.nombre LIKE ?)');
      params.push(search, search, search, search, search, search, search, search);
    }

    if (brand) {
      whereClauses.push('v.brand = ?');
      params.push(brand);
    }

    if (vehicleType) {
      whereClauses.push('v.vehicle_type = ?');
      params.push(vehicleType);
    }

    if (energyType) {
      whereClauses.push('v.energy_type = ?');
      params.push(energyType);
    }

    if (fuelLevel) {
      whereClauses.push('v.fuel_level = ?');
      params.push(fuelLevel);
    }

    if (location) {
      whereClauses.push('v.location LIKE ?');
      params.push(`%${location}%`);
    }

    if (costCentre) {
      whereClauses.push('v.cost_centre LIKE ?');
      params.push(`%${costCentre}%`);
    }

    if (extras) {
      whereClauses.push('v.extras LIKE ?');
      params.push(`%${extras}%`);
    }

    if (seatsMin !== undefined) {
      whereClauses.push('v.seats >= ?');
      params.push(seatsMin);
    }

    if (seatsMax !== undefined) {
      whereClauses.push('v.seats <= ?');
      params.push(seatsMax);
    }

    if (trunkMin !== undefined) {
      whereClauses.push('v.trunk_capacity_l >= ?');
      params.push(trunkMin);
    }

    if (trunkMax !== undefined) {
      whereClauses.push('v.trunk_capacity_l <= ?');
      params.push(trunkMax);
    }

    if (req.query.filterExpired === '1' || req.query.filterExpired === 'true') {
      whereClauses.push('(SELECT COUNT(*) FROM documents d WHERE d.vehicle_id = v.id AND d.expiration_date < CURDATE()) > 0');
    }

    if (optionsFilter === 'expired-documents') {
      whereClauses.push('(SELECT COUNT(*) FROM documents d WHERE d.vehicle_id = v.id AND d.expiration_date < CURDATE()) > 0');
    } else if (optionsFilter === 'workshop-outdated') {
      whereClauses.push('(SELECT COUNT(*) FROM documents d WHERE d.vehicle_id = v.id AND d.expiration_date < CURDATE()) = 0');
      whereClauses.push('(v.km_taller_acumulados >= 15000)');
    } else if (optionsFilter === 'clean') {
      whereClauses.push('(SELECT COUNT(*) FROM documents d WHERE d.vehicle_id = v.id AND d.expiration_date < CURDATE()) = 0');
      whereClauses.push('(v.km_taller_acumulados < 15000)');
    }

    if (start && end) {
      // Un vehículo NO está disponible si tiene una reserva que solape con el rango pedido.
      let availCond = `v.status = 'disponible' AND v.id NOT IN (
        SELECT vehicle_id FROM reservations 
        WHERE status NOT IN ('rechazada', 'finalizada')`;
      if (excludeRes) {
        availCond += ' AND id != ?';
        params.push(excludeRes);
      }
      availCond += ' AND start_time < ? AND end_time > ?)';
      params.push(end, start);
      whereClauses.push(availCond);
    }

    if (whereClauses.length > 0) {
      query += ' WHERE ' + whereClauses.join(' AND ');
    }

    const countQuery = `SELECT COUNT(*) as total FROM (${query}) as vehicle_count`;
    const [countRows] = await db.query(countQuery, params);
    const totalRecords = countRows?.[0]?.total || 0;
    const totalPages = Math.ceil(totalRecords / limit);

    query += ` ORDER BY ${vSortCol} ${vSortDir} LIMIT ? OFFSET ?`;
    const [rows] = await db.query(query, [...params, limit, offset]);

    if (req.query.page || req.query.limit) {
      return res.json({
        data: rows,
        pagination: { currentPage: page, totalPages, totalRecords, recordsPerPage: limit }
      });
    }

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener vehículos' });
  }
};

// Funciones para gestionar vehículos (CRUD)
exports.createVehicle = async (req, res) => {
  try {
    let {
      license_plate,
      brand,
      model,
      vehicle_type,
      seats,
      trunk_capacity_l,
      energy_type,
      fuel_level,
      location,
      extras,
      cost_centre,
      status,
      kilometers,
      centre_id,
    } = req.body;

    const finalBrand = normalizeNullableText(brand);
    const finalModel = String(model ?? '').trim();
    const finalVehicleType = normalizeNullableText(vehicle_type) || 'turismo';
    const finalSeats = normalizeOptionalInteger(seats);
    const finalTrunkCapacity = normalizeOptionalInteger(trunk_capacity_l);
    const finalEnergyType = normalizeNullableText(energy_type) || 'combustion';
    const finalFuelLevel = normalizeNullableText(fuel_level) || 'medio';
    const finalLocation = normalizeNullableText(location);
    const finalExtras = normalizeNullableText(extras);
    const finalCostCentre = normalizeNullableText(cost_centre);

    if (!license_plate || !finalBrand || !finalModel) {
      return res.status(400).json({ error: 'La matrícula, la marca y el modelo son obligatorios' });
    }

    if (finalModel.length > 60) {
      return res.status(400).json({ error: 'El modelo no puede exceder 60 caracteres' });
    }

    if (finalBrand.length > 80) {
      return res.status(400).json({ error: 'La marca no puede exceder 80 caracteres' });
    }

    if (finalVehicleType.length > 50) {
      return res.status(400).json({ error: 'El tipo de vehículo no puede exceder 50 caracteres' });
    }

    if (finalLocation && finalLocation.length > 120) {
      return res.status(400).json({ error: 'La ubicación no puede exceder 120 caracteres' });
    }

    if (finalCostCentre && finalCostCentre.length > 80) {
      return res.status(400).json({ error: 'El centro de coste no puede exceder 80 caracteres' });
    }

    const kmValue = kilometers !== undefined ? parseInt(kilometers) : 0;
    if (isNaN(kmValue) || kmValue < 0 || kmValue > 15000000) {
      return res.status(400).json({ error: 'Los kilómetros deben estar entre 0 y 15.000.000' });
    }

    if (req.user.role !== 'admin') {
      centre_id = req.centreIds && req.centreIds.length > 0 ? req.centreIds[0] : null;
    }

    license_plate = normalizePlate(license_plate);

    const validation = validateSpanishPlate(license_plate);
    if (!validation.isValid) {
      return res.status(400).json({ error: validation.error });
    }

    const [existing] = await db.query('SELECT id FROM vehicles WHERE license_plate = ?', [license_plate]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Esta matrícula ya está registrada en el sistema' });
    }

    const validatedStatus = validateVehicleStatus(status);
    if (!validatedStatus.ok) {
      return res.status(400).json({ error: validatedStatus.error });
    }

    if (!['combustion', 'hibrido', 'electrico'].includes(finalEnergyType)) {
      return res.status(400).json({ error: 'Tipo de energía no válido' });
    }

    if (!['vacio', 'medio-vacio', 'medio', 'medio-lleno', 'lleno'].includes(finalFuelLevel)) {
      return res.status(400).json({ error: 'Nivel de combustible no válido' });
    }

    const [result] = await db.query(
      `INSERT INTO vehicles (
        license_plate, brand, model, vehicle_type, seats, trunk_capacity_l,
        energy_type, fuel_level, location, extras, cost_centre,
        status, kilometers, centre_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        license_plate,
        finalBrand,
        finalModel,
        finalVehicleType,
        finalSeats ?? 5,
        finalTrunkCapacity ?? null,
        finalEnergyType,
        finalFuelLevel,
        finalLocation,
        finalExtras,
        finalCostCentre,
        validatedStatus.status,
        kmValue,
        centre_id || null
      ]
    );

    await auditLogger.logAction(req.user.id, 'CREATE', 'vehicles', result.insertId, req.user.role, {
      license_plate,
      brand: finalBrand,
      model: finalModel,
      vehicle_type: finalVehicleType,
      seats: finalSeats ?? 5,
      trunk_capacity_l: finalTrunkCapacity ?? null,
      energy_type: finalEnergyType,
      fuel_level: finalFuelLevel,
      location: finalLocation,
      extras: finalExtras,
      cost_centre: finalCostCentre,
      status: validatedStatus.status,
      kilometers: kmValue
    });

    res.status(201).json({ id: result.insertId, message: 'Vehículo creado exitosamente' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al crear vehículo' });
  }
};

exports.updateVehicle = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const { id } = req.params;
    let {
      license_plate,
      brand,
      model,
      vehicle_type,
      seats,
      trunk_capacity_l,
      energy_type,
      fuel_level,
      location,
      extras,
      cost_centre,
      status,
      kilometers,
      centre_id,
    } = req.body;
    const isCentreManagementScope = req.user?.role === 'supervisor' && req.query?.scope === 'centres';

    if (isCentreManagementScope) {
      if (
        license_plate !== undefined ||
        brand !== undefined ||
        model !== undefined ||
        vehicle_type !== undefined ||
        seats !== undefined ||
        trunk_capacity_l !== undefined ||
        energy_type !== undefined ||
        fuel_level !== undefined ||
        location !== undefined ||
        extras !== undefined ||
        cost_centre !== undefined ||
        status !== undefined ||
        kilometers !== undefined
      ) {
        await connection.rollback();
        return res.status(403).json({ error: 'En gestión de centros solo se puede cambiar el centro del vehículo' });
      }
    } else if (req.user.role !== 'admin') {
      centre_id = undefined;
    }

    const [existing] = await connection.query('SELECT * FROM vehicles WHERE id = ?', [id]);
    if (existing.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Vehículo no encontrado' });
    }

    const current = existing[0];
    const finalBrand = brand !== undefined ? normalizeNullableText(brand) : normalizeNullableText(current.brand);
    const finalModel = model !== undefined ? String(model ?? '').trim() : String(current.model ?? '').trim();
    const finalVehicleType = vehicle_type !== undefined ? normalizeNullableText(vehicle_type) : normalizeNullableText(current.vehicle_type) || 'turismo';
    const finalSeatsRaw = seats !== undefined ? normalizeOptionalInteger(seats) : normalizeOptionalInteger(current.seats);
    const finalTrunkCapacityRaw = trunk_capacity_l !== undefined ? normalizeOptionalInteger(trunk_capacity_l) : normalizeOptionalInteger(current.trunk_capacity_l);
    const finalEnergyType = energy_type !== undefined ? normalizeNullableText(energy_type) : normalizeNullableText(current.energy_type) || 'combustion';
    const finalFuelLevel = fuel_level !== undefined ? normalizeNullableText(fuel_level) : normalizeNullableText(current.fuel_level) || 'medio';
    const finalLocation = location !== undefined ? normalizeNullableText(location) : normalizeNullableText(current.location);
    const finalExtras = extras !== undefined ? normalizeNullableText(extras) : normalizeNullableText(current.extras);
    const finalCostCentre = cost_centre !== undefined ? normalizeNullableText(cost_centre) : normalizeNullableText(current.cost_centre);
    const finalLicensePlate = license_plate ? normalizePlate(license_plate) : current.license_plate;
    const finalStatus = status !== undefined ? validateVehicleStatus(status) : { ok: true, status: normalizeVehicleStatusInput(current.status) };
    if (!finalStatus.ok) {
      await connection.rollback();
      return res.status(400).json({ error: finalStatus.error });
    }
    const finalKilometersRaw = kilometers !== undefined ? kilometers : current.kilometers;
    const finalKilometers = parseInt(finalKilometersRaw);
    const finalCentreId = centre_id !== undefined ? centre_id : current.centre_id;

    if (!finalBrand || !finalModel) {
      await connection.rollback();
      return res.status(400).json({ error: 'La marca y el modelo son obligatorios' });
    }

    if (finalBrand.length > 80) {
      await connection.rollback();
      return res.status(400).json({ error: 'La marca no puede exceder 80 caracteres' });
    }

    if (finalModel.length > 60) {
      await connection.rollback();
      return res.status(400).json({ error: 'El modelo no puede exceder 60 caracteres' });
    }

    if (finalVehicleType && finalVehicleType.length > 50) {
      await connection.rollback();
      return res.status(400).json({ error: 'El tipo de vehículo no puede exceder 50 caracteres' });
    }

    if (finalLocation && finalLocation.length > 120) {
      await connection.rollback();
      return res.status(400).json({ error: 'La ubicación no puede exceder 120 caracteres' });
    }

    if (finalCostCentre && finalCostCentre.length > 80) {
      await connection.rollback();
      return res.status(400).json({ error: 'El centro de coste no puede exceder 80 caracteres' });
    }

    if (isNaN(finalKilometers) || finalKilometers < 0 || finalKilometers > 15000000) {
      await connection.rollback();
      return res.status(400).json({ error: 'Los kilómetros deben estar entre 0 y 15.000.000' });
    }

    if (!['combustion', 'hibrido', 'electrico'].includes(finalEnergyType)) {
      await connection.rollback();
      return res.status(400).json({ error: 'Tipo de energía no válido' });
    }

    if (!['vacio', 'medio-vacio', 'medio', 'medio-lleno', 'lleno'].includes(finalFuelLevel)) {
      await connection.rollback();
      return res.status(400).json({ error: 'Nivel de combustible no válido' });
    }

    if (license_plate) {
      const validation = validateSpanishPlate(finalLicensePlate);
      if (!validation.isValid) {
        await connection.rollback();
        return res.status(400).json({ error: validation.error });
      }

      const [dupe] = await connection.query('SELECT id FROM vehicles WHERE license_plate = ? AND id != ?', [finalLicensePlate, id]);
      if (dupe.length > 0) {
        await connection.rollback();
        return res.status(400).json({ error: 'Esta matrícula ya está registrada en otro vehículo' });
      }
    }

    await connection.query(
      `UPDATE vehicles SET
        license_plate = ?,
        brand = ?,
        model = ?,
        vehicle_type = ?,
        seats = ?,
        trunk_capacity_l = ?,
        energy_type = ?,
        fuel_level = ?,
        location = ?,
        extras = ?,
        cost_centre = ?,
        status = ?,
        kilometers = ?,
        centre_id = ?
      WHERE id = ?`,
      [
        finalLicensePlate,
        finalBrand,
        finalModel,
        finalVehicleType,
        finalSeatsRaw ?? 5,
        finalTrunkCapacityRaw ?? null,
        finalEnergyType,
        finalFuelLevel,
        finalLocation,
        finalExtras,
        finalCostCentre,
        finalStatus.status,
        finalKilometers,
        finalCentreId,
        id
      ]
    );

    if (finalStatus.status === 'en-taller' || finalStatus.status === 'no-disponible') {
      const reason = finalStatus.status === 'en-taller' ? 'Vehículo enviado a taller' : 'Vehículo no disponible por incidencia/mantenimiento';
      await rejectReservationsForVehicle(connection, id, reason, req.user.id, req.user.role);
    }

    const vehiclePrevious = {
      license_plate: current.license_plate,
      brand: current.brand,
      model: current.model,
      vehicle_type: current.vehicle_type,
      seats: current.seats,
      trunk_capacity_l: current.trunk_capacity_l,
      energy_type: current.energy_type,
      fuel_level: current.fuel_level,
      location: current.location,
      extras: current.extras,
      cost_centre: current.cost_centre,
      status: current.status,
      kilometers: current.kilometers
    };

    const vehicleCurrent = {
      license_plate: finalLicensePlate,
      brand: finalBrand,
      model: finalModel,
      vehicle_type: finalVehicleType,
      seats: finalSeatsRaw ?? 5,
      trunk_capacity_l: finalTrunkCapacityRaw ?? null,
      energy_type: finalEnergyType,
      fuel_level: finalFuelLevel,
      location: finalLocation,
      extras: finalExtras,
      cost_centre: finalCostCentre,
      status: finalStatus.status,
      kilometers: finalKilometers
    };

    const vehicleChanges = {
      license_plate: { from: vehiclePrevious.license_plate, to: vehicleCurrent.license_plate },
      brand: { from: vehiclePrevious.brand, to: vehicleCurrent.brand },
      model: { from: vehiclePrevious.model, to: vehicleCurrent.model },
      vehicle_type: { from: vehiclePrevious.vehicle_type, to: vehicleCurrent.vehicle_type },
      seats: { from: vehiclePrevious.seats, to: vehicleCurrent.seats },
      trunk_capacity_l: { from: vehiclePrevious.trunk_capacity_l, to: vehicleCurrent.trunk_capacity_l },
      energy_type: { from: vehiclePrevious.energy_type, to: vehicleCurrent.energy_type },
      fuel_level: { from: vehiclePrevious.fuel_level, to: vehicleCurrent.fuel_level },
      location: { from: vehiclePrevious.location, to: vehicleCurrent.location },
      extras: { from: vehiclePrevious.extras, to: vehicleCurrent.extras },
      cost_centre: { from: vehiclePrevious.cost_centre, to: vehicleCurrent.cost_centre },
      status: { from: vehiclePrevious.status, to: vehicleCurrent.status },
      kilometers: { from: vehiclePrevious.kilometers, to: vehicleCurrent.kilometers }
    };

    const modifiedFields = Object.keys(vehicleChanges).filter(
      (k) => vehicleChanges[k].from !== vehicleChanges[k].to
    );

    await auditLogger.logAction(req.user.id, 'UPDATE', 'vehicles', id, req.user.role, {
      action: 'vehicle_update',
      registro_id: id,
      previous: vehiclePrevious,
      current: vehicleCurrent,
      changes: vehicleChanges,
      modifiedFields
    });

    await connection.commit();
    res.json({ message: 'Vehículo actualizado exitosamente' });
  } catch (error) {
    await connection.rollback();
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar vehículo' });
  } finally {
    connection.release();
  }
};

exports.deleteVehicle = async (req, res) => {
  try {
    const { id } = req.params;

    // Cargar datos antes de eliminar
    const [existing] = await db.query('SELECT license_plate, brand, model FROM vehicles WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Vehículo no encontrado' });
    }

    const deletedVehicle = existing[0];

    const [result] = await db.query('DELETE FROM vehicles WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Vehículo no encontrado' });
    }

    // Obtener username real del usuario que hace la eliminación
    const [userRows] = await db.query('SELECT username FROM users WHERE id = ?', [req.user.id]);
    const deletedByUsername = userRows.length > 0 ? userRows[0].username : `id:${req.user.id}`;

    // Registrar auditoría de eliminación de vehículo
    await auditLogger.logAction(req.user.id, 'DELETE', 'vehicles', id, req.user.role, {
      action: 'Vehículo eliminado',
      license_plate: deletedVehicle.license_plate,
      brand: deletedVehicle.brand,
      model: deletedVehicle.model,
      label: formatVehicleLabel(deletedVehicle),
      deleted_by: deletedByUsername
    });

    res.json({ message: 'Vehículo eliminado exitosamente' });
  } catch (error) {
    console.error(error);
    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ error: 'No se puede eliminar porque este vehículo tiene reservas asociadas' });
    }
    res.status(500).json({ error: 'Error al eliminar vehículo' });
  }
};

// Funciones para gestionar usuarios (CRUD)
// Obtener todos los usuarios aunque los eliminados aparecerán con un campo "deleted_at" no nulo para diferenciarlos,
//  pero no se borran físicamente de la base de datos para mantener la integridad referencial y la trazabilidad histórica.
exports.getUsers = async (req, res) => {
  try {
    const isCentreManagementScope = req.user?.role === 'supervisor' && req.query?.scope === 'centres';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 50, 100));
    const offset = (page - 1) * limit;
    const search = req.query.search ? `%${req.query.search}%` : null;
    const searchClause = search ? ' AND (u.username LIKE ? OR u.role LIKE ?)' : '';
    const USER_SORT_MAP = { username: 'u.username', role: 'u.role', created_at: 'u.created_at' };
    const uSortCol = USER_SORT_MAP[req.query.sortBy] || 'u.id';
    const uSortDir = req.query.sortDir === 'asc' ? 'ASC' : 'DESC';

    let query = `
      SELECT u.id, u.username, u.role, u.created_at, u.deleted_at,
             GROUP_CONCAT(DISTINCT uc.centre_id ORDER BY uc.centre_id SEPARATOR ',') as centre_ids,
             GROUP_CONCAT(DISTINCT c.nombre ORDER BY c.nombre SEPARATOR '||') as centre_names
      FROM users u
      LEFT JOIN user_centres uc ON u.id = uc.user_id
      LEFT JOIN centres c ON uc.centre_id = c.id
      WHERE u.deleted_at IS NULL${searchClause}
    `;
    let params = search ? [search, search] : [];

    if (!isCentreManagementScope && req.centreIds !== null) {
      if (req.centreIds.length === 0) return res.status(200).json([]);
      const inClause = req.centreIds.map(() => '?').join(',');
      query = `
        SELECT u.id, u.username, u.role, u.created_at, u.deleted_at,
               GROUP_CONCAT(DISTINCT uc.centre_id ORDER BY uc.centre_id SEPARATOR ',') as centre_ids,
               GROUP_CONCAT(DISTINCT c.nombre ORDER BY c.nombre SEPARATOR '||') as centre_names
        FROM users u
        JOIN user_centres auth_uc ON u.id = auth_uc.user_id
        LEFT JOIN user_centres uc ON u.id = uc.user_id
        LEFT JOIN centres c ON uc.centre_id = c.id
        WHERE u.deleted_at IS NULL AND auth_uc.centre_id IN (${inClause})${searchClause}
      `;
      params = search ? [...req.centreIds, search, search] : req.centreIds;
    }

    const baseQuery = `${query} GROUP BY u.id`;
    const [countRows] = await db.query(`SELECT COUNT(*) as total FROM (${baseQuery}) as user_count`, params);
    const totalRecords = countRows?.[0]?.total || 0;
    const totalPages = Math.ceil(totalRecords / limit);

    query += ` GROUP BY u.id ORDER BY ${uSortCol} ${uSortDir} LIMIT ? OFFSET ?`;
    const [rows] = await db.query(query, [...params, limit, offset]);

    const formattedRows = rows.map(r => ({
      ...r,
      centre_ids: r.centre_ids ? r.centre_ids.split(',').map(Number) : [],
      centre_names: r.centre_names ? r.centre_names.split('||').filter(Boolean) : []
    }));

    if (req.query.page || req.query.limit) {
      return res.status(200).json({
        data: formattedRows,
        pagination: { currentPage: page, totalPages, totalRecords, recordsPerPage: limit }
      });
    }

    res.status(200).json(formattedRows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener los usuarios' });
  }
};

exports.createUser = async (req, res) => {
  try {
    const { username, password, role, centre_ids } = req.body;
    if (!username || !password || !role) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const [result] = await db.query(
      'INSERT INTO users (username, password, role, auth_provider) VALUES (?, ?, ?, ?)',
      [username, hashedPassword, role, 'local']
    );

    if (centre_ids && Array.isArray(centre_ids) && centre_ids.length > 0) {
      const values = centre_ids.map(cid => [result.insertId, cid]);
      await db.query('INSERT INTO user_centres (user_id, centre_id) VALUES ?', [values]);
    }

    // Registrar auditoría de creación de usuario
    await auditLogger.logAction(req.user.id, 'CREATE', 'users', result.insertId, req.user.role, {
      username: username,
      role: role,
      action: 'Nuevo usuario creado'
    });

    // Emitir evento de nuevo usuario a todos los admins
    const io = getIO();
    io.to('admin_dashboard').emit('new_user', {
      id: result.insertId,
      username: username,
      role: role,
      centre_ids: centre_ids ?? [],
      created_at: new Date()
    });

    res.status(201).json({ id: result.insertId, message: 'Usuario creado exitosamente' });
  } catch (error) {
    console.error(error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'El nombre de usuario ya existe' });
    }
    res.status(500).json({ error: 'Error al crear usuario' });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { username, password, role, centre_ids } = req.body;
    const isSupervisor = req.user?.role === 'supervisor';

    if (isSupervisor && (username || password || role)) {
      return res.status(403).json({ error: 'Los supervisores solo pueden modificar los centros asignados al usuario' });
    }

    if (isSupervisor && !Array.isArray(centre_ids)) {
      return res.status(400).json({ error: 'Debes indicar los centros asignados al usuario' });
    }

    // Obtener valores previos
    const [existingUsers] = await db.query('SELECT username, role, auth_provider FROM users WHERE id = ? AND deleted_at IS NULL', [id]);
    if (existingUsers.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    const previousUser = existingUsers[0];
    const nextUsername = username ?? previousUser.username;
    const nextRole = role ?? previousUser.role;

    if (isSupervisor) {
      await db.query('DELETE FROM user_centres WHERE user_id = ?', [id]);
      if (centre_ids.length > 0) {
        const values = centre_ids.map(cid => [id, cid]);
        await db.query('INSERT INTO user_centres (user_id, centre_id) VALUES ?', [values]);
      }

      await auditLogger.logAction(req.user.id, 'UPDATE', 'users', id, req.user.role, {
        previous: previousUser,
        current: {
          username: previousUser.username,
          role: previousUser.role,
          centre_ids,
        },
        changes: {
          centre_ids: {
            from: 'actual',
            to: centre_ids,
          },
        },
        modifiedFields: ['centre_ids']
      });

      const io = getIO();
      io.to('admin_dashboard').emit('updated_user', {
        id: Number(id),
        username: previousUser.username,
        role: previousUser.role,
        centre_ids,
        previousRole: previousUser.role,
        changedFields: ['centre_ids']
      });

      return res.json({ message: 'Centros del usuario actualizados exitosamente' });
    }

    // Si envían contraseña nueva, la hasheamos. Si no, solo actualizamos usuario y rol.
    let query, params;
    let passwordChanged = false;
    if (password) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      query = 'UPDATE users SET username = ?, password = ?, role = ?, auth_provider = ? WHERE id = ? AND deleted_at IS NULL';
      const authProvider = existingUsers[0].auth_provider || 'local';
      params = [nextUsername, hashedPassword, nextRole, authProvider, id];
      passwordChanged = true;
    } else {
      query = 'UPDATE users SET username = ?, role = ?, auth_provider = ? WHERE id = ? AND deleted_at IS NULL';
      params = [nextUsername, nextRole, existingUsers[0].auth_provider || 'local', id];
    }

    const [result] = await db.query(query, params);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (centre_ids && Array.isArray(centre_ids)) {
      await db.query('DELETE FROM user_centres WHERE user_id = ?', [id]);
      if (centre_ids.length > 0) {
        const values = centre_ids.map(cid => [id, cid]);
        await db.query('INSERT INTO user_centres (user_id, centre_id) VALUES ?', [values]);
      }
    }

    const currentUser = {
      username: nextUsername,
      role: nextRole
    };

    const userChanges = {
      username: {
        from: previousUser.username,
        to: currentUser.username
      },
      role: {
        from: previousUser.role,
        to: currentUser.role
      },
      password: {
        from: passwordChanged ? '*****' : 'sin cambio',
        to: passwordChanged ? '*****' : 'sin cambio'
      }
    };

    const modifiedFields = Object.keys(userChanges).filter((key) => {
      if (key === 'password') return passwordChanged;
      return userChanges[key].from !== userChanges[key].to;
    });

    // Registrar auditoría de actualización de usuario
    await auditLogger.logAction(req.user.id, 'UPDATE', 'users', id, req.user.role, {
      previous: previousUser,
      current: currentUser,
      changes: userChanges,
      modifiedFields
    });

    // Emitir evento de usuario actualizado a todos los admins
    const io = getIO();
    io.to('admin_dashboard').emit('updated_user', {
      id: id,
      username: nextUsername,
      role: nextRole,
      centre_ids: centre_ids ?? [],
      previousRole: previousUser.role,
      changedFields: modifiedFields
    });

    res.json({ message: 'Usuario actualizado exitosamente' });
  } catch (error) {
    console.error(error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'El nombre de usuario ya existe' });
    }
    res.status(500).json({ error: 'Error al actualizar usuario' });
  }
};

exports.deleteUser = async (req, res) => {
  const id = req.params.id;
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    // Identificar qué vehículos están afectados por las reservas de este usuario antes de borrarlas
    const [reservationsToDrop] = await connection.query('SELECT vehicle_id, status FROM reservations WHERE user_id = ?', [id]);

    // Borrar validaciones asociadas a las reservas del usuario
    await connection.query(`
      DELETE v FROM validations v
      INNER JOIN reservations r ON v.reservation_id = r.id
      WHERE r.user_id = ?
    `, [id]);

    // Borrar las reservas del usuario
    await connection.query('DELETE FROM reservations WHERE user_id = ?', [id]);

    // Actualizar el estado de los vehículos a 'disponible' para las reservas que no estaban finalizadas
    const uniqueVehicleIds = [...new Set((reservationsToDrop || []).map((r) => r.vehicle_id).filter((vehicleId) => vehicleId !== null && vehicleId !== undefined))];
    for (const vehicleId of uniqueVehicleIds) {
      // eslint-disable-next-line no-await-in-loop
      await syncVehicleStatusFromReservations(connection, vehicleId);
    }

    // Desasignar centros del usuario antes del soft delete
    await connection.query('DELETE FROM user_centres WHERE user_id = ?', [id]);

    // Soft delete del usuario — se libera el username añadiendo sufijo para permitir recrearlo
    const [result] = await connection.query(
      'UPDATE users SET deleted_at = NOW(), username = CONCAT(username, ?, id) WHERE id = ? AND deleted_at IS NULL',
      ['__deleted_', id]
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    await connection.commit();

    // Registrar auditoría de eliminación de usuario
    try {
      await auditLogger.logAction(req.user.id, 'DELETE', 'users', id, req.user.role, {
        action: 'Usuario eliminado (soft delete)'
      });
    } catch (auditError) {
      console.error('Error registrando auditoría de eliminación de usuario:', auditError);
    }

    // Emitir evento de usuario eliminado a todos los admins
    const io = getIO();
    io.to('admin_dashboard').emit('deleted_user', { id });

    res.status(200).json({ message: 'Usuario y sus reservas eliminados' });
  } catch (error) {
    try {
      await connection.rollback();
    } catch { }
    console.error(error);
    res.status(500).json({ error: 'Error al eliminar al usuario y sus datos' });
  } finally {
    connection.release();
  }
};

// --- GESTIÓN DE DOCUMENTOS DE VEHÍCULOS ---
exports.getVehicleDocuments = async (req, res) => {
  try {
    const { id } = req.params;

    if (req.centreIds !== null) {
      const [vehicle] = await db.query('SELECT centre_id FROM vehicles WHERE id = ?', [id]);
      if (vehicle.length === 0 || !req.centreIds.includes(vehicle[0].centre_id)) {
        return res.status(403).json({ error: 'No tienes permiso para ver los documentos de este vehículo' });
      }
    }

    const [rows] = await db.query(
      'SELECT id, type, expiration_date, original_name, upload_date, file_path FROM documents WHERE vehicle_id = ? ORDER BY upload_date DESC',
      [id]
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener documentos del vehículo' });
  }
};

exports.serveDocument = async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar permisos si el usuario tiene centros asignados
    if (req.user.role !== 'admin' && req.centreIds !== null) {
      const [vehicle] = await db.query(
        'SELECT v.centre_id FROM vehicles v JOIN documents d ON v.id = d.vehicle_id WHERE d.id = ?',
        [id]
      );
      if (vehicle.length === 0 || !req.centreIds.includes(vehicle[0].centre_id)) {
        return res.status(403).json({ error: 'No tienes permiso para ver este documento' });
      }
    }

    const [rows] = await db.query('SELECT file_path, original_name FROM documents WHERE id = ?', [id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Documento no encontrado' });
    }

    const { file_path, original_name } = rows[0];
    if (!file_path) {
      return res.status(404).json({ error: 'Este documento no tiene un archivo asociado' });
    }

    const absolutePath = path.join(__dirname, '../uploads/documents', file_path);
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: 'Archivo físico no encontrado en el servidor' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    // Para que se abra en el navegador e incluya el nombre si se descarga
    res.setHeader('Content-Disposition', `inline; filename="${original_name}"`);
    res.sendFile(absolutePath);
  } catch (error) {
    console.error('Error al servir el documento:', error);
    res.status(500).json({ error: 'Error al servir el documento' });
  }
};

exports.uploadVehicleDocument = (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    try {
      const { id } = req.params;
      const { type, expiration_date, original_name } = req.body;

      if (!type || !expiration_date || !original_name) {
        // Si el admin subió un archivo pero olvidó llenar los campos, borramos el archivo para no dejar basura
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'El tipo, nombre y fecha de vencimiento son obligatorios' });
      }

      const filePath = req.file ? req.file.filename : null;

      const [vehicleRows] = await db.query('SELECT brand, model, license_plate FROM vehicles WHERE id = ?', [id]);
      const vehiculoInfo = vehicleRows.length > 0
        ? formatVehicleLabel(vehicleRows[0])
        : `ID: ${id}`;

      const [result] = await db.query(
        'INSERT INTO documents (vehicle_id, type, expiration_date, file_path, original_name) VALUES (?, ?, ?, ?, ?)',
        [id, type, expiration_date, filePath, original_name]
      );

      // Si es un documento de parte de taller, resetear el contador de km acumulados
      if (type === 'parte-taller') {
        await db.query('UPDATE vehicles SET km_taller_acumulados = 0 WHERE id = ?', [id]);
      }

      // Registrar auditoría de subida de documento (no bloqueante)
      try {
        await auditLogger.logAction(req.user.id, 'CREATE', 'documents', result.insertId, req.user.role, {
          vehicle_id: id,
          vehiculo: vehiculoInfo,
          type: type,
          original_name: original_name,
          expiration_date: expiration_date,
          file: filePath,
          km_taller_reset: type === 'parte-taller'
        });
      } catch (auditError) {
        console.error('Fallo no bloqueante en auditoría (CREATE document):', auditError);
      }

      res.status(201).json({
        id: result.insertId,
        message: req.file ? 'Documento y archivo guardados' : 'Registro creado sin archivo',
        document: {
          id: result.insertId,
          type,
          expiration_date,
          original_name
        }
      });
    } catch (error) {
      console.error(error);
      if (req.file) fs.unlinkSync(req.file.path);
      res.status(500).json({ error: 'Error al registrar el documento' });
    }
  });
};

exports.deleteVehicleDocument = async (req, res) => {
  try {
    const { id } = req.params;

    // Primero obtener el documento sin JOIN para evitar que falle si vehicle_id es NULL
    const [documentCheck] = await db.query('SELECT * FROM documents WHERE id = ?', [id]);

    if (!documentCheck || documentCheck.length === 0) {
      return res.status(404).json({ error: 'Documento no encontrado' });
    }

    const document = documentCheck[0];

    // Obtener info del vehículo si existe
    let vehiculoInfo = 'Vehículo desconocido';
    if (document.vehicle_id) {
      const [vehicleData] = await db.query(
        'SELECT brand, model, license_plate FROM vehicles WHERE id = ?',
        [document.vehicle_id]
      );
      if (vehicleData && vehicleData.length > 0) {
        vehiculoInfo = formatVehicleLabel(vehicleData[0]);
      }
    }

    // Eliminar el documento
    await db.query('DELETE FROM documents WHERE id = ?', [id]);

    // Registrar auditoría de eliminación de documento (no bloqueante)
    try {
      await auditLogger.logAction(req.user.id, 'DELETE', 'documents', id, req.user.role, {
        vehicle_id: document.vehicle_id,
        vehiculo: vehiculoInfo,
        document_type: document.type,
        original_name: document.original_name,
        file_path: document.file_path,
        action: 'Documento eliminado'
      });
    } catch (auditError) {
      console.error('Fallo no bloqueante en auditoría (DELETE document):', auditError);
    }

    // Eliminar archivo del disco si existe
    if (document.file_path) {
      const filePath = path.join(__dirname, '../uploads/documents', document.file_path);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          console.error('Error deleting file from disk:', e);
        }
      }
    }

    res.json({ message: 'Documento eliminado correctamente' });
  } catch (error) {
    console.error('Error in deleteVehicleDocument:', {
      message: error.message,
      stack: error.stack,
      docId: req.params.id
    });
    res.status(500).json({ error: 'Error al eliminar el documento: ' + error.message });
  }
};

exports.updateVehicleDocument = (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    try {
      const { id } = req.params;
      const { type, expiration_date, original_name } = req.body;

      if (!type || !expiration_date || !original_name) {
        // Si el admin subió un archivo pero olvidó llenar los campos, borramos el archivo
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Todos los campos son obligatorios' });
      }

      const [existingDocs] = await db.query('SELECT type, expiration_date, original_name, file_path, vehicle_id FROM documents WHERE id = ?', [id]);
      if (existingDocs.length === 0) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(404).json({ error: 'Documento no encontrado' });
      }

      const previousDoc = existingDocs[0];
      const oldFilePath = previousDoc.file_path;

      // Si hay un archivo nuevo, eliminar el antiguo
      if (req.file && oldFilePath) {
        const fileToDeletePath = path.join(__dirname, '../uploads/documents', oldFilePath);
        if (fs.existsSync(fileToDeletePath)) {
          try {
            fs.unlinkSync(fileToDeletePath);
          } catch (e) {
            console.error('Error deleting old file:', e);
          }
        }
      }

      // Preparar el nuevo file_path
      const newFilePath = req.file ? req.file.filename : oldFilePath;

      // Actualizar documento
      await db.query(
        'UPDATE documents SET type = ?, expiration_date = ?, original_name = ?, file_path = ? WHERE id = ?',
        [type, expiration_date, original_name, newFilePath, id]
      );

      // Si es o se cambió a documento de parte de taller, resetear el contador de km acumulados
      if (type === 'parte-taller') {
        await db.query('UPDATE vehicles SET km_taller_acumulados = 0 WHERE id = ?', [previousDoc.vehicle_id]);
      }

      const currentDoc = {
        type,
        expiration_date,
        original_name,
        file_path: newFilePath
      };

      const changes = {
        type: { from: previousDoc.type, to: currentDoc.type },
        expiration_date: { from: previousDoc.expiration_date, to: currentDoc.expiration_date },
        original_name: { from: previousDoc.original_name, to: currentDoc.original_name }
      };

      if (req.file) {
        changes.file = { from: previousDoc.file_path, to: newFilePath };
      }

      const modifiedFields = Object.keys(changes).filter(key => changes[key].from !== changes[key].to);

      // Obtener info del vehículo para el audit
      const [vehicleRows] = await db.query('SELECT brand, model, license_plate FROM vehicles WHERE id = ?', [previousDoc.vehicle_id]);
      const vehiculoInfo = vehicleRows.length > 0
        ? formatVehicleLabel(vehicleRows[0])
        : `ID: ${previousDoc.vehicle_id}`;

      // Registrar auditoría de actualización de documento (no bloqueante)
      try {
        await auditLogger.logAction(req.user.id, 'UPDATE', 'documents', id, req.user.role, {
          vehicle_id: previousDoc.vehicle_id,
          vehiculo: vehiculoInfo,
          previous: previousDoc,
          current: currentDoc,
          changes,
          modifiedFields,
          fileUpdated: !!req.file,
          km_taller_reset: type === 'parte-taller'
        });
      } catch (auditError) {
        console.error('Fallo no bloqueante en auditoría (UPDATE document):', auditError);
      }

      res.json({
        message: 'Documento actualizado correctamente',
        document: {
          id,
          type,
          expiration_date,
          original_name,
          file_path: newFilePath
        }
      });
    } catch (error) {
      console.error(error);
      if (req.file) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {
          console.error('Error deleting file after error:', e);
        }
      }
      res.status(500).json({ error: 'Error al actualizar el documento' });
    }
  });
};

exports.getValidations = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 50, 100));
    const offset = (page - 1) * limit;
    const search = req.query.search ? `%${req.query.search}%` : null;
    const startDate = req.query.startDate ? req.query.startDate.replace('T', ' ') : null;
    const endDate = req.query.endDate ? req.query.endDate.replace('T', ' ') : null;
    const VALIDATION_SORT_MAP = { username: 'u.username', model: 've.model', created_at: 'v.created_at', status: 'v.status', incidencias: 'v.incidencias' };
    const valSortCol = VALIDATION_SORT_MAP[req.query.sortBy] || 'v.created_at';
    const valSortDir = req.query.sortDir === 'asc' ? 'ASC' : 'DESC';
    let whereClause = '';
    let params = [];
    const isAdmin = req.user && req.user.role === 'admin';

    if (req.centreIds !== null) {
      if (req.centreIds.length === 0) return res.json([]);
      const inClause = req.centreIds.map(() => '?').join(',');
      whereClause = `WHERE ve.centre_id IN (${inClause}) AND v.deleted_at IS NULL AND v.km_entrega IS NOT NULL AND v.km_entrega > 0`;
      params = req.centreIds;
    } else {
      whereClause = 'WHERE v.deleted_at IS NULL AND v.km_entrega IS NOT NULL AND v.km_entrega > 0';
    }

    if (!isAdmin) {
      whereClause += ` AND u.role != 'admin'`;
    }

    if (search) {
      whereClause += ` AND (u.username LIKE ? OR ve.brand LIKE ? OR ve.license_plate LIKE ? OR ve.model LIKE ?)`;
      params.push(search, search, search, search);
    }

    if (startDate) {
      whereClause += ` AND v.created_at >= ?`;
      params.push(startDate);
    }

    if (endDate) {
      whereClause += ` AND v.created_at <= ?`;
      params.push(endDate);
    }

    const countQuery = `
      SELECT COUNT(*) as total
      FROM validations v
      INNER JOIN reservations r ON v.reservation_id = r.id
      INNER JOIN users u ON r.user_id = u.id
      INNER JOIN vehicles ve ON r.vehicle_id = ve.id
      ${whereClause}
    `;
    const [countRows] = await db.query(countQuery, params);
    const totalRecords = countRows?.[0]?.total || 0;
    const totalPages = Math.ceil(totalRecords / limit);

    const [rows] = await db.query(`
      SELECT
        v.id,
        v.km_inicial,
        v.km_entrega,
        v.created_at,
        v.incidencias,
        v.informe_incidencias,
        v.informe_entrega,
        v.informe_superior,
        v.status,
        v.decision_estado,
        v.foto_contador,
        u.username,
        ve.brand,
        ve.license_plate,
        ve.model,
        r.start_time,
        r.end_time
      FROM validations v
      INNER JOIN reservations r ON v.reservation_id = r.id
      INNER JOIN users u ON r.user_id = u.id
      INNER JOIN vehicles ve ON r.vehicle_id = ve.id
      ${whereClause}
      ORDER BY ${valSortCol} ${valSortDir}
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    if (req.query.page || req.query.limit) {
      return res.json({
        data: rows,
        pagination: { currentPage: page, totalPages, totalRecords, recordsPerPage: limit }
      });
    }

    res.json(rows);
  } catch (err) {
    console.error("Error cargando validaciones con JOIN:", err);
    res.status(500).json({ error: "Error en el servidor al obtener validaciones" });
  }
};

exports.deleteValidation = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { id } = req.params;

    if (!id) {
      await connection.rollback();
      return res.status(400).json({ error: 'ID de validación requerido' });
    }

    const [validationRows] = await connection.query(
      'SELECT v.reservation_id, v.deleted_at, r.vehicle_id, r.status AS reservation_status FROM validations v JOIN reservations r ON v.reservation_id = r.id WHERE v.id = ?',
      [id]
    );

    if (validationRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Validación no encontrada' });
    }

    // Soft delete: marcar como eliminada en lugar de borrar físicamente
    // Esto preserva los datos de km_entrega para que el formulario no reaparezca
    const [result] = await connection.query(
      'UPDATE validations SET deleted_at = NOW() WHERE id = ?',
      [id]
    );

    if (!result || result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Validación no encontrada' });
    }

    const affectedValidation = validationRows[0];
    const reservationStatus = normalizeStatus(affectedValidation.reservation_status);

    if (reservationStatus === 'finalizada') {
      await connection.query(
        'UPDATE vehicles SET status = ? WHERE id = ?',
        ['formulario-entrega-pendiente', affectedValidation.vehicle_id]
      );
    }

    await connection.commit();

    // Registrar auditoría de eliminación de validación
    try {
      await auditLogger.logAction(req.user.id, 'DELETE', 'validations', id, req.user.role, {
        action: 'Validación eliminada'
      });
    } catch (auditError) {
      console.error('Error registrando auditoría de eliminación de validación:', auditError);
    }

    res.json({ message: 'Validación eliminada correctamente' });
  } catch (err) {
    try {
      await connection.rollback();
    } catch { }
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar validación' });
  } finally {
    connection.release();
  }
};

exports.updateValidation = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const { id } = req.params;
    const { status, informe_superior, km_entrega, incidencias, informe_incidencias, decision_estado } = req.body;

    if (!id) {
      await connection.rollback();
      return res.status(400).json({ error: 'ID de validación requerido' });
    }

    const [existingValidations] = await connection.query(
      'SELECT v.reservation_id, v.status, v.informe_superior, v.km_entrega, v.km_inicial, v.incidencias, v.informe_incidencias, v.decision_estado, r.vehicle_id FROM validations v JOIN reservations r ON v.reservation_id = r.id WHERE v.id = ? AND v.deleted_at IS NULL',
      [id]
    );
    if (existingValidations.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Validación no encontrada' });
    }

    const previousValidation = existingValidations[0];
    const newStatus = status || 'revisada';
    const normalizedInformeIncidencias = typeof informe_incidencias === 'string'
      ? informe_incidencias.trim()
      : informe_incidencias ?? null;
    let nextKmEntrega = previousValidation.km_entrega;

    if (km_entrega !== undefined) {
      const parsedKm = km_entrega === null ? null : Number.parseInt(km_entrega, 10);
      if (parsedKm !== null && (Number.isNaN(parsedKm) || parsedKm <= 0)) {
        await connection.rollback();
        return res.status(400).json({ error: 'Kilometraje de entrega inválido' });
      }
      nextKmEntrega = parsedKm;
    }

    // Manejar cambios en km_entrega para actualizar km_taller_acumulados
    if (nextKmEntrega !== previousValidation.km_entrega) {
      const oldKmDiff = previousValidation.km_entrega !== undefined && previousValidation.km_entrega !== null
        ? Math.max(0, previousValidation.km_entrega - (previousValidation.km_inicial || 0))
        : 0;

      const newKmDiff = nextKmEntrega !== undefined && nextKmEntrega !== null
        ? Math.max(0, nextKmEntrega - (previousValidation.km_inicial || 0))
        : 0;

      const kmDifference = newKmDiff - oldKmDiff;

      await connection.query(
        'UPDATE vehicles SET km_taller_acumulados = GREATEST(0, km_taller_acumulados + ?) WHERE id = ?',
        [kmDifference, previousValidation.vehicle_id]
      );

      const [vData] = await connection.query('SELECT brand, model, license_plate, km_taller_acumulados, centre_id FROM vehicles WHERE id = ?', [previousValidation.vehicle_id]);
      if (vData.length > 0 && vData[0].km_taller_acumulados >= 15000) {
        const [cData] = await connection.query('SELECT nombre FROM centres WHERE id = ?', [vData[0].centre_id]);
        notifyStaffAboutWorkshop({
          vehicle: {
            model: vData[0].model,
            license_plate: vData[0].license_plate,
            centre_name: cData.length > 0 ? cData[0].nombre : 'Sin centro'
          },
          centreId: vData[0].centre_id
        }).catch(err => console.error('Error enviando notificación de taller:', err));
      }
    }

    await connection.query(
      'UPDATE validations SET status = ?, informe_superior = ?, km_entrega = ?, incidencias = ?, informe_incidencias = ?, decision_estado = ? WHERE id = ?',
      [newStatus, informe_superior, nextKmEntrega, incidencias ? 1 : 0, normalizedInformeIncidencias, decision_estado, id]
    );

    const normalizedDecisionEstado = normalizeStatus(decision_estado);
    const targetStatuses = ['disponible', 'no-disponible', 'en-taller'];
    if (targetStatuses.includes(normalizedDecisionEstado)) {
      await connection.query(
        'UPDATE vehicles SET status = ?, kilometers = ? WHERE id = ?',
        [normalizedDecisionEstado, nextKmEntrega, previousValidation.vehicle_id]
      );

      // Si pasa a no disponible o taller, rechazar reservas futuras/activas
      if (normalizedDecisionEstado === 'no-disponible' || normalizedDecisionEstado === 'en-taller') {
        const reason = normalizedDecisionEstado === 'en-taller' ? 'Vehículo enviado a taller' : 'Vehículo no disponible por incidencia/mantenimiento';
        await rejectReservationsForVehicle(connection, previousValidation.vehicle_id, reason, req.user.id, req.user.role);
      }
    }

    const currentValidation = {
      status: newStatus,
      informe_superior,
      km_entrega: nextKmEntrega,
      incidencias,
      informe_incidencias: normalizedInformeIncidencias,
      decision_estado
    };

    const changes = {
      status: { from: previousValidation.status, to: currentValidation.status },
      informe_superior: { from: previousValidation.informe_superior, to: currentValidation.informe_superior },
      km_entrega: { from: previousValidation.km_entrega, to: currentValidation.km_entrega },
      incidencias: { from: previousValidation.incidencias, to: currentValidation.incidencias },
      informe_incidencias: { from: previousValidation.informe_incidencias, to: currentValidation.informe_incidencias },
      decision_estado: { from: previousValidation.decision_estado, to: currentValidation.decision_estado }
    };

    const modifiedFields = Object.keys(changes).filter(key => String(changes[key].from) !== String(changes[key].to));

    await auditLogger.logAction(req.user.id, 'UPDATE', 'validations', id, req.user.role, {
      previous: previousValidation,
      current: currentValidation,
      changes,
      modifiedFields
    });

    await connection.commit();
    res.json({ message: 'Validación actualizada correctamente' });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error('Error actualizando validación:', err);
    res.status(500).json({ error: 'Error al actualizar la validación' });
  } finally {
    connection.release();
  }
};

// Endpoint para resetear manualmente el contador de km de taller de un vehículo
exports.resetWorkshopKilometerCounter = async (req, res) => {
  try {
    const { vehicleId } = req.params;

    if (!vehicleId) {
      return res.status(400).json({ error: 'ID de vehículo requerido' });
    }

    const [vehicleRows] = await db.query('SELECT id, brand, model, license_plate FROM vehicles WHERE id = ?', [vehicleId]);

    if (vehicleRows.length === 0) {
      return res.status(404).json({ error: 'Vehículo no encontrado' });
    }

    const vehicle = vehicleRows[0];
    const vehiculoInfo = formatVehicleLabel(vehicle);

    // Resetear contador
    await db.query('UPDATE vehicles SET km_taller_acumulados = 0 WHERE id = ?', [vehicleId]);

    // Registrar auditoría
    try {
      await auditLogger.logAction(req.user.id, 'UPDATE', 'vehicles', vehicleId, req.user.role, {
        vehiculo: vehiculoInfo,
        action: 'Contador de kilómetros de taller reseteado manualmente',
        km_taller_acumulados: 'reset to 0'
      });
    } catch (auditError) {
      console.error('Fallo no bloqueante en auditoría:', auditError);
    }

    res.json({
      message: `Contador de parte de taller reseteado para ${vehiculoInfo}`,
      vehicleId,
      km_taller_acumulados: 0
    });
  } catch (error) {
    console.error('Error reseteando contador de taller:', error);
    res.status(500).json({ error: 'Error al resetear el contador' });
  }
};


