import path from 'path';
import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc, { Options } from 'swagger-jsdoc';

import { env } from '@config/env';
import { requestLogger } from '@middleware/requestLogger';
import { errorHandler } from '@middleware/errorHandler';
import { healthRoutes } from '@routes/health.routes';
import { instanceRoutes } from '@routes/instance.routes';
import { awsRoutes } from '@routes/aws.routes';

const swaggerOptions: Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Cloud Catalog API',
      version: '1.0.0',
      description: 'Backend API for the Cloud Comparison Platform',
      contact: {
        name: 'Cloud Catalog Team',
      },
    },
    servers: [
      {
        url: `http://localhost:${env.PORT}/api/${env.API_VERSION}`,
        description: 'Development server',
      },
    ],
  },
  apis: ['./src/routes/*.ts', './src/controllers/*.ts'],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

export function createApp(): Application {
  const app = express();

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          scriptSrcAttr: ["'unsafe-inline'"],
        },
      },
    }),
  );

  const corsOptions = {
    origin: env.NODE_ENV === 'development' ? true : env.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-Id',
      'X-Tunnel-Skip-AntiPhishing-Threshold',
      'X-Devtunnel-Skip',
      'Ngrok-Skip-Browser-Warning',
    ],
  };
  app.use(cors(corsOptions));

  app.use(express.json({ limit: '10kb' }));
  app.use(express.urlencoded({ extended: true, limit: '10kb' }));

  app.use(requestLogger);

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  app.use('/docs', express.static(path.join(__dirname, 'docs')));

  const apiPrefix = `/api/${env.API_VERSION}`;

  app.use('/instances', instanceRoutes);
  app.use(`${apiPrefix}/instances`, instanceRoutes);
  app.use(`${apiPrefix}/health`, healthRoutes);
  app.use(`${apiPrefix}/aws`, awsRoutes);

  // Task 2: Lightweight Health Check Probe Endpoint (Kubernetes / Load Balancer)
  app.get('/healthz', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      service: 'cloud-catalog-api',
      version: '1.0.0',
    });
  });

  app.get('/', (_req, res) => {
    res.json({
      success: true,
      message: 'Cloud Catalog API',
      version: '1.0.0',
      documentation: '/api-docs',
      dashboard: '/dashboard',
      health: `${apiPrefix}/health`,
    });
  });

  app.get('/dashboard', (_req, res) => {
    res.sendFile(path.join(__dirname, 'docs', 'dashboard.html'));
  });

  app.use((_req, res) => {
    res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource does not exist',
      },
    });
  });

  app.use(errorHandler);

  return app;
}
