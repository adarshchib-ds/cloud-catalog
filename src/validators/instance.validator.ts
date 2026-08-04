import { z } from 'zod';

const tenancySchema = z
  .preprocess(val => {
    if (typeof val === 'string') {
      const normalized = val.toUpperCase().trim();
      if (normalized.includes('SOLE TENANT') || normalized.includes('SOLE_TENANT')) {
        return 'SOLE_TENANT';
      }
      if (normalized.includes('DEDICATED HOST') || normalized.includes('DEDICATED_HOST')) {
        return 'DEDICATED_HOST';
      }
      if (normalized.includes('DEDICATED INSTANCE') || normalized.includes('DEDICATED_INSTANCE')) {
        return 'DEDICATED_INSTANCE';
      }
      if (normalized.includes('SHARED')) {
        return 'SHARED';
      }
      if (normalized === 'ANY' || normalized === 'ALL' || normalized === '') return undefined;
      return normalized;
    }
    return val;
  }, z.enum(['SHARED', 'DEDICATED_INSTANCE', 'DEDICATED_HOST', 'SOLE_TENANT']).optional())
  .optional();

const searchInstancesQuerySchema = z.object({
  provider: z
    .preprocess(
      val => (typeof val === 'string' ? val.toLowerCase().trim() : val),
      z.enum(['aws', 'azure', 'gcp']),
    )
    .optional(),
  region: z.string().min(1).max(50).optional(),
  service: z.string().min(1).max(100).optional(),
  tenancy: tenancySchema,
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
      if (typeof val === 'string') {
        const normalized = val.toLowerCase().trim();
        if (normalized === 'true' || normalized === 'gpu') return true;
        if (normalized === 'false' || normalized === 'no_gpu' || normalized === 'no gpu' || normalized === 'nogpu') return false;
        if (normalized === 'any' || normalized === 'all' || normalized === '') return undefined;
      }
      if (val === true) return true;
      if (val === false) return false;
      return val;
    }, z.boolean().optional())
    .optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const familyRecommendationSchema = z.object({
  provider: z.enum(['aws', 'azure', 'gcp']).optional(),
  region: z.string().min(1).max(50).optional(),
  tenancy: tenancySchema,
  operatingSystem: z.string().trim().transform(val => val.toUpperCase()).optional(),
  vcpu: z.coerce.number().int().min(1).optional(),
  memory: z.coerce.number().min(0).optional(),
  hasGpu: z
    .preprocess(val => {
      if (typeof val === 'string') {
        const normalized = val.toLowerCase().trim();
        if (normalized === 'true' || normalized === 'gpu') return true;
        if (normalized === 'false' || normalized === 'no_gpu' || normalized === 'no gpu' || normalized === 'nogpu') return false;
        if (normalized === 'any' || normalized === 'all' || normalized === '') return undefined;
      }
      if (val === true) return true;
      if (val === false) return false;
      return val;
    }, z.boolean().optional())
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(12),
});

const getRegionsQuerySchema = z.object({
  provider: z.enum(['aws', 'azure', 'gcp']).optional(),
});

const smartRecommendationSchema = z.object({
  reqVcpu: z.coerce.number().int().min(1).optional(),
  reqMemoryGib: z.coerce.number().min(0).optional(),
  region: z.string().min(1).max(100).optional(),
  tenancy: tenancySchema,
  operatingSystem: z.string().trim().transform(val => val.toUpperCase()).optional(),
  pricingModel: z.enum(['ON_DEMAND', 'SPOT', 'RESERVED', 'COMMITMENT']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
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
