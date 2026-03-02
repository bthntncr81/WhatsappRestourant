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

export interface MenuMediaDto {
  id: string;
  tenantId: string;
  type: 'IMAGE' | 'DOCUMENT';
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sortOrder: number;
  caption: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
}

@Injectable({ providedIn: 'root' })
export class MenuMediaService {
  private http = inject(HttpClient);
  private authService = inject(AuthService);

  private get headers() {
    return { headers: this.authService.getAuthHeaders() };
  }

  getMedia(): Observable<ApiResponse<MenuMediaDto[]>> {
    return this.http.get<ApiResponse<MenuMediaDto[]>>(
      `${environment.apiBaseUrl}/menu-media`,
      this.headers,
    );
  }

  uploadMedia(file: File, caption?: string): Observable<ApiResponse<MenuMediaDto>> {
    const formData = new FormData();
    formData.append('file', file);
    if (caption) formData.append('caption', caption);
    return this.http.post<ApiResponse<MenuMediaDto>>(
      `${environment.apiBaseUrl}/menu-media`,
      formData,
      { headers: this.authService.getAuthHeaders() },
    );
  }

  deleteMedia(mediaId: string): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(
      `${environment.apiBaseUrl}/menu-media/${mediaId}`,
      this.headers,
    );
  }

  reorderMedia(mediaIds: string[]): Observable<ApiResponse<MenuMediaDto[]>> {
    return this.http.put<ApiResponse<MenuMediaDto[]>>(
      `${environment.apiBaseUrl}/menu-media/reorder`,
      { mediaIds },
      this.headers,
    );
  }
}
