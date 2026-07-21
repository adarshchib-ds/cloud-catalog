import { Request, Response } from 'express';

import { prisma } from '@config/database';
import { logger } from '@config/logger';

interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  version: string;
  environment: string;
  checks: {
    database: 'connected' | 'disconnected';
    uptime: number;
    memory: NodeJS.MemoryUsage;
  };
}

export async function getHealth(_req: Request, res: Response): Promise<void> {
  const startTime = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;

    const health: HealthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      checks: {
        database: 'connected',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      },
    };

    logger.debug('Health check passed', {
      duration: Date.now() - startTime,
      database: 'connected',
    });

    res.status(200).json({
      success: true,
      data: health,
    });
  } catch (error) {
    logger.error('Health check failed', { error });

    const health: HealthStatus = {
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      checks: {
        database: 'disconnected',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      },
    };

    res.status(503).json({
      success: false,
      data: health,
    });
  }
}

export async function getReadiness(_req: Request, res: Response): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.status(200).json({
      success: true,
      data: {
        ready: true,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Readiness check failed', { error });

    res.status(503).json({
      success: true,
      data: {
        ready: false,
        timestamp: new Date().toISOString(),
      },
    });
  }
}

export function getLiveness(_req: Request, res: Response): void {
  res.status(200).json({
    success: true,
    data: {
      alive: true,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    },
  });
}
