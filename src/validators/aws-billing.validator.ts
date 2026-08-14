import { z } from 'zod';

export const awsBillingRequestSchema = z.object({
  accountId: z
    .string()
    .trim()
    .refine(val => !val || /^\d{12}$/.test(val), {
      message: 'AWS Account ID must be a 12-digit numeric string',
    })
    .optional(),
  accessKeyId: z.string().trim().optional(),
  secretAccessKey: z.string().trim().optional(),
  region: z.string().trim().min(1).max(50).optional(),
});

export type AwsBillingRequest = z.infer<typeof awsBillingRequestSchema>;
