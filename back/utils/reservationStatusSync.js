const db = require('../config/db');
const { parseMySqlDateTime } = require('./dateTime');
const { sendReservationNotification } = require('./reservationMailer');
const { markReservationMailSent } = require('./reservationMailState');

const normalizeStatus = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, '-');

const getDesiredReservationStatusForTime = (reservation, now = new Date()) => {
  const current = normalizeStatus(reservation?.status);
  if (current !== 'aprobada' && current !== 'activa') return null;

  const start = parseMySqlDateTime(reservation?.start_time);
  const end = parseMySqlDateTime(reservation?.end_time);
  if (!start || !end) return null;

  if (start <= now && now <= end) return 'activa';
  if (now > end) return 'finalizada';

  return null;
};

const syncVehicleStatusFromReservations = async (connection, vehicleId) => {
  const [vehicleRows] = await connection.query('SELECT status, km_taller_acumulados FROM vehicles WHERE id = ?', [vehicleId]);
  if (vehicleRows.length === 0) return null;

  const currentVehicleStatus = normalizeStatus(vehicleRows[0].status);
  const kmTallerAcumulados = vehicleRows[0].km_taller_acumulados || 0;

  // Estos estados solo pueden cambiar por acción explícita del usuario
  if (currentVehicleStatus === 'pendiente-validacion' ||
    currentVehicleStatus === 'formulario-entrega-pendiente' ||
    currentVehicleStatus === 'no-disponible' ||
    currentVehicleStatus === 'en-taller') {
    return null;
  }

  const [reservationRows] = await connection.query(
    'SELECT status FROM reservations WHERE vehicle_id = ?',
    [vehicleId]
  );

  const statuses = Array.isArray(reservationRows)
    ? reservationRows.map((row) => normalizeStatus(row.status))
    : [];

  let desiredStatus = 'disponible';

  if (statuses.some((status) => status === 'activa')) {
    desiredStatus = 'en-uso';
  }
  else if (statuses.some((status) => status === 'finalizada')) {
    desiredStatus = 'formulario-entrega-pendiente';
  }
  else if (statuses.some((status) => status === 'pendiente' || status === 'aprobada')) {
    desiredStatus = 'reservado';
  }

  if (currentVehicleStatus !== desiredStatus) {
    await connection.query('UPDATE vehicles SET status = ? WHERE id = ?', [desiredStatus, vehicleId]);
  }

  return desiredStatus;
};

