import { Router } from 'express';
import { 
  getAccountInfoHandler, 
  getAccountBillingHandler, 
  generateConnectLinkHandler, 
  fetchBillingCrossAccountHandler 
} from '@controllers/aws-billing.controller';
import { validate } from '../middleware/validate';
import { awsBillingRequestSchema } from '../validators/aws-billing.validator';

const router = Router();

/**
 * @route   GET /api/v1/aws/account-info
 * @route   POST /api/v1/aws/account-info
 * @desc    Fetch AWS Account ID, IAM Identity & Customer Contact Profile
 */
router.get('/account-info', validate(awsBillingRequestSchema), getAccountInfoHandler);
router.post('/account-info', validate(awsBillingRequestSchema), getAccountInfoHandler);

/**
 * @route   GET /api/v1/aws/account-billing
 * @route   POST /api/v1/aws/account-billing
 * @desc    Fetch Formatted AWS Billing Invoice & Service Breakdown Table
 */
router.get('/account-billing', validate(awsBillingRequestSchema), getAccountBillingHandler);
router.post('/account-billing', validate(awsBillingRequestSchema), getAccountBillingHandler);

/**
 * @route   POST /api/v1/aws/generate-connect-link
 * @desc    Deliverable C1: Generate 1-Click CloudFormation URL & External ID
 */
router.post('/generate-connect-link', generateConnectLinkHandler);

/**
 * @route   POST /api/v1/aws/fetch-billing
 * @desc    Deliverable C2: Ingest cross-account billing with STS AssumeRole & 24h DB Cache
 */
router.post('/fetch-billing', fetchBillingCrossAccountHandler);

export const awsRoutes: Router = router;
