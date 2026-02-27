import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

// ==================== TYPES ====================

export type OrderStatus =
  | 'DRAFT'
  | 'PENDING_CONFIRMATION'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'READY'
  | 'DELIVERED'
  | 'CANCELLED';

export type PrintJobType = 'KITCHEN' | 'COURIER';
export type PrintJobStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: { code: string; message: string };
}

export interface OrderItemDto {
  id: string;
  orderId: string;
  menuItemId: string;
  menuItemName: string;
  qty: number;
  unitPrice: number;
  optionsJson: { groupName: string; optionName: string; priceDelta: number }[] | null;
  extrasJson: { name: string; qty: number; price: number }[] | null;
  notes: string | null;
}

export interface OrderDto {
  id: string;
  tenantId: string;
  conversationId: string;
  storeId: string | null;
  storeName: string | null;
  orderNumber: number | null;
  status: OrderStatus;
  totalPrice: number;
  notes: string | null;
  customerPhone: string | null;
  customerName: string | null;
  deliveryAddress: string | null;
  paymentMethod: string | null;
  parentOrderId: string | null;
  rejectionReason: string | null;
  items: OrderItemDto[];
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
}

export interface PrintJobPayload {
  orderNumber: number;
  timestamp: string;
  items: {
    name: string;
    qty: number;
    options: string[];
    notes: string | null;
  }[];
  notes: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  deliveryAddress?: string | null;
  paymentMethod?: string | null;
  totalPrice?: number | null;
}

export interface PrintJobDto {
  id: string;
  tenantId: string;
  orderId: string;
  type: PrintJobType;
  status: PrintJobStatus;
  payloadJson: PrintJobPayload;
  errorMessage: string | null;
  retryCount: number;
  createdAt: string;
  processedAt: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class OrderService {
  private http = inject(HttpClient);
  private authService = inject(AuthService);

  private get headers() {
    return { headers: this.authService.getAuthHeaders() };
  }

  // ==================== ORDERS ====================

  getOrders(params?: {
    status?: OrderStatus;
    conversationId?: string;
    limit?: number;
    offset?: number;
  }): Observable<ApiResponse<{ orders: OrderDto[]; total: number }>> {
    const queryParams = new URLSearchParams();
    if (params?.status) queryParams.set('status', params.status);
    if (params?.conversationId) queryParams.set('conversationId', params.conversationId);
    if (params?.limit) queryParams.set('limit', params.limit.toString());
    if (params?.offset) queryParams.set('offset', params.offset.toString());

    const query = queryParams.toString() ? `?${queryParams.toString()}` : '';
    return this.http.get<ApiResponse<{ orders: OrderDto[]; total: number }>>(
      `${environment.apiBaseUrl}/orders${query}`,
      this.headers
    );
  }

  getOrder(id: string): Observable<ApiResponse<OrderDto>> {
    return this.http.get<ApiResponse<OrderDto>>(
      `${environment.apiBaseUrl}/orders/${id}`,
      this.headers
    );
  }

  confirmOrder(
    id: string,
    data?: { deliveryAddress?: string; paymentMethod?: string; notes?: string }
  ): Observable<ApiResponse<OrderDto>> {
    return this.http.post<ApiResponse<OrderDto>>(
      `${environment.apiBaseUrl}/orders/${id}/confirm`,
      data || {},
      this.headers
    );
  }

  updateOrderStatus(id: string, status: OrderStatus): Observable<ApiResponse<OrderDto>> {
    return this.http.patch<ApiResponse<OrderDto>>(
      `${environment.apiBaseUrl}/orders/${id}/status`,
      { status },
      this.headers
    );
  }

  rejectOrder(id: string, reason: string): Observable<ApiResponse<OrderDto>> {
    return this.http.post<ApiResponse<OrderDto>>(
      `${environment.apiBaseUrl}/orders/${id}/reject`,
      { reason },
      this.headers
    );
  }

  reprintOrder(id: string, type: PrintJobType): Observable<ApiResponse<void>> {
    return this.http.post<ApiResponse<void>>(
      `${environment.apiBaseUrl}/orders/${id}/reprint`,
      { type },
      this.headers
    );
  }

  // ==================== PRINT JOBS ====================

  getPrintJobs(params?: {
    status?: PrintJobStatus;
    orderId?: string;
    limit?: number;
    offset?: number;
  }): Observable<ApiResponse<{ jobs: PrintJobDto[]; total: number }>> {
    const queryParams = new URLSearchParams();
    if (params?.status) queryParams.set('status', params.status);
    if (params?.orderId) queryParams.set('orderId', params.orderId);
    if (params?.limit) queryParams.set('limit', params.limit.toString());
    if (params?.offset) queryParams.set('offset', params.offset.toString());

    const query = queryParams.toString() ? `?${queryParams.toString()}` : '';
    return this.http.get<ApiResponse<{ jobs: PrintJobDto[]; total: number }>>(
      `${environment.apiBaseUrl}/print-jobs${query}`,
      this.headers
    );
  }

  getPrintJob(id: string): Observable<ApiResponse<PrintJobDto>> {
    return this.http.get<ApiResponse<PrintJobDto>>(
      `${environment.apiBaseUrl}/print-jobs/${id}`,
      this.headers
    );
  }

  retryPrintJob(id: string): Observable<ApiResponse<PrintJobDto>> {
    return this.http.post<ApiResponse<PrintJobDto>>(
      `${environment.apiBaseUrl}/print-jobs/${id}/retry`,
      {},
      this.headers
    );
  }

  cancelPrintJob(id: string): Observable<ApiResponse<PrintJobDto>> {
    return this.http.post<ApiResponse<PrintJobDto>>(
      `${environment.apiBaseUrl}/print-jobs/${id}/cancel`,
      {},
      this.headers
    );
  }

  deletePrintJob(id: string): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(
      `${environment.apiBaseUrl}/print-jobs/${id}`,
      this.headers
    );
  }
}

