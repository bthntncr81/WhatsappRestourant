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

export type WhatsAppConnectionStatus = 'DISCONNECTED' | 'PENDING' | 'CONNECTED' | 'ERROR';

export interface WhatsAppConfigDto {
  id: string;
  tenantId: string;
  phoneNumberId: string;
  wabaId: string;
  accessTokenMasked: string;
  appSecretMasked: string;
  webhookVerifyToken: string;
  webhookUrl: string;
  connectionStatus: WhatsAppConnectionStatus;
  statusMessage: string | null;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertWhatsAppConfigDto {
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
  appSecret: string;
}

export interface WhatsAppTestConnectionDto {
  success: boolean;
  phoneNumber?: string;
  qualityRating?: string;
  messagingLimit?: string;
  message: string;
}

@Injectable({
  providedIn: 'root',
})
export class WhatsAppConfigService {
  private http = inject(HttpClient);
  private authService = inject(AuthService);

  private get headers() {
    return { headers: this.authService.getAuthHeaders() };
  }

  getConfig(): Observable<ApiResponse<WhatsAppConfigDto | null>> {
    return this.http.get<ApiResponse<WhatsAppConfigDto | null>>(
      `${environment.apiBaseUrl}/whatsapp-config`,
      this.headers
    );
  }

  saveConfig(dto: UpsertWhatsAppConfigDto): Observable<ApiResponse<WhatsAppConfigDto>> {
    return this.http.put<ApiResponse<WhatsAppConfigDto>>(
      `${environment.apiBaseUrl}/whatsapp-config`,
      dto,
      this.headers
    );
  }

  deleteConfig(): Observable<ApiResponse<null>> {
    return this.http.delete<ApiResponse<null>>(
      `${environment.apiBaseUrl}/whatsapp-config`,
      this.headers
    );
  }

  testConnection(): Observable<ApiResponse<WhatsAppTestConnectionDto>> {
    return this.http.post<ApiResponse<WhatsAppTestConnectionDto>>(
      `${environment.apiBaseUrl}/whatsapp-config/test`,
      {},
      this.headers
    );
  }
}
