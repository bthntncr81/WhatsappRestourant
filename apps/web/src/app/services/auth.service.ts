import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { environment } from '../../environments/environment';

export interface LoginDto {
  email: string;
  password: string;
}

export interface RegisterDto {
  email: string;
  password: string;
  name: string;
  tenantName: string;
  tenantSlug: string;
}

export interface UserInfo {
  id: string;
  email: string;
  name: string;
  role: 'OWNER' | 'ADMIN' | 'AGENT' | 'STAFF';
}

export interface TenantInfo {
  id: string;
  name: string;
  slug: string;
}

export interface AuthResponse {
  accessToken: string;
  user: UserInfo;
  tenant: TenantInfo;
}

export interface MembershipInfo {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: 'OWNER' | 'ADMIN' | 'AGENT' | 'STAFF';
}

export interface MeResponse {
  user: UserInfo;
  tenant: TenantInfo;
  memberships: MembershipInfo[];
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

const TOKEN_KEY = 'whatres_token';
const USER_KEY = 'whatres_user';
const TENANT_KEY = 'whatres_tenant';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  private _token = signal<string | null>(this.getStoredToken());
  private _user = signal<UserInfo | null>(this.getStoredUser());
  private _tenant = signal<TenantInfo | null>(this.getStoredTenant());

  readonly token = this._token.asReadonly();
  readonly user = this._user.asReadonly();
  readonly tenant = this._tenant.asReadonly();
  readonly isAuthenticated = computed(() => !!this._token());
  readonly isOwner = computed(() => this._user()?.role === 'OWNER');
  readonly isAdmin = computed(() => ['OWNER', 'ADMIN'].includes(this._user()?.role || ''));

  private getStoredToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(TOKEN_KEY);
  }

  private getStoredUser(): UserInfo | null {
    if (typeof window === 'undefined') return null;
    const stored = localStorage.getItem(USER_KEY);
    return stored ? JSON.parse(stored) : null;
  }

  private getStoredTenant(): TenantInfo | null {
    if (typeof window === 'undefined') return null;
    const stored = localStorage.getItem(TENANT_KEY);
    return stored ? JSON.parse(stored) : null;
  }

  private storeAuth(response: AuthResponse): void {
    localStorage.setItem(TOKEN_KEY, response.accessToken);
    localStorage.setItem(USER_KEY, JSON.stringify(response.user));
    localStorage.setItem(TENANT_KEY, JSON.stringify(response.tenant));

    this._token.set(response.accessToken);
    this._user.set(response.user);
    this._tenant.set(response.tenant);
  }

  private clearAuth(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(TENANT_KEY);

    this._token.set(null);
    this._user.set(null);
    this._tenant.set(null);
  }

  getAuthHeaders(): HttpHeaders {
    const token = this._token();
    const tenant = this._tenant();

    let headers = new HttpHeaders();
    if (token) {
      headers = headers.set('Authorization', `Bearer ${token}`);
    }
    if (tenant) {
      headers = headers.set('X-Tenant-ID', tenant.id);
    }
    return headers;
  }

  register(dto: RegisterDto): Observable<ApiResponse<AuthResponse>> {
    return this.http
      .post<ApiResponse<AuthResponse>>(`${environment.apiBaseUrl}/auth/register`, dto)
      .pipe(
        tap((response) => {
          if (response.success && response.data) {
            this.storeAuth(response.data);
          }
        }),
        catchError((error) => {
          console.error('Registration error:', error);
          return throwError(() => error);
        })
      );
  }

  login(dto: LoginDto): Observable<ApiResponse<AuthResponse>> {
    return this.http
      .post<ApiResponse<AuthResponse>>(`${environment.apiBaseUrl}/auth/login`, dto)
      .pipe(
        tap((response) => {
          if (response.success && response.data) {
            this.storeAuth(response.data);
          }
        }),
        catchError((error) => {
          console.error('Login error:', error);
          return throwError(() => error);
        })
      );
  }

  getMe(): Observable<ApiResponse<MeResponse>> {
    return this.http.get<ApiResponse<MeResponse>>(`${environment.apiBaseUrl}/auth/me`, {
      headers: this.getAuthHeaders(),
    });
  }

  logout(): void {
    this.clearAuth();
    this.router.navigate(['/login']);
  }

  hasRole(roles: string[]): boolean {
    const userRole = this._user()?.role;
    return userRole ? roles.includes(userRole) : false;
  }
}


