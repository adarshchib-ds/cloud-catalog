import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { AccountClient, GetContactInformationCommand } from '@aws-sdk/client-account';
import { CostExplorerClient, GetCostAndUsageCommand, GetDimensionValuesCommand } from '@aws-sdk/client-cost-explorer';
import { OrganizationsClient, DescribeAccountCommand } from '@aws-sdk/client-organizations';
import { logger } from '../config/logger';

export interface AwsCredentials {
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  region?: string;
  accountId?: string;
}

/**
 * Resolves credentials from passed params or environment variables.
 */
function resolveCredentials(passedCredentials?: Partial<AwsCredentials>): { accessKeyId: string; secretAccessKey: string; sessionToken?: string; region: string; accountId?: string } {
  let accessKeyId = passedCredentials?.accessKeyId?.trim();
  let secretAccessKey = passedCredentials?.secretAccessKey?.trim();
  let sessionToken = passedCredentials?.sessionToken?.trim();
  const region = passedCredentials?.region?.trim() || 'us-east-1';
  let accountId = passedCredentials?.accountId?.trim();

  // If accessKeyId is actually a 12-digit AWS Account ID (e.g., "582983022238"), set accountId and clear accessKeyId
  if (accessKeyId && /^\d{12}$/.test(accessKeyId)) {
    if (!accountId) {
      accountId = accessKeyId;
    }
    accessKeyId = undefined;
  }

  // Strictly enforce user provided credentials
  if (!accessKeyId || !secretAccessKey) {
    // If no credentials passed, fall back to process.env ONLY if explicitly set
    accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    sessionToken = process.env.AWS_SESSION_TOKEN;
  }

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('AWS credentials required. Please provide valid AWS Access Key ID and Secret Access Key.');
  }

  return { accessKeyId, secretAccessKey, sessionToken, region, accountId };
}


/**
 * Fetches AWS Account Identity & Customer Contact Details.
 */
export async function getAwsAccountInfo(passedCredentials?: Partial<AwsCredentials>) {
  const credentials = resolveCredentials(passedCredentials);
  logger.info('Fetching AWS Account & Customer Profile Info...');

  const awsCreds = {
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    ...(credentials.sessionToken ? { sessionToken: credentials.sessionToken } : {}),
  };

  let accountID = credentials.accountId || '';
  let userArn = '';
  let userID = '';

  // 1. Fetch Account ID & User ARN via STS
  const stsClient = new STSClient({ region: credentials.region, credentials: awsCreds });
  const callerRes = await stsClient.send(new GetCallerIdentityCommand({}));
  if (!accountID) {
    accountID = callerRes.Account || '';
  }
  userArn = callerRes.Arn || '';
  userID = callerRes.UserId || '';

  // 2. Fetch Customer Contact Info via Account API
  let customerContact: any = {};
  try {
    const accountClient = new AccountClient({ region: 'us-east-1', credentials: awsCreds });
    const contactRes = await accountClient.send(new GetContactInformationCommand({}));
    customerContact = contactRes.ContactInformation || {};
  } catch (err: any) {
    logger.warn(`AWS Contact Info notice (${err.name}): ${err.message}`);
    // If IAM user doesn't have account:GetContactInformation permission, use the IAM User name
    const iamUserName = userArn.split('/').pop() || 'AWS User';
    customerContact = {
      FullName: iamUserName,
      AddressLine1: 'N/A (Requires account:GetContactInformation IAM permission)',
      City: '',
      StateOrRegion: '',
      PostalCode: '',
      CountryCode: '',
    };
  }

  // 3. Try to fetch AWS Organization Account Name if a target Account ID was supplied
  let orgAccountName = '';
  if (credentials.accountId && credentials.accountId !== callerRes.Account) {
    try {
      const orgClient = new OrganizationsClient({ region: 'us-east-1', credentials: awsCreds });
      const orgRes = await orgClient.send(new DescribeAccountCommand({ AccountId: credentials.accountId }));
      if (orgRes.Account?.Name) {
        orgAccountName = orgRes.Account.Name;
      }
    } catch (err: any) {
      logger.info(`AWS Organizations DescribeAccount notice: ${err.message}`);
    }
  }

  // If a specific target Account ID was requested (different from server credentials account)
  const isTargetAccountIdPassed = credentials.accountId && credentials.accountId !== callerRes.Account;
  const displayName = orgAccountName 
    ? `AWS Account: ${orgAccountName} (${accountID})` 
    : (isTargetAccountIdPassed ? `AWS Account Owner (${accountID})` : (customerContact.FullName || customerContact.CompanyName || 'AWS Account Owner'));

  return {
    accountID: accountID,
    userArn,
    userID,
    callerAccount: callerRes.Account,
    customerContact: {
      fullName: displayName,
      addressLine1: customerContact.AddressLine1 || `Account ID: ${accountID}`,
      city: customerContact.City || '',
      stateOrRegion: customerContact.StateOrRegion || '',
      postalCode: customerContact.PostalCode || '',
      countryCode: customerContact.CountryCode || '',
      phoneNumber: customerContact.PhoneNumber || '',
    },
  };
}


