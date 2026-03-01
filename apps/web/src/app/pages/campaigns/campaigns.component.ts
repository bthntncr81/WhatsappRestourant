import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../services/auth.service';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
}

interface BroadcastSettings {
  isEnabled: boolean;
  maxDiscountPct: number;
  minDaysBetweenSends: number;
  dailySendLimit: number;
  activeThresholdDays: number;
  sleepingThresholdDays: number;
}

interface BroadcastStats {
  totalCustomers: number;
  optedIn: number;
  segments: Record<string, number>;
  totalSent: number;
  totalOpened: number;
  totalConverted: number;
}

interface Campaign {
  id: string;
  name: string;
  targetSegments: string[];
  maxDiscountPct: number;
  status: string;
  usePersonalTime: boolean;
  scheduledAt: string | null;
  totalRecipients: number;
  totalSent: number;
  totalOpened: number;
  totalConverted: number;
  createdAt: string;
  completedAt: string | null;
}

interface CampaignSendLog {
  id: string;
  customerPhone: string;
  status: string;
  scheduledSendAt: string;
  sentAt: string | null;
  messageText: string | null;
  discountPct: number | null;
  errorMessage: string | null;
  customerProfile: { customerName: string | null; segment: string };
}

@Component({
  selector: 'app-campaigns',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="campaigns-page">
      <header class="page-header">
        <h1>Kampanyalar</h1>
        <p class="text-muted">WhatsApp broadcast kampanyalari ve musteri segmentasyonu</p>
      </header>

      <!-- Settings Card -->
      <div class="card settings-card">
        <div class="card-header">
          <h2>Broadcast Ayarlari</h2>
          <label class="toggle-label">
            <input type="checkbox" [ngModel]="settings()?.isEnabled" (ngModelChange)="toggleEnabled($event)" />
            <span>{{ settings()?.isEnabled ? 'Aktif' : 'Pasif' }}</span>
          </label>
        </div>
        @if (settings()?.isEnabled) {
          <div class="settings-grid">
            <div class="setting-item">
              <label>Max Indirim %</label>
              <input type="number" [ngModel]="settings()?.maxDiscountPct" (ngModelChange)="updateSetting('maxDiscountPct', $event)" min="0" max="100" />
            </div>
            <div class="setting-item">
              <label>Min Gun Arasi</label>
              <input type="number" [ngModel]="settings()?.minDaysBetweenSends" (ngModelChange)="updateSetting('minDaysBetweenSends', $event)" min="1" max="30" />
            </div>
            <div class="setting-item">
              <label>Gunluk Limit</label>
              <input type="number" [ngModel]="settings()?.dailySendLimit" (ngModelChange)="updateSetting('dailySendLimit', $event)" min="1" max="10000" />
            </div>
          </div>
        }
      </div>

      <!-- Stats Cards -->
      @if (stats()) {
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value">{{ stats()!.totalCustomers }}</div>
            <div class="stat-label">Toplam Musteri</div>
          </div>
          <div class="stat-card accent">
            <div class="stat-value">{{ stats()!.optedIn }}</div>
            <div class="stat-label">Abone</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">{{ stats()!.segments?.['ACTIVE'] || 0 }}</div>
            <div class="stat-label">Aktif</div>
          </div>
          <div class="stat-card warning">
            <div class="stat-value">{{ stats()!.segments?.['SLEEPING'] || 0 }}</div>
            <div class="stat-label">Uyuyan</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">{{ stats()!.segments?.['NEW'] || 0 }}</div>
            <div class="stat-label">Yeni</div>
          </div>
          <div class="stat-card success">
            <div class="stat-value">{{ stats()!.totalConverted }}</div>
            <div class="stat-label">Donusum</div>
          </div>
        </div>

        <div class="sync-bar">
          <button class="btn btn-secondary" (click)="syncProfiles()" [disabled]="syncing()">
            {{ syncing() ? 'Senkronize ediliyor...' : 'Profilleri Senkronla' }}
          </button>
        </div>
      }

      <!-- Create Campaign -->
      <div class="card">
        <div class="card-header">
          <h2>Yeni Kampanya</h2>
        </div>
        <div class="campaign-form">
          <div class="form-row">
            <div class="form-group">
              <label>Kampanya Adi</label>
              <input type="text" [(ngModel)]="newCampaign.name" placeholder="Ornek: Haftalik Indirim" />
            </div>
            <div class="form-group">
              <label>Max Indirim %</label>
              <input type="number" [(ngModel)]="newCampaign.maxDiscountPct" min="0" max="100" />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Hedef Segmentler</label>
              <div class="checkbox-group">
                <label><input type="checkbox" [(ngModel)]="newCampaign.segActive" /> Aktif</label>
                <label><input type="checkbox" [(ngModel)]="newCampaign.segSleeping" /> Uyuyan</label>
                <label><input type="checkbox" [(ngModel)]="newCampaign.segNew" /> Yeni</label>
              </div>
            </div>
            <div class="form-group">
              <label>Zamanlama</label>
              <label class="toggle-label small">
                <input type="checkbox" [(ngModel)]="newCampaign.usePersonalTime" />
                <span>Musterinin aliskanligi saatinde gonder</span>
              </label>
            </div>
          </div>
          <button class="btn btn-primary" (click)="createCampaign()" [disabled]="!newCampaign.name">
            Kampanya Olustur
          </button>
        </div>
      </div>

      <!-- Campaign List -->
      <div class="card">
        <div class="card-header">
          <h2>Kampanyalar</h2>
        </div>
        @if (campaigns().length === 0) {
          <div class="empty-state">Henuz kampanya yok.</div>
        } @else {
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Ad</th>
                  <th>Durum</th>
                  <th>Segment</th>
                  <th>Indirim</th>
                  <th>Alici</th>
                  <th>Gonderilen</th>
                  <th>Acilan</th>
                  <th>Donusum</th>
                  <th>Tarih</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (c of campaigns(); track c.id) {
                  <tr [class.selected]="selectedCampaign()?.id === c.id" (click)="selectCampaign(c)">
                    <td class="font-medium">{{ c.name }}</td>
                    <td><span class="badge" [class]="'badge-' + c.status.toLowerCase()">{{ getStatusLabel(c.status) }}</span></td>
                    <td>{{ c.targetSegments.join(', ') }}</td>
                    <td>%{{ c.maxDiscountPct }}</td>
                    <td>{{ c.totalRecipients }}</td>
                    <td>{{ c.totalSent }}</td>
                    <td>{{ c.totalOpened }}</td>
                    <td>{{ c.totalConverted }}</td>
                    <td class="text-muted">{{ c.createdAt | date:'dd.MM HH:mm' }}</td>
                    <td>
                      @if (c.status === 'DRAFT') {
                        <button class="btn btn-sm btn-primary" (click)="scheduleCampaign(c.id); $event.stopPropagation()">Zamanla</button>
                      }
                      @if (c.status === 'DRAFT' || c.status === 'SCHEDULED') {
                        <button class="btn btn-sm btn-danger" (click)="cancelCampaign(c.id); $event.stopPropagation()">Iptal</button>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>

      <!-- Campaign Detail / Send Logs -->
      @if (selectedCampaign() && campaignLogs().length > 0) {
        <div class="card">
          <div class="card-header">
            <h2>{{ selectedCampaign()!.name }} - Gonderim Loglari</h2>
          </div>
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Musteri</th>
                  <th>Telefon</th>
                  <th>Segment</th>
                  <th>Durum</th>
                  <th>Indirim</th>
                  <th>Zamanlanma</th>
                  <th>Mesaj</th>
                </tr>
              </thead>
              <tbody>
                @for (log of campaignLogs(); track log.id) {
                  <tr>
                    <td>{{ log.customerProfile?.customerName || '-' }}</td>
                    <td class="font-mono">{{ log.customerPhone }}</td>
                    <td><span class="badge badge-segment">{{ log.customerProfile?.segment }}</span></td>
                    <td><span class="badge" [class]="'badge-' + log.status.toLowerCase()">{{ log.status }}</span></td>
                    <td>{{ log.discountPct ? '%' + log.discountPct : '-' }}</td>
                    <td class="text-muted">{{ log.scheduledSendAt | date:'dd.MM HH:mm' }}</td>
                    <td class="message-preview">{{ log.messageText?.substring(0, 80) || '-' }}{{ log.messageText && log.messageText.length > 80 ? '...' : '' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .campaigns-page {
      padding: var(--spacing-lg);
      max-width: 1200px;
    }

    .page-header {
      margin-bottom: var(--spacing-xl);
    }

    .page-header h1 {
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: var(--spacing-xs);
    }

    .card {
      background: var(--color-bg-secondary);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: var(--spacing-lg);
      margin-bottom: var(--spacing-lg);
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: var(--spacing-md);
    }

    .card-header h2 {
      font-size: 1.125rem;
      font-weight: 600;
    }

    .toggle-label {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      cursor: pointer;
      font-weight: 500;
    }

    .toggle-label.small {
      font-size: 0.875rem;
    }

    .settings-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: var(--spacing-md);
    }

    .setting-item label {
      display: block;
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--color-text-secondary);
      margin-bottom: var(--spacing-xs);
    }

    .setting-item input {
      width: 100%;
      padding: var(--spacing-sm);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-bg-primary);
      color: var(--color-text-primary);
      font-size: 0.875rem;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: var(--spacing-md);
      margin-bottom: var(--spacing-lg);
    }

    .stat-card {
      background: var(--color-bg-secondary);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: var(--spacing-md);
      text-align: center;
    }

    .stat-card.accent { border-color: var(--color-accent-primary); }
    .stat-card.warning { border-color: var(--color-warning); }
    .stat-card.success { border-color: var(--color-success); }

    .stat-value {
      font-size: 1.5rem;
      font-weight: 700;
    }

    .stat-label {
      font-size: 0.75rem;
      color: var(--color-text-secondary);
      margin-top: var(--spacing-xs);
    }

    .sync-bar {
      margin-bottom: var(--spacing-lg);
    }

    .campaign-form .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--spacing-md);
      margin-bottom: var(--spacing-md);
    }

    .form-group label {
      display: block;
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--color-text-secondary);
      margin-bottom: var(--spacing-xs);
    }

    .form-group input[type="text"],
    .form-group input[type="number"] {
      width: 100%;
      padding: var(--spacing-sm);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-bg-primary);
      color: var(--color-text-primary);
      font-size: 0.875rem;
    }

    .checkbox-group {
      display: flex;
      gap: var(--spacing-md);
    }

    .checkbox-group label {
      display: flex;
      align-items: center;
      gap: var(--spacing-xs);
      font-size: 0.875rem;
      cursor: pointer;
    }

    .btn {
      padding: var(--spacing-sm) var(--spacing-md);
      border-radius: var(--radius-md);
      font-weight: 500;
      font-size: 0.875rem;
      cursor: pointer;
      border: none;
      transition: all var(--transition-fast);
    }

    .btn-primary {
      background: var(--color-accent-primary);
      color: white;
    }

    .btn-primary:hover { opacity: 0.9; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

    .btn-secondary {
      background: var(--color-bg-tertiary);
      color: var(--color-text-primary);
      border: 1px solid var(--color-border);
    }

    .btn-danger {
      background: rgba(239, 68, 68, 0.1);
      color: var(--color-danger);
      border: 1px solid rgba(239, 68, 68, 0.3);
    }

    .btn-sm {
      padding: 4px 8px;
      font-size: 0.75rem;
    }

    .table-wrapper {
      overflow-x: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th, td {
      padding: var(--spacing-sm) var(--spacing-md);
      text-align: left;
      border-bottom: 1px solid var(--color-border);
      font-size: 0.8125rem;
    }

    th {
      font-weight: 600;
      color: var(--color-text-secondary);
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    tr:hover {
      background: var(--color-bg-tertiary);
      cursor: pointer;
    }

    tr.selected {
      background: var(--color-bg-elevated);
    }

    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 0.6875rem;
      font-weight: 600;
      text-transform: uppercase;
    }

    .badge-draft { background: var(--color-bg-tertiary); color: var(--color-text-secondary); }
    .badge-scheduled { background: rgba(99, 102, 241, 0.15); color: var(--color-primary); }
    .badge-sending { background: rgba(245, 158, 11, 0.15); color: var(--color-warning); }
    .badge-completed { background: rgba(34, 197, 94, 0.15); color: var(--color-success); }
    .badge-cancelled { background: rgba(239, 68, 68, 0.15); color: var(--color-danger); }
    .badge-pending_send { background: var(--color-bg-tertiary); color: var(--color-text-secondary); }
    .badge-sent { background: rgba(99, 102, 241, 0.15); color: var(--color-primary); }
    .badge-opened { background: rgba(245, 158, 11, 0.15); color: var(--color-warning); }
    .badge-converted { background: rgba(34, 197, 94, 0.15); color: var(--color-success); }
    .badge-failed { background: rgba(239, 68, 68, 0.15); color: var(--color-danger); }
    .badge-skipped { background: var(--color-bg-tertiary); color: var(--color-text-secondary); }
    .badge-segment { background: rgba(139, 92, 246, 0.15); color: #a78bfa; }

    .font-medium { font-weight: 500; }
    .font-mono { font-family: var(--font-mono); font-size: 0.75rem; }
    .text-muted { color: var(--color-text-secondary); }

    .empty-state {
      text-align: center;
      padding: var(--spacing-xl);
      color: var(--color-text-secondary);
    }

    .message-preview {
      max-width: 300px;
      font-size: 0.75rem;
      color: var(--color-text-secondary);
    }
  `],
})
export class CampaignsComponent implements OnInit {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  settings = signal<BroadcastSettings | null>(null);
  stats = signal<BroadcastStats | null>(null);
  campaigns = signal<Campaign[]>([]);
  selectedCampaign = signal<Campaign | null>(null);
  campaignLogs = signal<CampaignSendLog[]>([]);
  syncing = signal(false);

  newCampaign = {
    name: '',
    maxDiscountPct: 10,
    segActive: true,
    segSleeping: true,
    segNew: false,
    usePersonalTime: true,
  };

  private apiUrl = environment.apiBaseUrl;

  ngOnInit() {
    this.loadSettings();
    this.loadStats();
    this.loadCampaigns();
  }

  async loadSettings() {
    this.http
      .get<ApiResponse<BroadcastSettings>>(`${this.apiUrl}/broadcast/settings`, {
        headers: this.auth.getAuthHeaders(),
      })
      .subscribe({
        next: (res) => {
          if (res.data) this.settings.set(res.data);
        },
      });
  }

  async loadStats() {
    this.http
      .get<ApiResponse<BroadcastStats>>(`${this.apiUrl}/broadcast/stats`, {
        headers: this.auth.getAuthHeaders(),
      })
      .subscribe({
        next: (res) => {
          if (res.data) this.stats.set(res.data);
        },
      });
  }

  async loadCampaigns() {
    this.http
      .get<ApiResponse<Campaign[]>>(`${this.apiUrl}/broadcast/campaigns`, {
        headers: this.auth.getAuthHeaders(),
      })
      .subscribe({
        next: (res) => {
          if (res.data) this.campaigns.set(res.data);
        },
      });
  }

  toggleEnabled(value: boolean) {
    this.http
      .put<ApiResponse<BroadcastSettings>>(
        `${this.apiUrl}/broadcast/settings`,
        { isEnabled: value },
        { headers: this.auth.getAuthHeaders() },
      )
      .subscribe({
        next: (res) => {
          if (res.data) this.settings.set(res.data);
        },
      });
  }

  updateSetting(key: string, value: number) {
    this.http
      .put<ApiResponse<BroadcastSettings>>(
        `${this.apiUrl}/broadcast/settings`,
        { [key]: value },
        { headers: this.auth.getAuthHeaders() },
      )
      .subscribe({
        next: (res) => {
          if (res.data) this.settings.set(res.data);
        },
      });
  }

  syncProfiles() {
    this.syncing.set(true);
    this.http
      .post<ApiResponse<any>>(`${this.apiUrl}/broadcast/customers/sync`, {}, {
        headers: this.auth.getAuthHeaders(),
      })
      .subscribe({
        next: () => {
          this.syncing.set(false);
          this.loadStats();
        },
        error: () => {
          this.syncing.set(false);
        },
      });
  }

  createCampaign() {
    const segments: string[] = [];
    if (this.newCampaign.segActive) segments.push('ACTIVE');
    if (this.newCampaign.segSleeping) segments.push('SLEEPING');
    if (this.newCampaign.segNew) segments.push('NEW');

    if (segments.length === 0) return;

    this.http
      .post<ApiResponse<Campaign>>(
        `${this.apiUrl}/broadcast/campaigns`,
        {
          name: this.newCampaign.name,
          targetSegments: segments,
          maxDiscountPct: this.newCampaign.maxDiscountPct,
          usePersonalTime: this.newCampaign.usePersonalTime,
        },
        { headers: this.auth.getAuthHeaders() },
      )
      .subscribe({
        next: () => {
          this.newCampaign.name = '';
          this.loadCampaigns();
        },
      });
  }

  scheduleCampaign(id: string) {
    this.http
      .post<ApiResponse<any>>(`${this.apiUrl}/broadcast/campaigns/${id}/schedule`, {}, {
        headers: this.auth.getAuthHeaders(),
      })
      .subscribe({ next: () => this.loadCampaigns() });
  }

  cancelCampaign(id: string) {
    this.http
      .post<ApiResponse<any>>(`${this.apiUrl}/broadcast/campaigns/${id}/cancel`, {}, {
        headers: this.auth.getAuthHeaders(),
      })
      .subscribe({ next: () => this.loadCampaigns() });
  }

  selectCampaign(campaign: Campaign) {
    this.selectedCampaign.set(campaign);
    this.http
      .get<ApiResponse<CampaignSendLog[]>>(`${this.apiUrl}/broadcast/campaigns/${campaign.id}/logs`, {
        headers: this.auth.getAuthHeaders(),
      })
      .subscribe({
        next: (res) => {
          if (res.data) this.campaignLogs.set(res.data);
        },
      });
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      DRAFT: 'Taslak',
      SCHEDULED: 'Zamanlandi',
      SENDING: 'Gonderiliyor',
      COMPLETED: 'Tamamlandi',
      CANCELLED: 'Iptal',
    };
    return labels[status] || status;
  }
}
