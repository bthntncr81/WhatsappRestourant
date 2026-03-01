import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../services/auth.service';

interface SurveyMessage {
  id: string;
  text: string | null;
  direction: string;
  kind: string;
  createdAt: string;
}

interface Complaint {
  id: string;
  tenantId: string;
  conversationId: string;
  orderId: string;
  customerPhone: string;
  customerName: string | null;
  rating: number;
  comment: string | null;
  isComplaint: boolean;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  createdAt: string;
  messages: SurveyMessage[];
}

interface SurveyStats {
  totalSurveys: number;
  averageRating: number;
  complaintCount: number;
  unresolvedCount: number;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
}

@Component({
  selector: 'app-surveys',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="surveys-page">
      <div class="page-header">
        <h1>Memnuniyet Anketleri</h1>
        <p class="text-secondary">Musteri geri bildirimleri ve sikayetler</p>
      </div>

      <!-- Stats Cards -->
      <div class="stats-row" *ngIf="stats()">
        <div class="stat-card">
          <div class="stat-value">{{ stats()!.totalSurveys }}</div>
          <div class="stat-label">Toplam Anket</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ stats()!.averageRating.toFixed(1) }}</div>
          <div class="stat-label">Ortalama Puan</div>
        </div>
        <div class="stat-card accent">
          <div class="stat-value">{{ stats()!.complaintCount }}</div>
          <div class="stat-label">Sikayet</div>
        </div>
        <div class="stat-card warn" *ngIf="stats()!.unresolvedCount > 0">
          <div class="stat-value">{{ stats()!.unresolvedCount }}</div>
          <div class="stat-label">Cozumsuz</div>
        </div>
      </div>

      <!-- Filter Tabs -->
      <div class="filter-tabs">
        <button
          class="tab-btn"
          [class.active]="filter() === 'unresolved'"
          (click)="setFilter('unresolved')"
        >
          Cozumsuz
        </button>
        <button
          class="tab-btn"
          [class.active]="filter() === 'all'"
          (click)="setFilter('all')"
        >
          Tumu
        </button>
        <button
          class="tab-btn"
          [class.active]="filter() === 'resolved'"
          (click)="setFilter('resolved')"
        >
          Cozulmus
        </button>
      </div>

      <!-- Complaints List -->
      <div class="complaints-list" *ngIf="!loading()">
        <div
          class="complaint-card"
          *ngFor="let c of complaints()"
          (click)="openDetail(c)"
          [class.selected]="selectedComplaint()?.id === c.id"
        >
          <div class="complaint-header">
            <div class="rating-badge" [class]="'rating-' + c.rating">
              {{ getStars(c.rating) }}
            </div>
            <span class="customer-name">{{ c.customerName || c.customerPhone }}</span>
            <span class="complaint-date">{{ formatDate(c.createdAt) }}</span>
          </div>
          <div class="complaint-comment" *ngIf="c.comment">
            {{ c.comment }}
          </div>
          <div class="complaint-meta">
            <span class="badge" [class.resolved]="c.resolvedAt" [class.unresolved]="!c.resolvedAt">
              {{ c.resolvedAt ? 'Cozuldu' : 'Bekliyor' }}
            </span>
          </div>
        </div>

        <div class="empty-state" *ngIf="complaints().length === 0">
          Sikayet bulunamadi.
        </div>
      </div>

      <div class="loading" *ngIf="loading()">Yukleniyor...</div>

      <!-- Detail Panel -->
      <div class="detail-overlay" *ngIf="selectedComplaint()" (click)="closeDetail()"></div>
      <div class="detail-panel" *ngIf="selectedComplaint()">
        <div class="detail-header">
          <h2>Sikayet Detayi</h2>
          <button class="close-btn" (click)="closeDetail()">&times;</button>
        </div>

        <div class="detail-info">
          <div class="info-row">
            <span class="info-label">Musteri:</span>
            <span>{{ selectedComplaint()!.customerName || selectedComplaint()!.customerPhone }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Puan:</span>
            <span class="rating-badge" [class]="'rating-' + selectedComplaint()!.rating">
              {{ getStars(selectedComplaint()!.rating) }}
            </span>
          </div>
          <div class="info-row" *ngIf="selectedComplaint()!.comment">
            <span class="info-label">Yorum:</span>
            <span>{{ selectedComplaint()!.comment }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Tarih:</span>
            <span>{{ formatDate(selectedComplaint()!.createdAt) }}</span>
          </div>
          <div class="info-row" *ngIf="selectedComplaint()!.resolvedAt">
            <span class="info-label">Cozum:</span>
            <span>{{ selectedComplaint()!.resolutionNote }}</span>
          </div>
        </div>

        <!-- Conversation History -->
        <div class="chat-history">
          <h3>Konusma Gecmisi</h3>
          <div class="messages-container">
            <div
              *ngFor="let msg of selectedComplaint()!.messages"
              class="chat-msg"
              [class.incoming]="msg.direction === 'IN'"
              [class.outgoing]="msg.direction === 'OUT'"
            >
              <div class="msg-bubble">
                {{ msg.text || '[medya]' }}
              </div>
              <div class="msg-time">{{ formatTime(msg.createdAt) }}</div>
            </div>
          </div>
        </div>

        <!-- Resolve Form -->
        <div class="resolve-form" *ngIf="!selectedComplaint()!.resolvedAt">
          <textarea
            [(ngModel)]="resolveNote"
            placeholder="Cozum notu yazin..."
            rows="3"
          ></textarea>
          <button
            class="resolve-btn"
            (click)="resolveComplaint()"
            [disabled]="!resolveNote.trim() || resolving()"
          >
            {{ resolving() ? 'Kaydediliyor...' : 'Cozuldu Olarak Isaretle' }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .surveys-page { padding: 24px; max-width: 1200px; margin: 0 auto; }
    .page-header h1 { margin: 0 0 4px; font-size: 1.5rem; }
    .text-secondary { color: var(--color-text-secondary, #666); margin: 0 0 20px; }

    .stats-row {
      display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap;
    }
    .stat-card {
      background: var(--color-bg-elevated); border-radius: var(--radius-md, 8px);
      padding: 16px 24px; flex: 1; min-width: 140px;
      border: 1px solid var(--color-border, #e5e7eb);
    }
    .stat-value { font-size: 1.75rem; font-weight: 700; }
    .stat-label { color: var(--color-text-secondary, #666); font-size: 0.85rem; margin-top: 4px; }
    .stat-card.accent .stat-value { color: #e74c3c; }
    .stat-card.warn { background: #fef3cd; border-color: #ffc107; }
    .stat-card.warn .stat-value { color: #856404; }

    .filter-tabs {
      display: flex; gap: 8px; margin-bottom: 20px;
    }
    .tab-btn {
      padding: 8px 20px; border-radius: var(--radius-md, 8px);
      border: 1px solid var(--color-border, #e5e7eb);
      background: var(--color-bg-elevated); cursor: pointer;
      font-size: 0.9rem; transition: all 0.2s;
    }
    .tab-btn.active {
      background: var(--color-primary, #3b82f6); color: white;
      border-color: var(--color-primary, #3b82f6);
    }

    .complaints-list { display: flex; flex-direction: column; gap: 12px; }
    .complaint-card {
      background: var(--color-bg-elevated); border-radius: var(--radius-md, 8px);
      padding: 16px; cursor: pointer; border: 1px solid var(--color-border, #e5e7eb);
      transition: all 0.2s;
    }
    .complaint-card:hover { border-color: var(--color-primary, #3b82f6); }
    .complaint-card.selected { border-color: var(--color-primary, #3b82f6); background: rgba(27, 85, 131, 0.08); }

    .complaint-header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
    .rating-badge { font-size: 0.85rem; }
    .rating-1, .rating-2 { color: var(--color-danger, #e74c3c); }
    .rating-3 { color: var(--color-warning, #f39c12); }
    .rating-4, .rating-5 { color: var(--color-success, #27ae60); }
    .customer-name { font-weight: 600; flex: 1; }
    .complaint-date { color: var(--color-text-secondary, #666); font-size: 0.8rem; }
    .complaint-comment {
      color: var(--color-text-secondary, #666); font-size: 0.9rem;
      margin-bottom: 8px; line-height: 1.4;
    }
    .badge {
      font-size: 0.75rem; padding: 2px 10px; border-radius: 12px;
    }
    .badge.unresolved { background: rgba(239, 68, 68, 0.15); color: var(--color-danger); }
    .badge.resolved { background: rgba(34, 197, 94, 0.15); color: var(--color-success); }

    .empty-state {
      text-align: center; padding: 40px; color: var(--color-text-secondary, #666);
    }
    .loading { text-align: center; padding: 40px; }

    /* Detail Panel */
    .detail-overlay {
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.3); z-index: 99;
    }
    .detail-panel {
      position: fixed; top: 0; right: 0; bottom: 0; width: 480px;
      background: var(--color-bg-elevated); z-index: 100;
      box-shadow: -4px 0 20px rgba(0,0,0,0.1);
      display: flex; flex-direction: column;
      animation: slideIn 0.25s ease-out;
    }
    @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }

    .detail-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 20px; border-bottom: 1px solid var(--color-border, #e5e7eb);
    }
    .detail-header h2 { margin: 0; font-size: 1.1rem; }
    .close-btn {
      background: none; border: none; font-size: 1.5rem; cursor: pointer;
      color: var(--color-text-secondary, #666);
    }

    .detail-info { padding: 16px 20px; border-bottom: 1px solid var(--color-border, #e5e7eb); }
    .info-row { display: flex; gap: 8px; margin-bottom: 8px; font-size: 0.9rem; }
    .info-label { font-weight: 600; min-width: 80px; }

    .chat-history { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
    .chat-history h3 { margin: 0; padding: 12px 20px; font-size: 0.95rem; }
    .messages-container {
      flex: 1; overflow-y: auto; padding: 0 20px 12px;
      display: flex; flex-direction: column; gap: 8px;
    }
    .chat-msg { display: flex; flex-direction: column; max-width: 80%; }
    .chat-msg.incoming { align-self: flex-start; }
    .chat-msg.outgoing { align-self: flex-end; }
    .msg-bubble {
      padding: 8px 12px; border-radius: 12px; font-size: 0.85rem;
      line-height: 1.4; word-break: break-word;
    }
    .incoming .msg-bubble { background: var(--color-bg-tertiary); }
    .outgoing .msg-bubble { background: rgba(34, 197, 94, 0.15); }
    .msg-time { font-size: 0.7rem; color: var(--color-text-muted); margin-top: 2px; padding: 0 4px; }
    .incoming .msg-time { text-align: left; }
    .outgoing .msg-time { text-align: right; }

    .resolve-form {
      padding: 16px 20px; border-top: 1px solid var(--color-border, #e5e7eb);
    }
    .resolve-form textarea {
      width: 100%; border: 1px solid var(--color-border, #e5e7eb);
      border-radius: var(--radius-md, 8px); padding: 10px;
      font-size: 0.9rem; resize: none; box-sizing: border-box;
    }
    .resolve-btn {
      margin-top: 10px; width: 100%; padding: 10px;
      background: #16a34a; color: white; border: none;
      border-radius: var(--radius-md, 8px); cursor: pointer;
      font-size: 0.9rem; font-weight: 600;
    }
    .resolve-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  `],
})
export class SurveysComponent implements OnInit {
  private http = inject(HttpClient);
  private authService = inject(AuthService);

  complaints = signal<Complaint[]>([]);
  stats = signal<SurveyStats | null>(null);
  loading = signal(false);
  filter = signal<'unresolved' | 'all' | 'resolved'>('unresolved');
  selectedComplaint = signal<Complaint | null>(null);
  resolveNote = '';
  resolving = signal(false);

  private get headers() {
    return { headers: this.authService.getAuthHeaders() };
  }

  ngOnInit() {
    this.loadStats();
    this.loadComplaints();
  }

  setFilter(f: 'unresolved' | 'all' | 'resolved') {
    this.filter.set(f);
    this.loadComplaints();
  }

  loadStats() {
    this.http.get<ApiResponse<SurveyStats>>(
      `${environment.apiBaseUrl}/surveys/stats`,
      this.headers,
    ).subscribe({
      next: (res) => { if (res.data) this.stats.set(res.data); },
    });
  }

  loadComplaints() {
    this.loading.set(true);
    const f = this.filter();
    let url = `${environment.apiBaseUrl}/surveys/complaints?limit=50`;
    if (f === 'unresolved') url += '&resolved=false';
    else if (f === 'resolved') url += '&resolved=true';

    this.http.get<ApiResponse<{ complaints: Complaint[]; total: number }>>(
      url, this.headers,
    ).subscribe({
      next: (res) => {
        this.complaints.set(res.data?.complaints || []);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  openDetail(c: Complaint) {
    this.selectedComplaint.set(c);
    this.resolveNote = '';
  }

  closeDetail() {
    this.selectedComplaint.set(null);
  }

  resolveComplaint() {
    const c = this.selectedComplaint();
    if (!c || !this.resolveNote.trim()) return;

    this.resolving.set(true);
    this.http.post<ApiResponse<void>>(
      `${environment.apiBaseUrl}/surveys/${c.id}/resolve`,
      { note: this.resolveNote.trim() },
      this.headers,
    ).subscribe({
      next: () => {
        this.resolving.set(false);
        this.closeDetail();
        this.loadComplaints();
        this.loadStats();
      },
      error: () => this.resolving.set(false),
    });
  }

  getStars(rating: number): string {
    return '⭐'.repeat(rating);
  }

  formatDate(d: string): string {
    return new Date(d).toLocaleDateString('tr-TR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  formatTime(d: string): string {
    return new Date(d).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  }
}
