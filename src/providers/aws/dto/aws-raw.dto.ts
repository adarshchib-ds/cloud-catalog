import { z } from 'zod';

// Raw Region Validation Schema
export const AwsRawRegionSchema = z.object({
  RegionName: z.string(),
  OptInStatus: z.string().optional(),
});
export type AwsRawRegion = z.infer<typeof AwsRawRegionSchema>;

// Raw Instance Type Validation Schema
export const AwsRawInstanceTypeSchema = z.object({
  InstanceType: z.string(),
  VCpuInfo: z.object({
    DefaultVCpus: z.number(),
  }),
  MemoryInfo: z.object({
    SizeInMiB: z.number(),
  }),
  ProcessorInfo: z.object({
    SupportedArchitectures: z.array(z.string()),
    SustainedClockSpeedInGhz: z.number().optional(),
  }),
  GpuInfo: z
    .object({
      Gpus: z
        .array(
          z.object({
            Name: z.string().optional(),
            Manufacturer: z.string().optional(),
            Count: z.number().optional(),
            MemoryInfo: z
              .object({
                SizeInMiB: z.number().optional(),
              })
              .optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  NetworkInfo: z
    .object({
      NetworkPerformance: z.string().optional(),
      NetworkBandwidthGbps: z.number().optional(),
    })
    .optional(),
});
export type AwsRawInstanceType = z.infer<typeof AwsRawInstanceTypeSchema>;

// Raw Pricing Product Attribute Validation Schema
export const AwsRawPricingProductSchema = z.object({
  product: z.object({
    productFamily: z.string(),
    attributes: z.object({
      instanceType: z.string(),
      operatingSystem: z.string(),
      tenancy: z.string(),
      licenseModel: z.string().optional(),
      regionCode: z.string().optional(),
      physicalProcessor: z.string().optional(),
      storage: z.string().optional(),
    }),
  }),
  terms: z.object({
    OnDemand: z
      .record(
        z.object({
          priceDimensions: z.record(
            z.object({
              pricePerUnit: z.object({
                USD: z.string(),
              }),
            }),
          ),
        }),
      )
      .optional(),
    Reserved: z
      .record(
        z.object({
          termAttributes: z
            .object({
              LeaseContractLength: z.string().optional(),
              PurchaseOption: z.string().optional(),
              OfferingClass: z.string().optional(),
            })
            .optional(),
          priceDimensions: z.record(
            z.object({
              pricePerUnit: z.object({
                USD: z.string(),
              }),
            }),
          ),
        }),
      )
      .optional(),
  }),
});
export type AwsRawPricingProduct = z.infer<typeof AwsRawPricingProductSchema>;
