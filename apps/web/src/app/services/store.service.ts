import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

// ==================== TYPES ====================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: { code: string; message: string };
}

export interface StoreDto {
  id: string;
  tenantId: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  phone: string | null;
  isActive: boolean;
  isOpen: boolean;
  createdAt: string;
  updatedAt: string;
  deliveryRules?: DeliveryRuleDto[];
}

export interface CreateStoreDto {
  name: string;
  address?: string;
  lat: number;
  lng: number;
  phone?: string;
  isActive?: boolean;
}

export interface UpdateStoreDto {
  name?: string;
  address?: string;
  lat?: number;
  lng?: number;
  phone?: string;
  isActive?: boolean;
}

export interface DeliveryRuleDto {
  id: string;
  tenantId: string;
  storeId: string;
  radiusKm: number;
  minBasket: number;
  deliveryFee: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  store?: StoreDto;
}

export interface CreateDeliveryRuleDto {
  storeId: string;
  radiusKm: number;
  minBasket: number;
  deliveryFee: number;
  isActive?: boolean;
}

export interface UpdateDeliveryRuleDto {
  radiusKm?: number;
  minBasket?: number;
  deliveryFee?: number;
  isActive?: boolean;
}

export interface GeoCheckResult {
  isWithinServiceArea: boolean;
  nearestStore: StoreDto | null;
  distance: number | null;
  deliveryRule: DeliveryRuleDto | null;
  alternativeStores: { store: StoreDto; distance: number }[];
  message: string;
}

@Injectable({
  providedIn: 'root',
})
export class StoreService {
  private http = inject(HttpClient);
  private authService = inject(AuthService);

  private get headers() {
    return { headers: this.authService.getAuthHeaders() };
  }

  // ==================== STORES ====================

  getStores(includeInactive = false): Observable<ApiResponse<StoreDto[]>> {
    const query = includeInactive ? '?includeInactive=true' : '';
    return this.http.get<ApiResponse<StoreDto[]>>(
      `${environment.apiBaseUrl}/stores${query}`,
      this.headers
    );
  }

  getStore(id: string): Observable<ApiResponse<StoreDto>> {
    return this.http.get<ApiResponse<StoreDto>>(
      `${environment.apiBaseUrl}/stores/${id}`,
      this.headers
    );
  }

  createStore(data: CreateStoreDto): Observable<ApiResponse<StoreDto>> {
    return this.http.post<ApiResponse<StoreDto>>(
      `${environment.apiBaseUrl}/stores`,
      data,
      this.headers
    );
  }

  updateStore(id: string, data: UpdateStoreDto): Observable<ApiResponse<StoreDto>> {
    return this.http.patch<ApiResponse<StoreDto>>(
      `${environment.apiBaseUrl}/stores/${id}`,
      data,
      this.headers
    );
  }

  deleteStore(id: string): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(
      `${environment.apiBaseUrl}/stores/${id}`,
      this.headers
    );
  }

  toggleStoreOpen(id: string): Observable<ApiResponse<StoreDto>> {
    return this.http.patch<ApiResponse<StoreDto>>(
      `${environment.apiBaseUrl}/stores/${id}/toggle-open`,
      {},
      this.headers
    );
  }

  // ==================== DELIVERY RULES ====================

  getDeliveryRules(storeId?: string): Observable<ApiResponse<DeliveryRuleDto[]>> {
    const query = storeId ? `?storeId=${storeId}` : '';
    return this.http.get<ApiResponse<DeliveryRuleDto[]>>(
      `${environment.apiBaseUrl}/stores/delivery-rules/list${query}`,
      this.headers
    );
  }

  createDeliveryRule(data: CreateDeliveryRuleDto): Observable<ApiResponse<DeliveryRuleDto>> {
    return this.http.post<ApiResponse<DeliveryRuleDto>>(
      `${environment.apiBaseUrl}/stores/delivery-rules`,
      data,
      this.headers
    );
  }

  updateDeliveryRule(id: string, data: UpdateDeliveryRuleDto): Observable<ApiResponse<DeliveryRuleDto>> {
    return this.http.patch<ApiResponse<DeliveryRuleDto>>(
      `${environment.apiBaseUrl}/stores/delivery-rules/${id}`,
      data,
      this.headers
    );
  }

  deleteDeliveryRule(id: string): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(
      `${environment.apiBaseUrl}/stores/delivery-rules/${id}`,
      this.headers
    );
  }

  // ==================== GEO CHECK ====================

  checkServiceArea(lat: number, lng: number): Observable<ApiResponse<GeoCheckResult>> {
    return this.http.post<ApiResponse<GeoCheckResult>>(
      `${environment.apiBaseUrl}/stores/check-service-area`,
      { lat, lng },
      this.headers
    );
  }
}


