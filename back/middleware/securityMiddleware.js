const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 2000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes desde esta IP, por favor inténtalo de nuevo más tarde.' }
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 25,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos de inicio de sesión. Inténtalo más tarde.' },
});

const helmetMiddleware = helmet({
    contentSecurityPolicy: false,
});

/**
 * Middleware de protección CSRF mediante verificación estricta de origen (Origin y Referer)
 * para peticiones mutantes (POST, PUT, DELETE, PATCH).
 */
const csrfProtection = (req, res, next) => {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
        const origin = req.headers.origin;
        const referer = req.headers.referer;

        // Obtener orígenes de frontend permitidos configurados en el entorno
        const allowed = (process.env.FRONTEND_URLS || process.env.FRONTEND_URL || 'http://localhost:5173')
            .split(',')
            .map((o) => o.trim().toLowerCase())
            .filter(Boolean);

        if (origin) {
            const normalizedOrigin = origin.trim().toLowerCase();
            if (!allowed.includes(normalizedOrigin)) {
                return res.status(403).json({ error: 'Acceso denegado: origen no permitido (CSRF)' });
            }
        } else if (referer) {
            try {
                const parsedReferer = new URL(referer);
                const refererOrigin = `${parsedReferer.protocol}//${parsedReferer.host}`.toLowerCase();
                if (!allowed.includes(refererOrigin)) {
                    return res.status(403).json({ error: 'Acceso denegado: procedencia no permitida (CSRF)' });
                }
            } catch (e) {
                return res.status(403).json({ error: 'Acceso denegado: cabecera referer inválida' });
            }
        } else {
            // En producción, si no hay Origin ni Referer para una petición mutante, se rechaza
            if (process.env.NODE_ENV === 'production') {
                return res.status(403).json({ error: 'Acceso denegado: falta verificación de origen (CSRF)' });
            }
        }
    }
    next();
};

module.exports = {
    helmetMiddleware,
    apiLimiter,
    authLimiter,
    csrfProtection,
};
