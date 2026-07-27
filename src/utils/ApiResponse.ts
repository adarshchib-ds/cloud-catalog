import { PaginationMeta } from '@/types';

export interface SuccessResponse<T> {
  success: true;
  data: T;
  meta?: PaginationMeta;
}

export interface MessageResponse {
  success: true;
  data: {
    message: string;
  };
}

export function successResponse<T>(data: T): SuccessResponse<T> {
  return {
    success: true,
    data,
  };
}

export function successResponsePaginated<T>(data: T[], meta: PaginationMeta): SuccessResponse<T[]> {
  return {
    success: true,
    data,
    meta,
  };
}

export function messageResponse(message: string): MessageResponse {
  return {
    success: true,
    data: { message },
  };
}

export function buildPaginationMeta(params: {
  page: number;
  pageSize: number;
  totalCount: number;
  globalStats?: {
    totalInstances: number;
    gpuInstances: number;
    totalProviders: number;
  };
}): PaginationMeta {
  const { page, pageSize, totalCount, globalStats } = params;
  const totalPages = Math.ceil(totalCount / pageSize);

  return {
    page,
    pageSize,
    totalCount,
    totalPages,
    globalStats,
  };
}
