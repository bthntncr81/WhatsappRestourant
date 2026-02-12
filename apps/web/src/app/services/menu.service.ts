import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

// ==================== DTOs ====================

export interface MenuVersionDto {
  id: string;
  tenantId: string;
  version: number;
  createdAt: string;
  publishedAt: string | null;
  itemCount?: number;
}

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

export interface MenuOptionGroupDto {
  id: string;
  tenantId: string;
  versionId: string;
  name: string;
  type: 'SINGLE' | 'MULTI';
  required: boolean;
  minSelect: number;
  maxSelect: number | null;
  sortOrder: number;
  options?: MenuOptionDto[];
}

export interface CreateMenuOptionGroupDto {
  name: string;
  type: 'SINGLE' | 'MULTI';
  required?: boolean;
  minSelect?: number;
  maxSelect?: number;
  sortOrder?: number;
}

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
}

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

export interface CanonicalMenuExport {
  version: number;
  exportedAt: string;
  tenant: { id: string; name: string; slug: string };
  categories: Array<{
    name: string;
    items: Array<{
      id: string;
      name: string;
      description: string | null;
      basePrice: number;
      isActive: boolean;
      optionGroupIds: string[];
    }>;
  }>;
  optionGroups: Array<{
    id: string;
    name: string;
    type: 'SINGLE' | 'MULTI';
    required: boolean;
    minSelect: number;
    maxSelect: number | null;
    options: Array<{
      id: string;
      name: string;
      priceDelta: number;
      isDefault: boolean;
      isActive: boolean;
    }>;
  }>;
  synonyms: Array<{
    phrase: string;
    mapsTo: { type: 'item' | 'option'; id: string; name: string };
    weight: number;
  }>;
}

export interface MenuImportResultDto {
  versionId: string;
  version: number;
  itemsCreated: number;
  optionGroupsCreated: number;
  optionsCreated: number;
  synonymsCreated: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

@Injectable({
  providedIn: 'root',
})
export class MenuService {
  private http = inject(HttpClient);
  private authService = inject(AuthService);

  private get headers() {
    return { headers: this.authService.getAuthHeaders() };
  }

  // ==================== VERSIONS ====================

  getVersions(): Observable<ApiResponse<MenuVersionDto[]>> {
    return this.http.get<ApiResponse<MenuVersionDto[]>>(
      `${environment.apiBaseUrl}/menu/versions`,
      this.headers
    );
  }

  createVersion(): Observable<ApiResponse<MenuVersionDto>> {
    return this.http.post<ApiResponse<MenuVersionDto>>(
      `${environment.apiBaseUrl}/menu/versions`,
      {},
      this.headers
    );
  }

  publishVersion(versionId: string): Observable<ApiResponse<MenuVersionDto>> {
    return this.http.post<ApiResponse<MenuVersionDto>>(
      `${environment.apiBaseUrl}/menu/versions/${versionId}/publish`,
      {},
      this.headers
    );
  }

  exportVersion(versionId: string): Observable<ApiResponse<CanonicalMenuExport>> {
    return this.http.get<ApiResponse<CanonicalMenuExport>>(
      `${environment.apiBaseUrl}/menu/versions/${versionId}/export`,
      this.headers
    );
  }

  getPublishedMenu(): Observable<ApiResponse<CanonicalMenuExport | null>> {
    return this.http.get<ApiResponse<CanonicalMenuExport | null>>(
      `${environment.apiBaseUrl}/menu/published`,
      this.headers
    );
  }

  importMenu(data: unknown): Observable<ApiResponse<MenuImportResultDto>> {
    return this.http.post<ApiResponse<MenuImportResultDto>>(
      `${environment.apiBaseUrl}/menu/import`,
      data,
      this.headers
    );
  }

  // ==================== ITEMS ====================

  getItems(versionId: string): Observable<ApiResponse<MenuItemDto[]>> {
    return this.http.get<ApiResponse<MenuItemDto[]>>(
      `${environment.apiBaseUrl}/menu/versions/${versionId}/items`,
      this.headers
    );
  }

  createItem(versionId: string, dto: CreateMenuItemDto): Observable<ApiResponse<MenuItemDto>> {
    return this.http.post<ApiResponse<MenuItemDto>>(
      `${environment.apiBaseUrl}/menu/versions/${versionId}/items`,
      dto,
      this.headers
    );
  }

