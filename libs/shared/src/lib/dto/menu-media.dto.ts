export type MenuMediaType = 'IMAGE' | 'DOCUMENT';

export interface MenuMediaDto {
  id: string;
  tenantId: string;
  type: MenuMediaType;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sortOrder: number;
  caption: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
}
