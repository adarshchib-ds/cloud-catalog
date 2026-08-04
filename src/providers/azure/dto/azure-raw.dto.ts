import { z } from 'zod';

// Zod schema for each item returned by the Azure Retail Prices API
export const AzureRetailPriceItemSchema = z.object({
  currencyCode: z.string(),
  tierMinimumUnits: z.number().optional(),
  retailPrice: z.number(),
  unitPrice: z.number(),
  armRegionName: z.string(),
  location: z.string(),
  effectiveStartDate: z.string(),
  meterId: z.string(),
  meterName: z.string(),
  productId: z.string(),
  skuId: z.string(),
  productName: z.string(),
  skuName: z.string(),
  serviceName: z.string(),
  serviceId: z.string(),
  serviceFamily: z.string(),
  unitOfMeasure: z.string(),
  type: z.string(),
  isPrimaryMeterRegion: z.boolean(),
  armSkuName: z.string(),
  reservationTerm: z.string().optional(),
});

export type AzureRetailPriceItem = z.infer<typeof AzureRetailPriceItemSchema>;

// Zod schema for the full Azure Retail Prices API response
export const AzureRetailPriceResponseSchema = z.object({
  BillingCurrency: z.string(),
  CustomerEntityId: z.string(),
  CustomerEntityType: z.string(),
  Items: z.array(AzureRetailPriceItemSchema),
  NextPageLink: z.string().nullable().optional(),
});

export type AzureRetailPriceResponse = z.infer<typeof AzureRetailPriceResponseSchema>;
