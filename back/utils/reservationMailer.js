const db = require('../config/db');
const auditLogger = require('./auditLogger');
const { sendMail, resolveRecipient } = require('./mailer');

const MAIL_DEDUP_WINDOW_MS = 5 * 60 * 1000;
const recentlySentMails = new Map();

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'full',
  timeStyle: 'short',
});

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const normalizeStatus = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, '-');

const formatDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const formatted = DATE_TIME_FORMATTER.format(date);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
};

const formatVehicleLabel = (reservation = {}) => {
  const brand = String(reservation.brand ?? '').trim();
  const model = String(reservation.model ?? '').trim();
  const plate = String(reservation.license_plate ?? '').trim();
  const name = [brand, model].filter(Boolean).join(' / ') || model || brand || '-';
  return plate ? `${name} (${plate})` : name;
};

const getBrandName = () => String(process.env.MAIL_BRAND_NAME || 'MACROSAD').trim();
const getLogoUrl = () => String(process.env.MAIL_LOGO_URL || '').trim();

const buildDedupKey = ({
  reservation,
  eventType,
  action,
  currentStatus,
  recipient,
}) => [
  action || 'updated',
  eventType || 'unknown',
  String(reservation?.id ?? 'no-id'),
  normalizeStatus(currentStatus),
  String(recipient ?? '').toLowerCase(),
].join('|');

const shouldSkipDuplicateMail = (key) => {
  const now = Date.now();
  const lastSentAt = recentlySentMails.get(key);
  if (lastSentAt && now - lastSentAt < MAIL_DEDUP_WINDOW_MS) {
    return true;
  }

  recentlySentMails.set(key, now);

  for (const [entryKey, entryTime] of recentlySentMails.entries()) {
    if (now - entryTime >= MAIL_DEDUP_WINDOW_MS) {
      recentlySentMails.delete(entryKey);
    }
  }

  return false;
};

const MAIL_EVENT_CONFIG = {
  approved: {
    subject: 'Tu reserva ha sido aprobada',
    title: 'Reserva aprobada',
    accent: '#db2777',
    intro: 'Tu reserva ha sido aprobada y ya puede seguir su curso normal.',
  },
  active: {
    subject: 'Tu reserva está activa',
    title: 'Reserva activa',
    accent: '#db2777',
    intro: 'Tu reserva ha pasado a estado activo. Ya puedes hacer uso del vehículo en la franja reservada.',
  },
  rejected: {
    subject: 'Tu reserva ha sido cancelada',
    title: 'Reserva cancelada',
    accent: '#db2777',
    intro: 'Tu reserva ha sido cancelada o rechazada.',
  },
  finalized: {
    subject: 'Tu reserva ha finalizado',
    title: 'Reserva finalizada',
    accent: '#db2777',
    intro: 'Tu periodo de reserva ha terminado. Recuerda rellenar el formulario de entrega si no lo has hecho.',
  },
  delivery_reminder: {
    subject: 'Recordatorio: formulario de entrega pendiente',
    title: 'Formulario de entrega pendiente',
    accent: '#db2777',
    intro: 'Han pasado 24 horas desde que terminó tu reserva, por favor, rellena el formulario de entrega.',
  },
  deleted: {
    subject: 'Tu reserva ha sido eliminada',
    title: 'Reserva eliminada',
    accent: '#db2777',
    intro: 'La reserva ha sido eliminada del sistema. Si no la has eliminado tú, contacta con el administrador.',
  },
  test: {
    subject: 'Correo de prueba del sistema de reservas MACROSAD',
    title: 'Correo de prueba',
    accent: '#db2777',
    intro: 'Este mensaje confirma que la configuración de correo está respondiendo correctamente.',
  },
  workshop_needed: {
    subject: 'Mantenimiento necesario: vehículo superó los 15.000 km',
    title: 'Mantenimiento necesario',
    accent: '#f59e0b',
    intro: 'El siguiente vehículo ha superado los 15.000 km acumulados desde su último parte de taller y requiere revisión.',
  },
};