  updateItem(
    versionId: string,
    itemId: string,
    dto: Partial<CreateMenuItemDto>
  ): Observable<ApiResponse<MenuItemDto>> {
    return this.http.patch<ApiResponse<MenuItemDto>>(
      `${environment.apiBaseUrl}/menu/versions/${versionId}/items/${itemId}`,
      dto,
      this.headers
    );
  }

  deleteItem(versionId: string, itemId: string): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(
      `${environment.apiBaseUrl}/menu/versions/${versionId}/items/${itemId}`,
      this.headers
    );
  }

  // ==================== OPTION GROUPS ====================

  getOptionGroups(versionId: string): Observable<ApiResponse<MenuOptionGroupDto[]>> {
    return this.http.get<ApiResponse<MenuOptionGroupDto[]>>(
      `${environment.apiBaseUrl}/menu/versions/${versionId}/option-groups`,
      this.headers
    );
  }

  createOptionGroup(
    versionId: string,
    dto: CreateMenuOptionGroupDto
  ): Observable<ApiResponse<MenuOptionGroupDto>> {
    return this.http.post<ApiResponse<MenuOptionGroupDto>>(
      `${environment.apiBaseUrl}/menu/versions/${versionId}/option-groups`,
      dto,
      this.headers
    );
  }

  updateOptionGroup(
    versionId: string,
    groupId: string,
    dto: Partial<CreateMenuOptionGroupDto>
  ): Observable<ApiResponse<MenuOptionGroupDto>> {
    return this.http.patch<ApiResponse<MenuOptionGroupDto>>(
      `${environment.apiBaseUrl}/menu/versions/${versionId}/option-groups/${groupId}`,
      dto,
      this.headers
    );
  }

  deleteOptionGroup(versionId: string, groupId: string): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(
      `${environment.apiBaseUrl}/menu/versions/${versionId}/option-groups/${groupId}`,
      this.headers
    );
  }

  // ==================== OPTIONS ====================

  createOption(versionId: string, dto: CreateMenuOptionDto): Observable<ApiResponse<MenuOptionDto>> {
    return this.http.post<ApiResponse<MenuOptionDto>>(
      `${environment.apiBaseUrl}/menu/versions/${versionId}/options`,
      dto,
      this.headers
    );
  }

  updateOption(
    versionId: string,
    optionId: string,
    dto: Partial<Omit<CreateMenuOptionDto, 'groupId'>>
  ): Observable<ApiResponse<MenuOptionDto>> {
    return this.http.patch<ApiResponse<MenuOptionDto>>(
      `${environment.apiBaseUrl}/menu/versions/${versionId}/options/${optionId}`,
      dto,
      this.headers
    );
  }

  deleteOption(versionId: string, optionId: string): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(
      `${environment.apiBaseUrl}/menu/versions/${versionId}/options/${optionId}`,
      this.headers
    );
  }

  // ==================== SYNONYMS ====================

  getSynonyms(versionId: string): Observable<ApiResponse<MenuSynonymDto[]>> {
    return this.http.get<ApiResponse<MenuSynonymDto[]>>(
      `${environment.apiBaseUrl}/menu/versions/${versionId}/synonyms`,
      this.headers
    );
  }

  createSynonym(
    versionId: string,
    dto: CreateMenuSynonymDto
  ): Observable<ApiResponse<MenuSynonymDto>> {
    return this.http.post<ApiResponse<MenuSynonymDto>>(
      `${environment.apiBaseUrl}/menu/versions/${versionId}/synonyms`,
      dto,
      this.headers
    );
  }

  updateSynonym(
    versionId: string,
    synonymId: string,
    dto: Partial<CreateMenuSynonymDto>
  ): Observable<ApiResponse<MenuSynonymDto>> {
    return this.http.patch<ApiResponse<MenuSynonymDto>>(
      `${environment.apiBaseUrl}/menu/versions/${versionId}/synonyms/${synonymId}`,
      dto,
      this.headers
    );
  }

  deleteSynonym(versionId: string, synonymId: string): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(
      `${environment.apiBaseUrl}/menu/versions/${versionId}/synonyms/${synonymId}`,
      this.headers
    );
  }
}


