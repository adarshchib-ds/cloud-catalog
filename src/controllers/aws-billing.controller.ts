import { Request, Response, NextFunction } from 'express';
import { getAwsAccountInfo, getAwsAccountBilling, generateConnectLink, fetchBillingWithAssumedRole } from '@services/aws-account-billing.service';

/**
 * Controller handler for GET/POST /api/v1/aws/account-info
 */
export async function getAccountInfoHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const params = { ...req.query, ...req.body };
    const { accessKeyId, secretAccessKey, region, accountId } = params;
    const info = await getAwsAccountInfo({ accessKeyId, secretAccessKey, region, accountId });
    res.status(200).json({
      success: true,
      data: info,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Controller handler for GET/POST /api/v1/aws/account-billing
 */
export async function getAccountBillingHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const params = { ...req.query, ...req.body };
    const { accessKeyId, secretAccessKey, region, accountId } = params;
    const billing = await getAwsAccountBilling({ accessKeyId, secretAccessKey, region, accountId });
    res.status(200).json({
      success: true,
      data: billing,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Deliverable C1: POST /api/v1/aws/generate-connect-link
 */
export async function generateConnectLinkHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { aws_account_id, user_id } = req.body;
    if (!aws_account_id || !/^\d{12}$/.test(String(aws_account_id).trim())) {
      res.status(400).json({
        success: false,
        error: { message: 'aws_account_id must be exactly 12 numeric digits.' },
      });
      return;
    }
    const result = await generateConnectLink(String(aws_account_id).trim(), user_id);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Deliverable C2: POST /api/v1/aws/fetch-billing (with 24h cache & AssumeRole)
 */
export async function fetchBillingCrossAccountHandler(req: Request, res: Response, _next: NextFunction) {
  try {
    const { aws_account_id, external_id, force_refresh } = req.body;
    if (!aws_account_id || !/^\d{12}$/.test(String(aws_account_id).trim())) {
      res.status(400).json({
        success: false,
        error: { message: 'aws_account_id must be exactly 12 numeric digits.' },
      });
      return;
    }
    const result = await fetchBillingWithAssumedRole(String(aws_account_id).trim(), Boolean(force_refresh), external_id ? String(external_id).trim() : undefined);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: {
        code: 'AWS_CROSS_ACCOUNT_ERROR',
        message: error.message || 'AccessDenied: CloudFormation stack creation or IAM role propagation is still in progress in AWS. Please wait 15-30 seconds and try again.',
      },
    });
  }
}
