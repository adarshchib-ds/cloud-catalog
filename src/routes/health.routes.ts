import { Router } from 'express';

import { getHealth, getReadiness, getLiveness } from '@controllers/health.controller';

const router: ReturnType<typeof Router> = Router();

router.get('/', getHealth);
router.get('/ready', getReadiness);
router.get('/live', getLiveness);

export { router as healthRoutes };
