import 'dotenv/config';
import http from 'http';

import { createApp } from './app';
import { env } from '@config/env';
import { logger } from '@config/logger';
import { connectDatabase, disconnectDatabase } from '@config/database';

const PORT = env.PORT;

async function gracefulShutdown(server: http.Server): Promise<void> {
  logger.info('Shutdown signal received: closing HTTP server...');

  server.close(async () => {
    logger.info('HTTP server closed');

    try {
      await disconnectDatabase();
      logger.info('Database connection closed');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', { error });
      process.exit(1);
    }
  });

  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
}

async function startServer(): Promise<void> {
  try {
    await connectDatabase();

    const app = createApp();

    const server = app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`, {
        environment: env.NODE_ENV,
        apiVersion: env.API_VERSION,
        healthCheck: `http://localhost:${PORT}/api/${env.API_VERSION}/health`,
        docs: `http://localhost:${PORT}/api-docs`,
      });
    });

    process.on('SIGTERM', () => gracefulShutdown(server));
    process.on('SIGINT', () => gracefulShutdown(server));

    process.on('uncaughtException', (error: Error) => {
      console.error('SERVER CRASH DETAILS:', error);
      logger.error('Uncaught Exception', { error });
      gracefulShutdown(server);
    });

    process.on('unhandledRejection', (reason: unknown) => {
      logger.error('Unhandled Rejection', { reason });
    });
  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

startServer();
