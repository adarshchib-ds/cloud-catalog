import { z } from 'zod';

const searchInstancesQuerySchema = z.object({
  provider: z
    .preprocess(
      val => (typeof val === 'string' ? val.toLowerCase().trim() : val),
      z.enum(['aws', 'azure', 'gcp']),
    )
    .optional(),
  region: z.string().min(1).max(50).optional(),
  service: z.string().min(1).max(100).optional(),
  tenancy: z.enum(['SHARED', 'DEDICATED_INSTANCE', 'DEDICATED_HOST', 'SOLE_TENANT']).optional(),
  instanceFamily: z.string().min(1).max(100).optional(),
  architecture: z
    .preprocess(
      val => (typeof val === 'string' ? val.toUpperCase().trim() : val),
      z.enum(['X86_64', 'ARM64', 'X86']),
    )
    .optional(),
  minVcpu: z.coerce.number().int().min(1).optional(),
  maxVcpu: z.coerce.number().int().min(1).optional(),
  minMemory: z.coerce.number().min(0).optional(),
  maxMemory: z.coerce.number().min(0).optional(),
  hasGpu: z
    .preprocess(val => {
      if (val === 'true') return true;
      if (val === 'false') return false;
      return val;
    }, z.boolean())
    .optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const familyRecommendationSchema = z.object({
  provider: z.enum(['aws', 'azure', 'gcp']).optional(),
  region: z.string().min(1).max(50).optional(),
  tenancy: z.enum(['SHARED', 'DEDICATED_INSTANCE', 'DEDICATED_HOST', 'SOLE_TENANT']).optional(),
  vcpu: z.coerce.number().int().min(1).optional(),
  memory: z.coerce.number().min(0).optional(),
  hasGpu: z
    .preprocess(val => {
      if (val === 'true') return true;
      if (val === 'false') return false;
      return val;
    }, z.boolean())
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(12),
});

const getRegionsQuerySchema = z.object({
  provider: z.enum(['aws', 'azure', 'gcp']).optional(),
});

const smartRecommendationSchema = z.object({
  reqVcpu: z.coerce.number().int().min(1),
  reqMemoryGib: z.coerce.number().min(0),
  region: z.string().min(1).max(100).optional(),
  tenancy: z.enum(['SHARED', 'DEDICATED_INSTANCE', 'DEDICATED_HOST', 'SOLE_TENANT']).optional(),
  operatingSystem: z.enum(['LINUX', 'WINDOWS', 'UBUNTU', 'RED_HAT', 'SUSE']).optional(),
  pricingModel: z.enum(['ON_DEMAND', 'SPOT', 'RESERVED', 'COMMITMENT']).optional(),
});

export type SearchInstancesQuery = z.infer<typeof searchInstancesQuerySchema>;
export type FamilyRecommendationQuery = z.infer<typeof familyRecommendationSchema>;
export type GetRegionsQuery = z.infer<typeof getRegionsQuerySchema>;
export type SmartRecommendationBody = z.infer<typeof smartRecommendationSchema>;

export {
  searchInstancesQuerySchema,
  familyRecommendationSchema,
  getRegionsQuerySchema,
  smartRecommendationSchema,
};
