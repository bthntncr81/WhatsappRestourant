import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../environments/environment';

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

const TOKEN_KEY = 'sp_admin_token';

@Injectable({ providedIn: 'root' })
export class AdminService {
  private http = inject(HttpClient);
  private base = environment.apiBaseUrl + '/admin';

  readonly token = signal<string | null>(localStorage.getItem(TOKEN_KEY));

  isAuthenticated(): boolean {
    return !!this.token();
  }

  setToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
    this.token.set(token);
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    this.token.set(null);
  }

  login(email: string, password: string): Observable<ApiResponse<{ token: string; email: string }>> {
    return this.http.post<ApiResponse<{ token: string; email: string }>>(`${this.base}/login`, { email, password });
  }

  getStats(): Observable<ApiResponse<any>> {
    return this.http.get<ApiResponse<any>>(`${this.base}/stats`);
  }

  getTenants(search?: string): Observable<ApiResponse<{ tenants: any[] }>> {
    const q = search ? `?search=${encodeURIComponent(search)}` : '';
    return this.http.get<ApiResponse<{ tenants: any[] }>>(`${this.base}/tenants${q}`);
  }

  getTenant(id: string): Observable<ApiResponse<any>> {
    return this.http.get<ApiResponse<any>>(`${this.base}/tenants/${id}`);
  }

  getTransactions(id: string): Observable<ApiResponse<{ transactions: any[] }>> {
    return this.http.get<ApiResponse<{ transactions: any[] }>>(`${this.base}/tenants/${id}/transactions`);
  }

  manageSubscription(id: string, body: { action: string; days?: number; plan?: string; billingCycle?: string }): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(`${this.base}/tenants/${id}/subscription`, body);
  }
}