/**
 * Fetches & Formats AWS Invoice Billing Breakdown.
 */
export async function getAwsAccountBilling(passedCredentials?: Partial<AwsCredentials>) {
  const credentials = resolveCredentials(passedCredentials);
  logger.info('Fetching AWS Cost Explorer Billing Data...');

  const accountInfo = await getAwsAccountInfo(passedCredentials);

  // Billing Period calculation
  const targetDate = new Date();
  const year = targetDate.getFullYear();
  const month = targetDate.getMonth();
  const startOfMonth = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  
  const tomorrow = new Date(targetDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const endPeriod = tomorrow.toISOString().split('T')[0];
  const todayStr = targetDate.toISOString().split('T')[0];

  const awsCreds = {
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    ...(credentials.sessionToken ? { sessionToken: credentials.sessionToken } : {}),
  };

  // Query AWS Cost Explorer
  const ceClient = new CostExplorerClient({
    region: 'us-east-1',
    credentials: awsCreds,
  });

  // Verify target Account ID existence if target account ID is specified and different from caller
  if (credentials.accountId && credentials.accountId !== accountInfo.callerAccount) {
    try {
      const checkRes = await ceClient.send(
        new GetDimensionValuesCommand({
          TimePeriod: { Start: startOfMonth, End: endPeriod },
          Dimension: 'LINKED_ACCOUNT',
          SearchString: credentials.accountId,
        })
      );
      if (!checkRes.DimensionValues || checkRes.DimensionValues.length === 0) {
        throw new Error(`AWS Account ID '${credentials.accountId}' was not found or is not associated with your AWS billing credentials.`);
      }
    } catch (err: any) {
      if (err.message.includes('was not found')) {
        throw err;
      }
      logger.warn(`Dimension check warning: ${err.message}`);
    }
  }

  const isAssumedRoleSameAccount = credentials.accountId && accountInfo.callerAccount === credentials.accountId;
  const queryFilter: any = (credentials.accountId && !isAssumedRoleSameAccount)
    ? {
        Dimensions: {
          Key: 'LINKED_ACCOUNT',
          Values: [credentials.accountId],
        },
      }
    : undefined;

  const costRes = await ceClient.send(
    new GetCostAndUsageCommand({
      TimePeriod: { Start: startOfMonth, End: endPeriod },
      Granularity: 'MONTHLY',
      Metrics: ['UnblendedCost'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
      Filter: queryFilter,
    }),
  );

  let totalDue = 0;
  const servicesBreakdownTable: any[] = [];

  const timeResults = costRes.ResultsByTime || [];
  if (timeResults.length > 0) {
    const latestPeriod = timeResults[timeResults.length - 1];
    const groups = latestPeriod.Groups || [];

    for (const grp of groups) {
      const serviceName = grp.Keys?.[0] || 'Other Services';
      const rawCostStr = grp.Metrics?.UnblendedCost?.Amount || '0';
      const rawCost = Math.max(0, parseFloat(rawCostStr));

      servicesBreakdownTable.push({
        serviceName,
        amountDueFormatted: `$ ${rawCost.toFixed(2)}`,
        amountRaw: rawCost,
      });

      totalDue += rawCost;
    }
  }

  if (servicesBreakdownTable.length === 0) {
    servicesBreakdownTable.push({
      serviceName: 'No Active AWS Charges / Free Tier Usage',
      amountDueFormatted: '$ 0.00',
      amountRaw: 0,
    });
  }

  // Sort by highest cost first
  servicesBreakdownTable.sort((a, b) => b.amountRaw - a.amountRaw);

  return {
    invoiceHeader: {
      accountID: credentials.accountId || accountInfo.accountID,
      statementDate: todayStr,
      billingPeriod: `${startOfMonth} to ${todayStr}`,
    },
    billTo: {
      name: accountInfo.customerContact.fullName,
      addressLine1: accountInfo.customerContact.addressLine1,
      cityStateZip: `${accountInfo.customerContact.city}, ${accountInfo.customerContact.stateOrRegion}, ${accountInfo.customerContact.postalCode}`,
      country: accountInfo.customerContact.countryCode,
    },
    serviceProvider: {
      name: 'Amazon Web Services LLC',
      address: '410 Terry Avenue North, Seattle WA 98109-5210',
    },
    servicesBreakdownTable,
    summary: {
      totalDueFormatted: `$ ${totalDue.toFixed(2)}`,
      totalDueRaw: totalDue,
      currency: 'USD',
    },
  };
}


/**
 * Deliverable C1: Generates 1-Click CloudFormation Quick-Create Link & External ID.
 */
export async function generateConnectLink(awsAccountId: string, userId?: string) {
  const crypto = await import('crypto');
  const saasAccountId = (process.env.AWS_SAAS_ACCOUNT_ID || '582983022238').trim();
  const roleArn = `arn:aws:iam::${awsAccountId.trim()}:role/CloudCatalogCostSyncRole`;

  let externalId: string = '';

  // Try checking existing connection record from database if prisma is configured
  try {
    const { prisma } = await import('../config/database');
    const existing = await (prisma as any).awsAccountConnection.findUnique({
      where: { awsAccountId },
    });
    if (existing && existing.externalId) {
      externalId = existing.externalId;
    }
  } catch (err: any) {
    logger.info(`Prisma read notice: ${err.message}`);
  }

  if (!externalId) {
    externalId = crypto.randomUUID();
  }

  const s3PublicUrl = 'https://cloudcatalog-templates-public-2026.s3.amazonaws.com/cloudcatalog-role.yaml';
  const s3TemplateUrl = encodeURIComponent(s3PublicUrl);

  const quickCreateUrl = `https://console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/create/review?stackName=CloudCatalog-Integration&templateURL=${s3TemplateUrl}&param_SaaSAccountId=${saasAccountId}&param_ExternalId=${externalId}&filteringCapabilities=CAPABILITY_NAMED_IAM`;

  // Try saving connection record to database if prisma is configured
  try {
    const { prisma } = await import('../config/database');
    await (prisma as any).awsAccountConnection.upsert({
      where: { awsAccountId },
      update: {
        externalId,
        roleArn,
        status: 'PENDING',
        userId,
      },
      create: {
        awsAccountId,
        externalId,
        roleArn,
        status: 'PENDING',
        userId,
      },
    });
  } catch (err: any) {
    logger.info(`DB record skip/notice: ${err.message}`);
  }

  return {
    aws_account_id: awsAccountId,
    external_id: externalId,
    role_arn: roleArn,
    quick_create_url: quickCreateUrl,
  };
}

/**
 * Deliverable C2: AssumeRole STS Authentication & 24h Cached Billing/Profile Ingestion.
 */
export async function fetchBillingWithAssumedRole(awsAccountId: string, forceRefresh: boolean = false, passedExternalId?: string) {
  let connectionRecord: any = null;

  try {
    const { prisma } = await import('../config/database');
    connectionRecord = await (prisma as any).awsAccountConnection.findUnique({
      where: { awsAccountId },
    });
  } catch (err: any) {
    logger.info(`Prisma check notice: ${err.message}`);
  }

  // 1. Check 24-Hour Cache
  if (!forceRefresh && connectionRecord && connectionRecord.lastSyncedAt && connectionRecord.cachedBillingData) {
    const now = new Date();
    const lastSynced = new Date(connectionRecord.lastSyncedAt);
    const diffHours = (now.getTime() - lastSynced.getTime()) / (1000 * 60 * 60);

    if (diffHours < 24) {
      logger.info(`Returning 24-hour cached billing payload ($0.00 AWS API cost) for account ${awsAccountId}`);
      return {
        status: connectionRecord.status,
        cached: true,
        last_synced_at: connectionRecord.lastSyncedAt,
        profile: connectionRecord.cachedProfileData,
        billing: connectionRecord.cachedBillingData,
      };
    }
  }

  // 2. Prepare AssumeRole Credentials
  const externalId = passedExternalId || connectionRecord?.externalId || `ext-${awsAccountId}`;
  let roleArn = connectionRecord?.roleArn || `arn:aws:iam::${awsAccountId}:role/CloudCatalogCostSyncRole`;

  const serverAccessKey = process.env.AWS_ACCESS_KEY_ID;
  const serverSecretKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!serverAccessKey || !serverSecretKey) {
    throw new Error('SaaS Server AWS credentials missing in environment.');
  }

  const stsClient = new STSClient({
    region: 'us-east-1',
    credentials: { accessKeyId: serverAccessKey, secretAccessKey: serverSecretKey },
  });

  let assumedCredentials: any;
  try {
    const { AssumeRoleCommand } = await import('@aws-sdk/client-sts');
    let assumeRes;
    try {
      assumeRes = await stsClient.send(
        new AssumeRoleCommand({
          RoleArn: roleArn,
          RoleSessionName: 'CloudCatalogSyncSession',
          ExternalId: externalId,
          DurationSeconds: 3600,
        })
      );
    } catch (err: any) {
      const fallbackRoleArn = `arn:aws:iam::${awsAccountId}:role/CloudCatalogCostSyncRole`;
      logger.info(`Trying fallback Role ARN: ${fallbackRoleArn}`);
      assumeRes = await stsClient.send(
        new AssumeRoleCommand({
          RoleArn: fallbackRoleArn,
          RoleSessionName: 'CloudCatalogSyncSession',
          ExternalId: externalId,
          DurationSeconds: 3600,
        })
      );
      roleArn = fallbackRoleArn;
    }

    if (!assumeRes.Credentials?.AccessKeyId || !assumeRes.Credentials?.SecretAccessKey) {
      throw new Error('Failed to acquire temporary STS session credentials.');
    }

    assumedCredentials = {
      accessKeyId: assumeRes.Credentials.AccessKeyId,
      secretAccessKey: assumeRes.Credentials.SecretAccessKey,
      sessionToken: assumeRes.Credentials.SessionToken,
      region: 'us-east-1',
      accountId: awsAccountId,
    };
  } catch (err: any) {
    logger.error(`STS AssumeRole AccessDenied for ${awsAccountId}: ${err.message}`);
    throw new Error(`AccessDenied: ${err.message}`);
  }

  // 3. Fetch Live Billing with Assumed Role Credentials
  const liveBilling = await getAwsAccountBilling(assumedCredentials);
  const liveProfile = await getAwsAccountInfo(assumedCredentials);

  // 4. Update Database Cache
  try {
    const { prisma } = await import('../config/database');
    await (prisma as any).awsAccountConnection.upsert({
      where: { awsAccountId },
      update: {
        status: 'ACTIVE',
        cachedBillingData: liveBilling,
        cachedProfileData: liveProfile,
        lastSyncedAt: new Date(),
      },
      create: {
        awsAccountId,
        externalId,
        roleArn,
        status: 'ACTIVE',
        cachedBillingData: liveBilling,
        cachedProfileData: liveProfile,
        lastSyncedAt: new Date(),
      },
    });
  } catch (err: any) {
    logger.info(`DB cache update notice: ${err.message}`);
  }

  return {
    status: 'ACTIVE',
    cached: false,
    last_synced_at: new Date(),
    profile: liveProfile,
    billing: liveBilling,
  };
}