const getReservationRecipient = (reservation, fallbackRecipient = null) => {
  const explicitRecipient = resolveRecipient(fallbackRecipient, { allowTestRecipient: true });
  if (explicitRecipient) return explicitRecipient;

  return resolveRecipient(reservation?.username);
};

const buildReservationText = ({ reservation, eventType }) => {
  const config = MAIL_EVENT_CONFIG[eventType] || MAIL_EVENT_CONFIG.test;
  const lines = [
    `${config.title}`,
    '',
    config.intro,
    '',
    `Usuario: ${reservation?.username ?? '-'}`,
    `Vehículo: ${formatVehicleLabel(reservation)}`,
    `Inicio: ${formatDateTime(reservation?.start_time)}`,
    `Fin: ${formatDateTime(reservation?.end_time)}`,
    `Estado: ${reservation?.status ?? '-'}`,
  ];

  if (reservation?.centre_name) {
    lines.push(`Centro: ${reservation.centre_name}`);
  }

  return lines.join('\n');
};

const buildReservationHtml = ({ reservation, eventType }) => {
  const config = MAIL_EVENT_CONFIG[eventType] || MAIL_EVENT_CONFIG.test;
  const rows = [
    ['Usuario', reservation?.username ?? '-'],
    ['Vehículo', formatVehicleLabel(reservation)],
    ['Inicio', formatDateTime(reservation?.start_time)],
    ['Fin', formatDateTime(reservation?.end_time)],
    ['Estado', reservation?.status
      ? String(reservation.status).trim().charAt(0).toUpperCase() + String(reservation.status).trim().slice(1)
      : '-']

  ];

  if (reservation?.centre_name) {
    rows.push(['Centro', reservation.centre_name]);
  }

  const rowsHtml = rows
    .map(([label, value], index) => {
      const isLast = index === rows.length - 1;
      const borderStyle = isLast ? 'none' : '1px solid #e2e8f0';
      const valueBg = index % 2 === 0 ? '#ffffff' : '#f8fafc';
      const labelRadius = isLast ? 'border-radius:0 0 0 13px;' : '';
      const valueRadius = isLast ? 'border-radius:0 0 13px 0;' : '';
      return `
      <tr class="email-row">
        <td width="130" class="email-label" style="padding:13px 16px;border-bottom:${borderStyle};background-color:#f1f5f9;color:#64748b;font-weight:bold;font-family:Arial,sans-serif;font-size:11px;line-height:17px;text-transform:uppercase;letter-spacing:.06em;vertical-align:middle;${labelRadius}">${escapeHtml(label)}</td>
        <td class="email-value" style="padding:13px 16px;border-bottom:${borderStyle};background-color:${valueBg};color:#0f172a;font-family:Arial,sans-serif;font-size:14px;line-height:21px;word-break:break-word;overflow-wrap:anywhere;vertical-align:middle;${valueRadius}">${escapeHtml(value)}</td>
      </tr>
    `;
    })
    .join('');

  const tableHeaderHtml = `
    <tr>
      <td colspan="2" style="padding:11px 16px;background-color:${config.accent};border-radius:13px 13px 0 0;color:#ffffff;font-family:Arial,sans-serif;font-size:11px;font-weight:bold;letter-spacing:.09em;text-transform:uppercase;line-height:17px;">
        Detalles de la reserva
      </td>
    </tr>
  `;

  const brandName = escapeHtml(getBrandName());
  const rawLogoUrl = getLogoUrl() || (process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/logo.png` : '');
  const logoUrl = rawLogoUrl.replace(/\.svg(\?.*)?$/, '.png$1');

  const logoHtml = logoUrl
    ? `<table cellpadding="0" cellspacing="0" border="0" width="64" role="presentation"><tr><td align="center" valign="middle" style="padding:8px;background-color:#ffffff;border-radius:18px;"><img src="${escapeHtml(logoUrl)}" alt="${brandName}" width="48" height="48" style="display:block;width:48px;height:48px;" /></td></tr></table>`
    : `<table cellpadding="0" cellspacing="0" border="0" width="64" role="presentation"><tr><td width="64" height="64" align="center" valign="middle" style="border-radius:18px;background-color:#e14e8f;font-size:22px;font-weight:bold;line-height:64px;letter-spacing:.04em;color:#ffffff;font-family:Arial,sans-serif;">${brandName.slice(0, 1).toUpperCase()}</td></tr></table>`;

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(config.title)}</title>
  <style type="text/css">
    table { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img   { -ms-interpolation-mode: bicubic; border: 0; display: block; }
    @media only screen and (max-width: 620px) {
      .email-body { padding: 16px 10px !important; }
      .email-container { width: 100% !important; max-width: 100% !important; }
      .email-shell { border-radius: 16px !important; }
      .email-header { padding: 18px 16px !important; border-radius: 16px 16px 0 0 !important; }
      .email-content { padding-left: 16px !important; padding-right: 16px !important; }
      .email-intro { padding-top: 20px !important; font-size: 14px !important; line-height: 22px !important; }
      .email-note { padding: 14px 14px !important; font-size: 12px !important; line-height: 18px !important; }
      .email-logo-cell { width: 58px !important; padding-right: 10px !important; }
      .email-logo-table { width: 48px !important; }
      .email-title { font-size: 20px !important; line-height: 26px !important; }
      .email-brand { font-size: 11px !important; line-height: 15px !important; }
      .email-table-wrap { padding-left: 12px !important; padding-right: 12px !important; }
      .email-data-table {
        table-layout: auto !important;
        width: 100% !important;
      }
      .email-row td {
        display: block !important;
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        box-sizing: border-box !important;
      }
      .email-label {
        width: 100% !important;
        max-width: 100% !important;
        padding: 16px 16px 2px 16px !important;
        font-size: 10px !important;
        line-height: 14px !important;
        text-transform: uppercase !important;
        letter-spacing: .09em !important;
        background-color: #ffffff !important;
        border-bottom: none !important;
        color: #db2777 !important;
        font-weight: bold !important;
      }
      .email-value {
        width: 100% !important;
        max-width: 100% !important;
        padding: 2px 16px 16px 16px !important;
        background-color: #ffffff !important;
        border-bottom: 1px solid #f1f5f9 !important;
        font-size: 15px !important;
        line-height: 23px !important;
        color: #0f172a !important;
        font-weight: 600 !important;
      }
      .email-row:last-child .email-value {
        border-bottom: none !important;
        padding-bottom: 18px !important;
      }
    }
  </style>
</head>
<body style="margin:0;padding:0;">
  <!--[if mso]>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff">
    <tr><td>
  <![endif]-->
  <div class="email-body" style="background-color:#ffffff;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="background-color:#ffffff;">
      <tr>
        <td align="center" style="padding:32px 20px;">

          <!--[if mso]><table width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
          <table width="600" cellpadding="0" cellspacing="0" border="0" role="presentation" class="email-container email-shell" style="width:600px;max-width:600px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:20px;">

            <!-- CABECERA -->
            <tr>
              <td class="email-header" style="padding:24px 28px;background-color:${config.accent};border-radius:20px 20px 0 0;">
                <table cellpadding="0" cellspacing="0" border="0" role="presentation">
                  <tr>
                    <td width="80" class="email-logo-cell" style="padding-right:14px;vertical-align:middle;">
                      ${logoHtml.replace('width="64"', 'width="64" class="email-logo-table"')}
                    </td>
                    <td style="vertical-align:middle;">
                      <!--
                        <p> y <h1> eliminados: Outlook añade márgenes propios no sobreescribibles.
                        Todo el texto vive directamente en <td> con line-height en px.
                        12px * 1.4 = 17px | 24px * 1.2 = 29px
                      -->
                      <table cellpadding="0" cellspacing="0" border="0" role="presentation">
                        <tr>
                          <td class="email-brand" style="padding-bottom:6px;font-size:12px;line-height:17px;letter-spacing:.12em;text-transform:uppercase;color:#fbe9f1;font-family:Arial,sans-serif;">
                            ${brandName}
                          </td>
                        </tr>
                        <tr>
                          <td class="email-title" style="font-size:24px;line-height:29px;color:#ffffff;font-family:Arial,sans-serif;font-weight:bold;">
                            ${escapeHtml(config.title)}
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- INTRO: 15px * 1.6 = 24px -->
            <tr>
              <td class="email-intro" style="padding:28px 28px 0 28px;font-family:Arial,sans-serif;font-size:15px;line-height:24px;color:#334155;">
                ${escapeHtml(config.intro)}
              </td>
            </tr>

            <!-- CAJA INFORMATIVA: 13px * 1.6 = 21px -->
            <tr>
              <td class="email-content" style="padding:20px 28px 0 28px;">
                <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-radius:16px;background-color:#f8fafc;border:1px solid #e2e8f0;">
                  <tr>
                    <td class="email-note" style="padding:16px 18px;color:#475569;font-size:13px;line-height:21px;font-family:Arial,sans-serif;">
                      Te escribimos para mantenerte informado sobre el estado de tu reserva.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- ESPACIADO FIJO: margin no es fiable en Outlook -->
            <tr>
              <td height="20" style="font-size:20px;line-height:20px;mso-line-height-rule:exactly;">&nbsp;</td>
            </tr>

            <!-- TABLA DE DATOS -->
            <tr>
              <td class="email-table-wrap" style="padding:0 28px;">
                <table width="100%" cellpadding="0" cellspacing="0" border="0" class="email-data-table" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:14px;background-color:#ffffff;table-layout:fixed;overflow:hidden;">
                  <tbody>${tableHeaderHtml}${rowsHtml}</tbody>
                </table>
              </td>
            </tr>

            <!-- PIE: 12px * 1.5 = 18px -->
            <tr>
              <td style="padding:20px 28px 28px 28px;color:#64748b;font-size:12px;line-height:18px;font-family:Arial,sans-serif;">
                Este correo se ha generado automáticamente desde el sistema de reservas de ${brandName}. Si no esperabas este mensaje, contacta con el equipo de administración.
              </td>
            </tr>

          </table>
          <!--[if mso]></td></tr></table><![endif]-->

        </td>
      </tr>
    </table>
  </div>
  <!--[if mso]>
    </td></tr>
  </table>
  <![endif]-->
</body>
</html>`;
};

const getReservationMailEventType = ({ previousStatus, currentStatus, action }) => {
  const next = normalizeStatus(currentStatus);
  const previous = normalizeStatus(previousStatus);

  if (action === 'deleted') return 'deleted';

  if (action === 'created') {
    if (next === 'aprobada') return 'approved';
    if (next === 'activa') return 'active';
    if (next === 'rechazada') return 'rejected';
    if (next === 'finalizada') return 'finalized';
    return null;
  }

  if (action === 'updated') {
    if (previous === next) return null;
    if (next === 'aprobada') return 'approved';
    if (next === 'activa') return 'active';
    if (next === 'rechazada') return 'rejected';
    if (next === 'finalizada') return 'finalized';
    return null;
  }

  return null;
};

const sendReservationNotification = async ({
  reservation,
  previousStatus = null,
  currentStatus = null,
  action = 'updated',
  actorUserId = null,
  actorRole = 'system',
  recipient = null,
  overrideEventType = null,
}) => {
  const eventType = overrideEventType || getReservationMailEventType({ previousStatus, currentStatus, action });
  if (!eventType) {
    return { skipped: true, reason: 'irrelevant_status_change' };
  }

  const dedupKey = buildDedupKey({
    reservation,
    eventType,
    action,
    currentStatus,
    recipient,
  });

  if (shouldSkipDuplicateMail(dedupKey)) {
    return {
      skipped: true,
      reason: 'duplicate_notification_window',
      eventType,
    };
  }

  const finalRecipient = getReservationRecipient(reservation, recipient);
  if (!finalRecipient) {
    await auditLogger.logAction(actorUserId, 'MAIL', 'reservations', reservation?.id ?? 0, actorRole, {
      eventType,
      status: normalizeStatus(currentStatus),
      skipped: true,
      reason: 'recipient_missing',
    });

    return {
      skipped: true,
      reason: 'recipient_missing',
      eventType,
    };
  }

  const subject = MAIL_EVENT_CONFIG[eventType]?.subject || MAIL_EVENT_CONFIG.test.subject;
  const text = buildReservationText({ reservation, eventType });
  const html = buildReservationHtml({ reservation, eventType });
  const result = await sendMail({
    to: finalRecipient,
    subject,
    text,
    html,
  });

  await auditLogger.logAction(actorUserId, 'MAIL', 'reservations', reservation?.id ?? 0, actorRole, {
    eventType,
    recipient: result.recipient,
    transportMode: result.transportMode,
    messageId: result.messageId,
    status: normalizeStatus(currentStatus),
  });

  return {
    ...result,
    eventType,
    subject,
  };
};

const sendTestReservationMail = async ({
  recipient = null,
  actorUserId = null,
  actorRole = 'system',
}) => {
  const sampleReservation = {
    id: 0,
    username: recipient || 'usuario.de.prueba@macrosad.com',
    model: 'Vehículo de prueba',
    license_plate: 'PRUEBA-000',
    start_time: new Date(),
    end_time: new Date(Date.now() + 60 * 60 * 1000),
    status: 'aprobada',
    centre_name: 'Centro de pruebas',
  };

  return sendReservationNotification({
    reservation: sampleReservation,
    currentStatus: 'aprobada',
    action: 'updated',
    actorUserId,
    actorRole,
    recipient,
  });
};

const notifyStaffAboutWorkshop = async ({ vehicle, centreId }) => {
  try {
    // 1. Obtener todos los admins globales
    const [admins] = await db.query('SELECT email, username FROM users WHERE role = "admin" AND deleted_at IS NULL');

    // 2. Obtener supervisors asociados a este centro específico
    let supervisors = [];
    if (centreId) {
      [supervisors] = await db.query(`
        SELECT u.email, u.username 
        FROM users u
        JOIN user_centres uc ON u.id = uc.user_id
        WHERE uc.centre_id = ? AND u.role = "supervisor" AND u.deleted_at IS NULL
      `, [centreId]);
    }

    // Combinar destinatarios únicos
    const recipientsMap = new Map();
    admins.forEach(a => { if (a.email) recipientsMap.set(a.email.toLowerCase(), a); });
    supervisors.forEach(s => { if (s.email) recipientsMap.set(s.email.toLowerCase(), s); });

    for (const recipient of recipientsMap.values()) {
      await sendReservationNotification({
        reservation: {
          id: 0,
          username: 'Sistema de Mantenimiento',
          model: vehicle.model,
          license_plate: vehicle.license_plate,
          start_time: new Date(),
          end_time: new Date(),
          status: 'Mantenimiento Pendiente',
          centre_name: vehicle.centre_name
        },
        recipient: recipient.email,
        overrideEventType: 'workshop_needed'
      });
    }
  } catch (error) {
    console.error('Error enviando notificaciones de taller:', error);
  }
};

module.exports = {
  getReservationMailEventType,
  sendReservationNotification,
  sendTestReservationMail,
  buildReservationText,
  buildReservationHtml,
  notifyStaffAboutWorkshop,
};
