const { graphPost, graphPatch, graphDelete } = require('./graphApiClient');

function toISOForOutlook(mysqlDatetime) {
    return String(mysqlDatetime).replace(' ', 'T');
}

function logOutlookError(context, error) {
    const status = error.response?.status;
    const msError = error.response?.data?.error;
    console.error(`[OUTLOOK] ${context} — HTTP ${status ?? 'N/A'}: ${msError?.code ?? error.message} — ${msError?.message ?? ''}`);
}

function buildEventBody(reservationId, brand, model, licensePlate, status) {
    const STATUS_LABELS = {
        pendiente: 'Pendiente de aprobación',
        aprobada: 'Aprobada',
        activa: 'En uso',
        finalizada: 'Finalizada',
        rechazada: 'Rechazada',
    };
    const statusLabel = STATUS_LABELS[String(status).toLowerCase()] || status;

    return {
        subject: `Reserva - ${brand} ${model} (${licensePlate})`,
        body: {
            contentType: 'HTML',
            content: `<p>Reserva #${reservationId} gestionada desde el sistema de reservas.</p>
                      <p><strong>Vehículo:</strong> ${brand} ${model} — ${licensePlate}</p>
                      <p><strong>Estado:</strong> ${statusLabel}</p>
                      <p><em>Este evento es informativo. Para modificar o cancelar la reserva, accede al sistema web.</em></p>`,
        },
        isReminderOn: true,
        reminderMinutesBeforeStart: 15,
        showAs: 'busy',
    };
}

async function createReservationEvent(userEmail, { reservationId, brand, model, licensePlate, startTime, endTime, status }) {
    const event = {
        ...buildEventBody(reservationId, brand, model, licensePlate, status),
        start: { dateTime: toISOForOutlook(startTime), timeZone: 'Europe/Madrid' },
        end:   { dateTime: toISOForOutlook(endTime),   timeZone: 'Europe/Madrid' },
    };

    try {
        const result = await graphPost(`/users/${encodeURIComponent(userEmail)}/events`, event);
        console.log(`[OUTLOOK] Evento creado para ${userEmail} → eventId: ${result.id}`);
        return result.id;
    } catch (error) {
        logOutlookError(`createEvent(${userEmail})`, error);
        throw error;
    }
}

async function updateReservationEvent(outlookEventId, userEmail, { reservationId, brand, model, licensePlate, startTime, endTime, status }) {
    const patch = {
        ...buildEventBody(reservationId, brand, model, licensePlate, status),
        start: { dateTime: toISOForOutlook(startTime), timeZone: 'Europe/Madrid' },
        end:   { dateTime: toISOForOutlook(endTime),   timeZone: 'Europe/Madrid' },
    };

    try {
        await graphPatch(`/users/${encodeURIComponent(userEmail)}/events/${outlookEventId}`, patch);
        console.log(`[OUTLOOK] Evento actualizado para ${userEmail} → eventId: ${outlookEventId}`);
    } catch (error) {
        logOutlookError(`updateEvent(${userEmail}, ${outlookEventId})`, error);
        throw error;
    }
}

async function deleteReservationEvent(outlookEventId, userEmail) {
    try {
        await graphDelete(`/users/${encodeURIComponent(userEmail)}/events/${outlookEventId}`);
        console.log(`[OUTLOOK] Evento eliminado para ${userEmail} → eventId: ${outlookEventId}`);
    } catch (error) {
        logOutlookError(`deleteEvent(${userEmail}, ${outlookEventId})`, error);
        throw error;
    }
}

module.exports = { createReservationEvent, updateReservationEvent, deleteReservationEvent };
