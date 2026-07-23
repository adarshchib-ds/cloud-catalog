import { z } from 'zod';

// Raw Region Validation Schema (Compute Engine API: regions.list)
export const GcpRawRegionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  status: z.string().optional(),
});
export type GcpRawRegion = z.infer<typeof GcpRawRegionSchema>;

// Raw Machine Type Validation Schema (Compute Engine API: machineTypes.aggregatedList)
export const GcpRawMachineTypeSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  guestCpus: z.number(),
  memoryMb: z.number(),
  zone: z.string(),
  isSharedCpu: z.boolean().optional(),
  architecture: z.string().optional(),
  accelerators: z
    .array(
      z.object({
        guestAcceleratorType: z.string(),
        guestAcceleratorCount: z.number(),
      }),
    )
    .optional(),
});
export type GcpRawMachineType = z.infer<typeof GcpRawMachineTypeSchema>;

// Raw SKU Validation Schema (Cloud Billing Catalog API: services/{serviceId}/skus)
export const GcpRawSkuSchema = z.object({
  skuId: z.string(),
  description: z.string(),
  category: z.object({
    resourceFamily: z.string(),
    resourceGroup: z.string(),
    usageType: z.string(),
  }),
  serviceRegions: z.array(z.string()),
  pricingInfo: z.array(
    z.object({
      pricingExpression: z.object({
        usageUnit: z.string(),
        tieredRates: z.array(
          z.object({
            startUsageAmount: z.number().optional(),
            unitPrice: z.object({
              currencyCode: z.string(),
              units: z.string().optional(),
              nanos: z.number().optional(),
            }),
          }),
        ),
      }),
    }),
  ),
});
export type GcpRawSku = z.infer<typeof GcpRawSkuSchema>;
