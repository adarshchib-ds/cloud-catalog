import { Request, Response } from 'express';
import {
  searchInstances,
  recommendFamilies,
  getRegions,
  getInstancesMetadata,
} from '@services/instance.service';
import {
  SearchInstancesQuery,
  FamilyRecommendationQuery,
  GetRegionsQuery,
  SmartRecommendationBody,
} from '@validators/instance.validator';
import { successResponse, successResponsePaginated, buildPaginationMeta } from '@utils/ApiResponse';
import { getSmartRecommendations } from '@services/recommendation.service';
import { logger } from '@config/logger';

export async function searchInstancesController(req: Request, res: Response): Promise<void> {
  try {
    const filters = req.query as unknown as SearchInstancesQuery;
    const result = await searchInstances(filters);

    res.status(200).json(
      successResponsePaginated(
        result.items,
        buildPaginationMeta({
          page: result.page,
          pageSize: result.pageSize,
          totalCount: result.totalCount,
          globalStats: result.globalStats,
        }),
      ),
    );
  } catch (error) {
    logger.error('Failed to search instances', { error, query: req.query });

    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to search instances',
      },
    });
  }
}

export async function recommendFamiliesController(req: Request, res: Response): Promise<void> {
  try {
    const filters = req.query as unknown as FamilyRecommendationQuery;
    const result = await recommendFamilies(filters);

    res.status(200).json(successResponse(result));
  } catch (error) {
    logger.error('Failed to recommend families', { error, query: req.query });

    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to recommend families',
      },
    });
  }
}

export async function getRegionsController(req: Request, res: Response): Promise<void> {
  try {
    const filters = req.query as unknown as GetRegionsQuery;
    const result = await getRegions(filters.provider);

    res.status(200).json(successResponse(result));
  } catch (error) {
    logger.error('Failed to get regions', { error, query: req.query });

    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to get regions',
      },
    });
  }
}

export async function handleSmartRecommendation(req: Request, res: Response): Promise<void> {
  try {
    const criteria = req.body as SmartRecommendationBody;
    const result = await getSmartRecommendations(criteria);
    res.status(200).json(successResponse(result));
  } catch (error: any) {
    logger.error('Failed to resolve smart recommendation', { error, body: req.body });

    if (error.message === 'AWS provider not found.') {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: error.message },
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to process recommendation engine logic.',
      },
    });
  }
}

export async function getMetadataController(_req: Request, res: Response): Promise<void> {
  try {
    const result = await getInstancesMetadata();
    res.status(200).json(successResponse(result));
  } catch (error) {
    logger.error('Failed to resolve instances metadata', { error });
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve cloud catalog metadata metrics.',
      },
    });
  }
}
