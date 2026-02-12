export type ID = string;

export type Nullable<T> = T | null;

export type Optional<T> = T | undefined;

export interface Timestamps {
  createdAt: Date;
  updatedAt: Date;
}

export interface SoftDelete {
  deletedAt: Date | null;
}

export type SortOrder = 'asc' | 'desc';

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface SortParams {
  sortBy: string;
  sortOrder: SortOrder;
}

export type QueryParams = Partial<PaginationParams & SortParams>;


