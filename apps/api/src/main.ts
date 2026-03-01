import express from 'express';
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
import prisma from './db/prisma';
import redis from './db/redis';

const config = getConfig();
const logger = createLogger();

const app = express();

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

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', config.server.corsOrigin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Tenant-ID');
  res.header('Access-Control-Expose-Headers', 'X-Tenant-ID');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

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

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
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
