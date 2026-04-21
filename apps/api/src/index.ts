import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import jwt from '@fastify/jwt';

import { prisma } from '@voicedesk/database';
import { createLogger } from './shared/logger.js';
import { createRedisClient } from './shared/redis.js';

// Route modules
import { registerCallRoutes } from './modules/calls/routes.js';
import { registerTenantRoutes } from './modules/tenants/routes.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerWebhookRoutes } from './modules/webhooks/routes.js';
import { registerAnalyticsRoutes } from './modules/analytics/routes.js';

const logger = createLogger();

async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
        },
      },
    },
  });

  // Register plugins
  await fastify.register(cors, {
    origin: process.env.DASHBOARD_URL || 'http://localhost:3000',
    credentials: true,
  });

  await fastify.register(helmet, {
    contentSecurityPolicy: false,
  });

  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  await fastify.register(websocket);

  await fastify.register(jwt, {
    secret: process.env.JWT_SECRET || 'development-secret-change-in-production',
  });

  // Initialize Redis
  const redis = createRedisClient();
  await redis.connect();
  fastify.decorate('redis', redis);

  // Initialize Prisma
  fastify.decorate('prisma', prisma);

  // Health check
  fastify.get('/health', async () => {
    return { 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    };
  });

  // API info
  fastify.get('/', async () => {
    return {
      name: 'VoiceDesk AI API',
      version: '1.0.0',
      docs: '/docs',
    };
  });

  // Register route modules
  await fastify.register(registerAuthRoutes, { prefix: '/api/auth' });
  await fastify.register(registerTenantRoutes, { prefix: '/api/tenants' });
  await fastify.register(registerCallRoutes, { prefix: '/api/calls' });
  await fastify.register(registerWebhookRoutes, { prefix: '/webhooks' });
  await fastify.register(registerAnalyticsRoutes, { prefix: '/api/analytics' });

  // Error handler
  fastify.setErrorHandler((error, request, reply) => {
    logger.error({ err: error, requestId: request.id }, 'Request error');
    
    if (error.validation) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request parameters',
          details: error.validation,
        },
      });
    }

    const statusCode = error.statusCode || 500;
    return reply.status(statusCode).send({
      success: false,
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: statusCode === 500 ? 'Internal server error' : error.message,
      },
    });
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down server...');
    await fastify.close();
    await prisma.$disconnect();
    await redis.quit();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return fastify;
}

async function start() {
  try {
    const server = await buildServer();
    const port = parseInt(process.env.API_PORT || '3001', 10);
    const host = process.env.API_HOST || '0.0.0.0';

    await server.listen({ port, host });
    logger.info(`🚀 VoiceDesk API running at http://${host}:${port}`);
  } catch (error) {
    logger.error(error, 'Failed to start server');
    process.exit(1);
  }
}

start();
