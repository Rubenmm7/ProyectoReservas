const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const authRoutes = require('./routes/authRoutes');
const auditRoutes = require('./routes/auditRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const { helmetMiddleware, apiLimiter, csrfProtection } = require('./middleware/securityMiddleware');

const allowedOrigins = (process.env.FRONTEND_URLS || process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const createApp = () => {
  const app = express();

  app.use(cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  }));

  // Interceptor para sanitizar respuestas de error y evitar fugas de información técnica en producción
  app.use((req, res, next) => {
    const originalJson = res.json;
    res.json = function (body) {
      if (process.env.NODE_ENV === 'production' && body && typeof body === 'object') {
        if ('details' in body) {
          delete body.details;
        }
      }
      return originalJson.call(this, body);
    };
    next();
  });

  app.use((req, _res, next) => {
    if (
      req.method === 'PUT' &&
      req.path.includes('/reservations/') &&
      (req.headers['content-type'] || '').includes('application/json')
    ) {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        try {
          req.body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          req._body = true;
        } catch (_error) {
          req.body = {};
        }
        next();
      });
      return;
    }

    next();
  });

  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());
  app.use(helmetMiddleware);
  app.use('/api/', apiLimiter);
  app.use('/api/', csrfProtection);

  app.use('/api/auth', authRoutes);
  app.use('/api/audit', auditRoutes);
  app.use('/api/dashboard', dashboardRoutes);

  return app;
};

module.exports = { createApp };
