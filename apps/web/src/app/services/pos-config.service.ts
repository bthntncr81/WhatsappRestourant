import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export interface PosConfigDto {
  apiUrl: string | null;
  apiKey: string | null;
  locationId: string | null;
  webhookSecret: string | null;
  lastMenuSync: string | null;
  menuHash: string | null;
  isConfigured: boolean;
  webhookUrl: string;
}

export interface UpsertPosConfigDto {
  apiUrl: string;
  apiKey: string;
  locationId?: string;
  webhookSecret?: string;
}

export interface PosTestConnectionDto {
  connected: boolean;
  menuHash?: string;
  lastUpdated?: string;
}

export interface PosMenuSyncResultDto {
  message: string;
  versionId: string;
  itemsCreated: number;
  optionGroupsCreated: number;
  optionsCreated: number;
  categoriesFound: number;
}

@Injectable({
  providedIn: 'root',
})
export class PosConfigService {
  private http = inject(HttpClient);
  private authService = inject(AuthService);

  private get headers() {
    return { headers: this.authService.getAuthHeaders() };
  }

  getConfig(): Observable<ApiResponse<PosConfigDto | null>> {
    return this.http.get<ApiResponse<PosConfigDto | null>>(
      `${environment.apiBaseUrl}/integrations/pos`,
      this.headers
    );
  }

  saveConfig(dto: UpsertPosConfigDto): Observable<ApiResponse<{ message: string }>> {
    return this.http.put<ApiResponse<{ message: string }>>(
      `${environment.apiBaseUrl}/integrations/pos`,
      dto,
      this.headers
    );
  }

  testConnection(): Observable<ApiResponse<PosTestConnectionDto>> {
    return this.http.post<ApiResponse<PosTestConnectionDto>>(
      `${environment.apiBaseUrl}/integrations/pos/test`,
      {},
      this.headers
    );
  }

  syncMenu(): Observable<ApiResponse<PosMenuSyncResultDto>> {
    return this.http.post<ApiResponse<PosMenuSyncResultDto>>(
      `${environment.apiBaseUrl}/integrations/pos/sync-menu`,
      {},
      this.headers
    );
  }

  checkMenuChanged(): Observable<ApiResponse<{ changed: boolean }>> {
    return this.http.get<ApiResponse<{ changed: boolean }>>(
      `${environment.apiBaseUrl}/integrations/pos/menu-changed`,
      this.headers
    );
  }
}