const syncReservationStatusesByTime = async () => {
  const connection = await db.getConnection();
  const touchedVehicleIds = new Set();
  const updatedReservations = [];

  try {
    await connection.beginTransaction();

    const [reservations] = await connection.query(`
      SELECT
        r.id,
        r.vehicle_id,
        r.user_id,
        r.status,
        r.start_time,
        r.end_time,
        u.username,
        v.brand,
        v.license_plate,
        v.model,
        c.nombre AS centre_name,
        v.centre_id,
        val.km_entrega
      FROM reservations r
      JOIN users u ON r.user_id = u.id
      JOIN vehicles v ON r.vehicle_id = v.id
      LEFT JOIN centres c ON v.centre_id = c.id
      LEFT JOIN validations val ON r.id = val.reservation_id AND val.deleted_at IS NULL
      WHERE r.status IN ('aprobada', 'activa')
    `);

    const now = new Date();
    const mailNotifications = [];

    for (const reservation of Array.isArray(reservations) ? reservations : []) {
      const desiredStatus = getDesiredReservationStatusForTime(reservation, now);
      if (!desiredStatus) continue;

      const currentStatus = normalizeStatus(reservation.status);
      if (currentStatus === desiredStatus) continue;

      // eslint-disable-next-line no-await-in-loop
      await connection.query(
        'UPDATE reservations SET status = ? WHERE id = ?',
        [desiredStatus, reservation.id]
      );

      updatedReservations.push({
        id: reservation.id,
        vehicle_id: reservation.vehicle_id,
        previous_status: currentStatus,
        status: desiredStatus,
      });

      if (desiredStatus === 'activa') {
        mailNotifications.push({
          reservation: {
            ...reservation,
            status: desiredStatus,
          },
          previousStatus: currentStatus,
          currentStatus: desiredStatus,
          action: 'updated',
          actorUserId: null,
          actorRole: 'system',
        });
      } else if (desiredStatus === 'finalizada') {
        mailNotifications.push({
          reservation: {
            ...reservation,
            status: desiredStatus,
          },
          previousStatus: currentStatus,
          currentStatus: desiredStatus,
          action: 'updated',
          actorUserId: null,
          actorRole: 'system',
          overrideEventType: 'finalized',
        });
      }

      if (reservation.vehicle_id !== null && reservation.vehicle_id !== undefined) {
        touchedVehicleIds.add(String(reservation.vehicle_id));
      }
    }

    for (const vehicleId of touchedVehicleIds) {
      // eslint-disable-next-line no-await-in-loop
      await syncVehicleStatusFromReservations(connection, vehicleId);
    }

    await connection.commit();

    for (const notification of mailNotifications) {
      // eslint-disable-next-line no-await-in-loop
      try {
        const result = await sendReservationNotification(notification);
        if (!result?.skipped) {
          const mailColumn = notification.overrideEventType === 'delivery_reminder'
            ? 'delivery_reminder_sent_at'
            : 'finalization_mail_sent_at';
          await markReservationMailSent(notification.reservation?.id, mailColumn);
        }
      } catch (error) {
        console.error('Error enviando correo automático de reserva:', error);
      }
    }

    return updatedReservations;
  } catch (error) {
    try {
      await connection.rollback();
    } catch { }
    throw error;
  } finally {
    connection.release();
  }
};

const sendPendingDeliveryReminderMails = async () => {
  const [reservations] = await db.query(`
    SELECT
      r.id,
      r.vehicle_id,
      r.user_id,
      r.status,
      r.start_time,
      r.end_time,
      r.delivery_reminder_sent_at,
      u.username,
      v.brand,
      v.license_plate,
      v.model,
      c.nombre AS centre_name,
      v.centre_id,
      val.km_entrega
    FROM reservations r
    JOIN users u ON r.user_id = u.id
    JOIN vehicles v ON r.vehicle_id = v.id
    LEFT JOIN centres c ON v.centre_id = c.id
    LEFT JOIN validations val ON r.id = val.reservation_id AND val.deleted_at IS NULL
    WHERE r.status = 'finalizada'
      AND r.end_time <= DATE_SUB(NOW(), INTERVAL 1 DAY)
      AND r.delivery_reminder_sent_at IS NULL
  `);

  const mailNotifications = [];

  for (const reservation of Array.isArray(reservations) ? reservations : []) {
    const hasDeliveryForm = reservation.km_entrega !== null && reservation.km_entrega !== undefined;
    if (hasDeliveryForm) {
      continue;
    }

    mailNotifications.push({
      reservation: {
        ...reservation,
        status: 'finalizada',
      },
      previousStatus: 'finalizada',
      currentStatus: 'finalizada',
      action: 'updated',
      actorUserId: null,
      actorRole: 'system',
      overrideEventType: 'delivery_reminder',
    });
  }

  let sentCount = 0;

  for (const notification of mailNotifications) {
    try {
      const result = await sendReservationNotification(notification);
      if (!result?.skipped) {
        await markReservationMailSent(notification.reservation?.id, 'delivery_reminder_sent_at');
        sentCount += 1;
      }
    } catch (error) {
      console.error('Error enviando recordatorio de formulario de entrega:', error);
    }
  }

  return sentCount;
};

module.exports = {
  getDesiredReservationStatusForTime,
  syncReservationStatusesByTime,
  syncVehicleStatusFromReservations,
  sendPendingDeliveryReminderMails,
};
