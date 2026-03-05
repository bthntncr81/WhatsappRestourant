import express from 'express';
import helmet from 'helmet';
import path from 'path';
import { getConfig } from '@whatres/config';
import { createLogger } from './logger';
import { errorHandler } from './middleware/error-handler';
import { requestLogger } from './middleware/request-logger';
import { healthRouter } from './routes/health.routes';
import { authRouter } from './routes/auth.routes';
import { menuRouter } from './routes/menu.routes';
import { whatsappRouter } from './routes/whatsapp.routes';
import { inboxRouter } from './routes/inbox.routes';
import { nluRouter } from './routes/nlu.routes';
import { orderRouter } from './routes/order.routes';
import { printJobRouter } from './routes/print-job.routes';
import { storeRouter } from './routes/store.routes';
import { chatbotRouter } from './routes/chatbot.routes';
import billingRouter from './routes/billing.routes';
import { paymentRouter } from './routes/payment.routes';
import { whatsappConfigRouter } from './routes/whatsapp-config.routes';
import { surveyRouter } from './routes/survey.routes';
import { broadcastRouter } from './routes/broadcast.routes';
import { menuMediaRouter } from './routes/menu-media.routes';
import { webhookRouter } from './routes/webhook.routes';
import { integrationRouter } from './routes/integration.routes';
import { dashboardRouter } from './routes/dashboard.routes';
import prisma from './db/prisma';
import redis from './db/redis';

const config = getConfig();
const logger = createLogger();

const app = express();

// Trust proxy (required for rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // Allow inline styles for payment callback pages
}));

// Middleware - capture raw body for webhook signature verification
app.use(
  express.json({
    limit: '10mb',
    verify: (req: express.Request, _res, buf) => {
      if (req.url?.includes('/whatsapp/webhook')) {
        (req as any).rawBody = buf;
      }
    },
  })
);
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger(logger));

// CORS — validate origin before reflecting
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = config.server.corsOrigin.split(',').map((o: string) => o.trim());

  if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  } else if (allowedOrigins.includes('*')) {
    res.header('Access-Control-Allow-Origin', '*');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Tenant-ID');
  res.header('Access-Control-Expose-Headers', 'X-Tenant-ID');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Serve uploaded files (menu media images/PDFs)
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Routes
app.use(`${config.server.apiPrefix}/health`, healthRouter);
app.use(`${config.server.apiPrefix}/auth`, authRouter);
app.use(`${config.server.apiPrefix}/menu`, menuRouter);
app.use(`${config.server.apiPrefix}/whatsapp`, whatsappRouter);
app.use(`${config.server.apiPrefix}/inbox`, inboxRouter);
app.use(`${config.server.apiPrefix}/nlu`, nluRouter);
app.use(`${config.server.apiPrefix}/orders`, orderRouter);
app.use(`${config.server.apiPrefix}/print-jobs`, printJobRouter);
app.use(`${config.server.apiPrefix}/stores`, storeRouter);
app.use(`${config.server.apiPrefix}/chatbot`, chatbotRouter);
app.use(`${config.server.apiPrefix}/billing`, billingRouter);
app.use(`${config.server.apiPrefix}/payments`, paymentRouter);
app.use(`${config.server.apiPrefix}/whatsapp-config`, whatsappConfigRouter);
app.use(`${config.server.apiPrefix}/surveys`, surveyRouter);
app.use(`${config.server.apiPrefix}/broadcast`, broadcastRouter);
app.use(`${config.server.apiPrefix}/menu-media`, menuMediaRouter);
app.use(`${config.server.apiPrefix}/webhooks`, webhookRouter);
app.use(`${config.server.apiPrefix}/integrations`, integrationRouter);
app.use(`${config.server.apiPrefix}/dashboard`, dashboardRouter);

// 404 Handler
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'The requested resource was not found',
    },
  });
});

// Global Error Handler
app.use(errorHandler(logger));

// Start server
const server = app.listen(config.server.port, async () => {
  // Test database connection
  try {
    await prisma.$connect();
    logger.info('📦 Database connected');
  } catch (error) {
    logger.error({ error }, '❌ Database connection failed');
  }

  // Test Redis connection
  try {
    await redis.connect();
    await redis.ping();
    logger.info('📦 Redis connected');
  } catch (error) {
    logger.warn({ error }, '⚠️ Redis connection failed - caching disabled');
  }

  logger.info(
    {
      port: config.server.port,
      env: config.server.nodeEnv,
      apiPrefix: config.server.apiPrefix,
    },
    `🚀 API server running on http://localhost:${config.server.port}`
  );
});

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down server...');
  await prisma.$disconnect();
  await redis.quit();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
