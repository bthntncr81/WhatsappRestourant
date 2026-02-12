// ==================== MENU VERSION ====================

export interface MenuVersionDto {
  id: string;
  tenantId: string;
  version: number;
  createdAt: string;
  publishedAt: string | null;
  itemCount?: number;
}

export interface CreateMenuVersionDto {
  // Auto-increments version number
}

export interface PublishMenuVersionDto {
  // Just triggers publish
}

// ==================== MENU ITEM ====================

export interface MenuItemDto {
  id: string;
  tenantId: string;
  versionId: string;
  name: string;
  description: string | null;
  basePrice: number;
  category: string;
  isActive: boolean;
  sortOrder: number;
  optionGroups?: MenuOptionGroupDto[];
}

export interface CreateMenuItemDto {
  name: string;
  description?: string;
  basePrice: number;
  category: string;
  isActive?: boolean;
  sortOrder?: number;
  optionGroupIds?: string[];
}

export interface UpdateMenuItemDto {
  name?: string;
  description?: string;
  basePrice?: number;
  category?: string;
  isActive?: boolean;
  sortOrder?: number;
  optionGroupIds?: string[];
}

// ==================== OPTION GROUP ====================

export type OptionGroupType = 'SINGLE' | 'MULTI';

export interface MenuOptionGroupDto {
  id: string;
  tenantId: string;
  versionId: string;
  name: string;
  type: OptionGroupType;
  required: boolean;
  minSelect: number;
  maxSelect: number | null;
  sortOrder: number;
  options?: MenuOptionDto[];
}

export interface CreateMenuOptionGroupDto {
  name: string;
  type: OptionGroupType;
  required?: boolean;
  minSelect?: number;
  maxSelect?: number;
  sortOrder?: number;
}

export interface UpdateMenuOptionGroupDto {
  name?: string;
  type?: OptionGroupType;
  required?: boolean;
  minSelect?: number;
  maxSelect?: number;
  sortOrder?: number;
}

// ==================== OPTION ====================

export interface MenuOptionDto {
  id: string;
  tenantId: string;
  versionId: string;
  groupId: string;
  name: string;
  priceDelta: number;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface CreateMenuOptionDto {
  groupId: string;
  name: string;
  priceDelta?: number;
  isDefault?: boolean;
  isActive?: boolean;
  sortOrder?: number;
}

export interface UpdateMenuOptionDto {
  name?: string;
  priceDelta?: number;
  isDefault?: boolean;
  isActive?: boolean;
  sortOrder?: number;
}

// ==================== SYNONYM ====================

export interface MenuSynonymDto {
  id: string;
  tenantId: string;
  versionId: string;
  phrase: string;
  mapsToItemId: string | null;
  mapsToOptionId: string | null;
  weight: number;
  itemName?: string;
  optionName?: string;
}

export interface CreateMenuSynonymDto {
  phrase: string;
  mapsToItemId?: string;
  mapsToOptionId?: string;
  weight?: number;
}

export interface UpdateMenuSynonymDto {
  phrase?: string;
  mapsToItemId?: string;
  mapsToOptionId?: string;
  weight?: number;
}

// ==================== CANONICAL EXPORT ====================

export interface CanonicalMenuExport {
  version: number;
  exportedAt: string;
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
  categories: CanonicalCategory[];
  optionGroups: CanonicalOptionGroup[];
  synonyms: CanonicalSynonym[];
}

export interface CanonicalCategory {
  name: string;
  items: CanonicalMenuItem[];
}

export interface CanonicalMenuItem {
  id: string;
  name: string;
  description: string | null;
  basePrice: number;
  isActive: boolean;
  optionGroupIds: string[];
}

export interface CanonicalOptionGroup {
  id: string;
  name: string;
  type: OptionGroupType;
  required: boolean;
  minSelect: number;
  maxSelect: number | null;
  options: CanonicalOption[];
}

export interface CanonicalOption {
  id: string;
  name: string;
  priceDelta: number;
  isDefault: boolean;
  isActive: boolean;
}

export interface CanonicalSynonym {
  phrase: string;
  mapsTo: {
    type: 'item' | 'option';
    id: string;
    name: string;
  };
  weight: number;
}

// ==================== IMPORT ====================

export interface MenuImportDto {
  categories: ImportCategory[];
  optionGroups: ImportOptionGroup[];
  synonyms?: ImportSynonym[];
}

export interface ImportCategory {
  name: string;
  items: ImportMenuItem[];
}

export interface ImportMenuItem {
  name: string;
  description?: string;
  basePrice: number;
  isActive?: boolean;
  optionGroupNames?: string[];
}

export interface ImportOptionGroup {
  name: string;
  type: OptionGroupType;
  required?: boolean;
  minSelect?: number;
  maxSelect?: number;
  options: ImportOption[];
}

export interface ImportOption {
  name: string;
  priceDelta?: number;
  isDefault?: boolean;
  isActive?: boolean;
}

export interface ImportSynonym {
  phrase: string;
  mapsToItemName?: string;
  mapsToOptionName?: string;
  weight?: number;
}

export interface MenuImportResultDto {
  versionId: string;
  version: number;
  itemsCreated: number;
  optionGroupsCreated: number;
  optionsCreated: number;
  synonymsCreated: number;
}


