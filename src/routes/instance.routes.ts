import { Router } from 'express';

import {
  searchInstancesController,
  recommendFamiliesController,
  getRegionsController,
  handleSmartRecommendation,
  getMetadataController,
} from '@controllers/instance.controller';
import {
  searchInstancesQuerySchema,
  familyRecommendationSchema,
  getRegionsQuerySchema,
  smartRecommendationSchema,
} from '@validators/instance.validator';
import { validate } from '@middleware/validate';

const router: ReturnType<typeof Router> = Router();

router.get('/search', validate(searchInstancesQuerySchema, 'query'), searchInstancesController);

router.get('/metadata', getMetadataController);

router.get('/families', validate(familyRecommendationSchema, 'query'), recommendFamiliesController);

router.get('/regions', validate(getRegionsQuerySchema, 'query'), getRegionsController);

router.post('/recommend', validate(smartRecommendationSchema, 'body'), handleSmartRecommendation);

export { router as instanceRoutes };
