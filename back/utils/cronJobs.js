const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const {
    syncReservationStatusesByTime,
    sendPendingDeliveryReminderMails,
} = require('./reservationStatusSync');
const { syncCentresFromUnifica } = require('./centresSync');

const CRON_LOG_FILE = path.join(__dirname, '..', 'scripts', 'sync_resultado.log');

// Registrar eventos de cron
function logCronEvent(message, type = 'INFO') {
    const timestamp = new Date().toLocaleString('es-ES');
    const line = `[${timestamp}] [CRON ${type}] ${message}`;

    console.log(line);

    try {
        fs.appendFileSync(CRON_LOG_FILE, `${line}\n`, 'utf8');
    } catch (fileError) {
        console.error(`[${timestamp}] [CRON ERROR] No se pudo escribir en ${CRON_LOG_FILE}: ${fileError.message}`);
    }
}

/**
 * Ejecuta el script de sincronización de centros todos los días a las 03:00
 */
function initializeSyncCentrosCron() {
    const cronExpression = '0 3 * * *';

    const task = cron.schedule(cronExpression, async () => {
        try {
            logCronEvent('Iniciando sincronización de centros...');
            const result = await syncCentresFromUnifica({ localConnection: db, logger: console });
            logCronEvent(
                `Sincronización completada: ${result.count} registros procesados y ${result.errors} errores`,
                'SUCCESS'
            );
        } catch (error) {
            logCronEvent(`Error ejecutando sincronización: ${error.message}`, 'ERROR');
        }
    }, { timezone: 'Europe/Madrid' });

    return task;
}

/**
 * Sincroniza automáticamente las reservas por fecha/hora
 * Se ejecuta cada 30 segundos para no depender de visitas al front
 */
function initializeReservationStatusCron() {
    const cronExpression = '*/30 * * * * *';

    const task = cron.schedule(cronExpression, async () => {
        try {
            const updatedReservations = await syncReservationStatusesByTime();
        } catch (error) {
            logCronEvent(`Error sincronizando reservas por tiempo: ${error.message}`, 'ERROR');
        }
    });

    syncReservationStatusesByTime()
        .then((updatedReservations) => {
            if (updatedReservations.length > 0) {
                logCronEvent(`Sincronización inicial de reservas completada: ${updatedReservations.length}`, 'SUCCESS');
            }
        })
        .catch((error) => {
            logCronEvent(`Error en sincronización inicial de reservas: ${error.message}`, 'ERROR');
        });

    return task;
}

/**
 * Envía recordatorios para formularios de entrega pendientes
 * Se ejecuta cada 15 minutos para no sobrecargar la base de datos
 */
function initializeDeliveryReminderCron() {
    const cronExpression = '0 */15 * * * *';

    const task = cron.schedule(cronExpression, async () => {
        try {
            const reminderCount = await sendPendingDeliveryReminderMails();
            if (reminderCount > 0) {
                logCronEvent(`Recordatorios de entrega enviados: ${reminderCount}`, 'SUCCESS');
            }
        } catch (error) {
            logCronEvent(`Error enviando recordatorios de entrega: ${error.message}`, 'ERROR');
        }
    });

    sendPendingDeliveryReminderMails()
        .then((reminderCount) => {
            if (reminderCount > 0) {
                logCronEvent(`Recordatorios iniciales de entrega enviados: ${reminderCount}`, 'SUCCESS');
            }
        })
        .catch((error) => {
            logCronEvent(`Error en recordatorios iniciales de entrega: ${error.message}`, 'ERROR');
        });

    return task;
}

/**
 * Inicia todas las tareas cron del sistema
 */
function initializeAllCronJobs() {
    try {
        initializeSyncCentrosCron();
        initializeReservationStatusCron();
        initializeDeliveryReminderCron();
    } catch (error) {
        logCronEvent(`Error al inicializar tareas cron: ${error.message}`, 'ERROR');
    }
}

module.exports = {
    initializeAllCronJobs,
    initializeSyncCentrosCron,
    initializeReservationStatusCron,
    initializeDeliveryReminderCron,
};
