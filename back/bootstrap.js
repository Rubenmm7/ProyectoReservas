const db = require('./config/db');
const { hashStoredPasswords } = require('./scripts/hash_passwords');
const { initializeAllCronJobs } = require('./utils/cronJobs');
const { syncCentresFromUnifica } = require('./utils/centresSync');
const { ensureReservationMailStateColumns } = require('./utils/reservationMailState');
const { ensureUserAuthProviderColumn } = require('./utils/authProviderMigration');
const { ensureVehicleProfileColumns } = require('./utils/vehicleMigration');
const { seedExtraVehicles } = require('./utils/seedExtraVehicles');

const runBootstrapTasks = async () => {
  const connection = await db.getConnection();

  try {
    console.log('Conectado a la base de datos correctamente');

    await ensureReservationMailStateColumns();
    await ensureUserAuthProviderColumn();
    await ensureVehicleProfileColumns();
    await seedExtraVehicles();
    await hashStoredPasswords();
    initializeAllCronJobs();

    try {
      const result = await syncCentresFromUnifica({ localConnection: db, logger: console });
      console.log(`Sincronización inicial de centros completada: ${result.count} registros procesados y ${result.errors} errores`);
    } catch (error) {
      console.error(`Error en la sincronización inicial de centros: ${error.message}`);
    }
  } finally {
    connection.release();
  }
};

module.exports = { runBootstrapTasks };
