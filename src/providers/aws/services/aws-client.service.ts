import {
  EC2Client,
  DescribeRegionsCommand,
  DescribeInstanceTypesCommand,
  DescribeSpotPriceHistoryCommand,
} from '@aws-sdk/client-ec2';
import {
  PricingClient,
  GetProductsCommand,
  GetProductsCommandInput,
  Filter,
} from '@aws-sdk/client-pricing';
import { AwsRawRegion, AwsRawInstanceType, AwsRawPricingProduct } from '../dto/aws-raw.dto';

// AWS SDK naturally uses default credentials from environment or ~/.aws/credentials
const ec2Client = new EC2Client({ region: 'us-east-1' });

// AWS Pricing API is only hosted in us-east-1 (or ap-south-1) globally
const pricingClient = new PricingClient({ region: 'us-east-1' });

export async function fetchAwsRegions(): Promise<AwsRawRegion[]> {
  try {
    const command = new DescribeRegionsCommand({ AllRegions: true });
    const response = await ec2Client.send(command);

    return (response.Regions || [])
      .map(r => ({
        RegionName: r.RegionName || '',
        OptInStatus: r.OptInStatus || '',
      }))
      .filter(r => r.RegionName !== '');
  } catch (error) {
    console.error('Error fetching AWS regions:', error);
    throw error;
  }
}

export async function fetchAwsInstanceTypes(): Promise<AwsRawInstanceType[]> {
  const instanceTypes: AwsRawInstanceType[] = [];
  let nextToken: string | undefined = undefined;

  try {
    do {
      const commandArgs = {
        NextToken: nextToken,
        MaxResults: 100,
      };
      const command = new DescribeInstanceTypesCommand(commandArgs);
      const response: any = await ec2Client.send(command);

      if (response.InstanceTypes) {
        for (const inst of response.InstanceTypes) {
          // Only validate and push if basic fields exist
          if (
            inst.InstanceType &&
            inst.VCpuInfo?.DefaultVCpus &&
            inst.MemoryInfo?.SizeInMiB &&
            inst.ProcessorInfo?.SupportedArchitectures
          ) {
            instanceTypes.push({
              InstanceType: inst.InstanceType,
              VCpuInfo: {
                DefaultVCpus: inst.VCpuInfo.DefaultVCpus,
              },
              MemoryInfo: {
                SizeInMiB: inst.MemoryInfo.SizeInMiB,
              },
              ProcessorInfo: {
                SupportedArchitectures: inst.ProcessorInfo.SupportedArchitectures,
                SustainedClockSpeedInGhz: inst.ProcessorInfo.SustainedClockSpeedInGhz ?? undefined,
              },
              GpuInfo: inst.GpuInfo
                ? {
                    Gpus:
                      inst.GpuInfo.Gpus?.map((g: any) => ({
                        Name: g.Name ?? undefined,
                        Manufacturer: g.Manufacturer ?? undefined,
                        Count: g.Count ?? undefined,
                        MemoryInfo: g.MemoryInfo
                          ? { SizeInMiB: g.MemoryInfo.SizeInMiB ?? undefined }
                          : undefined,
                      })) ?? undefined,
                  }
                : undefined,
              NetworkInfo: inst.NetworkInfo
                ? {
                    NetworkPerformance: inst.NetworkInfo.NetworkPerformance ?? undefined,
                    NetworkBandwidthGbps: inst.NetworkInfo.NetworkPerformance?.includes('Gbps')
                      ? parseFloat(inst.NetworkInfo.NetworkPerformance.split(' ')[0])
                      : undefined,
                    EnaSupport: inst.NetworkInfo.EnaSupport ?? undefined,
                    EfaSupported: inst.NetworkInfo.EfaSupported ?? undefined,
                  }
                : undefined,
              InstanceStorageInfo: inst.InstanceStorageInfo
                ? {
                    TotalSizeInGB: inst.InstanceStorageInfo.TotalSizeInGB ?? undefined,
                    Disks:
                      inst.InstanceStorageInfo.Disks?.map((d: any) => ({
                        Count: d.Count ?? undefined,
                        SizeInGB: d.SizeInGB ?? undefined,
                        Type: d.Type ?? undefined,
                      })) ?? undefined,
                  }
                : undefined,
            });
          }
        }
      }
      nextToken = response.NextToken;
    } while (nextToken);

    return instanceTypes;
  } catch (error) {
    console.error('Error fetching AWS instance types:', error);
    throw error;
  }
}

export async function fetchAwsPrices(awsRegionCode: string): Promise<AwsRawPricingProduct[]> {
  const pricingProducts: AwsRawPricingProduct[] = [];
  let nextToken: string | undefined = undefined;

  // Filter attributes specifically for EC2 Virtual Machines in the given region
  const filters: Filter[] = [
    { Type: 'TERM_MATCH', Field: 'serviceCode', Value: 'AmazonEC2' },
    { Type: 'TERM_MATCH', Field: 'regionCode', Value: awsRegionCode },
    { Type: 'TERM_MATCH', Field: 'preInstalledSw', Value: 'NA' },
  ];

  try {
    do {
      const commandArg: GetProductsCommandInput = {
        ServiceCode: 'AmazonEC2',
        Filters: filters,
        NextToken: nextToken,
        MaxResults: 100,
      };
      const pricingCommand = new GetProductsCommand(commandArg);
      const pricingResponse: any = await pricingClient.send(pricingCommand);

      if (pricingResponse.PriceList) {
        for (const rawItem of pricingResponse.PriceList) {
          try {
            // The API returns a stringified JSON document
            const parsed = JSON.parse(rawItem as string);
            const family = parsed.product?.productFamily;
            if (family === 'Compute Instance' || family === 'Compute Instance (bare metal)') {
              pricingProducts.push(parsed);
            }
          } catch (err) {
            console.warn('Failed parsing AWS pricing product:', err);
          }
        }
      }
      nextToken = pricingResponse.NextToken;
    } while (nextToken);

    return pricingProducts;
  } catch (error) {
    console.error(`Error fetching AWS prices for region ${awsRegionCode}:`, error);
    throw error;
  }
}

export async function fetchAwsSpotPrices(awsRegionCode: string): Promise<Map<string, number>> {
  const spotPriceMap = new Map<string, number>();
  const client = new EC2Client({ region: awsRegionCode });

  try {
    const command = new DescribeSpotPriceHistoryCommand({
      ProductDescriptions: ['Linux/UNIX'],
      StartTime: new Date(),
    });
    const response = await client.send(command);

    if (response.SpotPriceHistory) {
      response.SpotPriceHistory.forEach(item => {
        if (item.InstanceType && item.SpotPrice) {
          const price = parseFloat(item.SpotPrice);
          // DescribeSpotPriceHistory returns multiple entries; we only keep the latest one (first in output)
          if (!spotPriceMap.has(item.InstanceType)) {
            spotPriceMap.set(item.InstanceType, price);
          }
        }
      });
    }
    return spotPriceMap;
  } catch (error: any) {
    if (
      error.Code === 'AuthFailure' ||
      error.name === 'TimeoutError' ||
      error.code === 'ETIMEDOUT'
    ) {
      console.warn(
        `[WARN] Skipping spot prices for region ${awsRegionCode}: Region is disabled or timed out.`,
      );
    } else {
      console.error(
        `Error fetching AWS spot prices for region ${awsRegionCode}:`,
        error.message || error,
      );
    }
    return spotPriceMap; // Return empty map rather than crashing the sync
  }
}
