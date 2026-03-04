import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { IconComponent } from '../../shared/icon.component';
import { AuthService } from '../../services/auth.service';
import { environment } from '../../../environments/environment';

interface DashboardStats {
  todayOrders: number;
  todayRevenue: number;
  activeConversations: number;
  totalCustomers: number;
  ordersByStatus: {
    pending: number;
    confirmed: number;
    preparing: number;
    ready: number;
    delivered: number;
    cancelled: number;
  };
  weeklyTrend: Array<{ date: string; orders: number; revenue: number }>;
  recentOrders: Array<{
    id: string;
    orderNumber: number;
    customerName: string | null;
    customerPhone: string;
    status: string;
    totalPrice: number;
    createdAt: string;
    itemCount: number;
  }>;
  popularItems: Array<{ name: string; totalQty: number; orderCount: number }>;
  satisfaction: {
    averageRating: number | null;
    totalSurveys: number;
    complaintCount: number;
  };
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="dashboard">
      <div class="dashboard-header">
        <h1 class="dashboard-title">Dashboard</h1>
        <p class="dashboard-subtitle text-secondary">
          Restoran yonetim panelinize hos geldiniz.
        </p>
      </div>

      @if (loading()) {
        <div class="loading-state">
          <div class="loader"></div>
          <span class="text-muted">Veriler yukleniyor...</span>
        </div>
      } @else if (error()) {
        <div class="error-state">
          <app-icon name="alert-triangle" [size]="20" />
          <span class="error-message">{{ error() }}</span>
          <button class="retry-btn" (click)="loadStats()">Tekrar Dene</button>
        </div>
      } @else if (stats()) {
        <!-- KPI Cards -->
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-icon" style="background: var(--color-accent-primary)">
              <app-icon name="package" [size]="22" />
            </div>
            <div class="stat-content">
              <span class="stat-value">{{ stats()!.todayOrders }}</span>
              <span class="stat-label text-muted">Bugunku Siparisler</span>
            </div>
          </div>

          <div class="stat-card">
            <div class="stat-icon" style="background: #14b8a6">
              <app-icon name="credit-card" [size]="22" />
            </div>
            <div class="stat-content">
              <span class="stat-value">{{ formatCurrency(stats()!.todayRevenue) }}</span>
              <span class="stat-label text-muted">Bugunku Gelir</span>
            </div>
          </div>

          <div class="stat-card">
            <div class="stat-icon" style="background: #22c55e">
              <app-icon name="message-square" [size]="22" />
            </div>
            <div class="stat-content">
              <span class="stat-value">{{ stats()!.activeConversations }}</span>
              <span class="stat-label text-muted">Aktif Konusmalar</span>
            </div>
          </div>

          <div class="stat-card">
            <div class="stat-icon" style="background: #f59e0b">
              <app-icon name="users" [size]="22" />
            </div>
            <div class="stat-content">
              <span class="stat-value">{{ stats()!.totalCustomers }}</span>
              <span class="stat-label text-muted">Toplam Musteri</span>
            </div>
          </div>
        </div>

        <!-- Two column layout -->
        <div class="dashboard-grid">
          <!-- Left column -->
          <div class="dashboard-col">
            <!-- Order Status -->
            <div class="card">
              <h2 class="card-title">Siparis Durumlari</h2>
              <div class="status-grid">
                <div class="status-item">
                  <span class="status-dot pending"></span>
                  <span class="status-name">Bekleyen</span>
                  <span class="status-count">{{ stats()!.ordersByStatus.pending }}</span>
                </div>
                <div class="status-item">
                  <span class="status-dot confirmed"></span>
                  <span class="status-name">Onaylanan</span>
                  <span class="status-count">{{ stats()!.ordersByStatus.confirmed }}</span>
                </div>
                <div class="status-item">
                  <span class="status-dot preparing"></span>
                  <span class="status-name">Hazirlanan</span>
                  <span class="status-count">{{ stats()!.ordersByStatus.preparing }}</span>
                </div>
                <div class="status-item">
                  <span class="status-dot ready"></span>
                  <span class="status-name">Hazir</span>
                  <span class="status-count">{{ stats()!.ordersByStatus.ready }}</span>
                </div>
                <div class="status-item">
                  <span class="status-dot delivered"></span>
                  <span class="status-name">Teslim Edildi</span>
                  <span class="status-count">{{ stats()!.ordersByStatus.delivered }}</span>
                </div>
                <div class="status-item">
                  <span class="status-dot cancelled"></span>
                  <span class="status-name">Iptal</span>
                  <span class="status-count">{{ stats()!.ordersByStatus.cancelled }}</span>
                </div>
              </div>
            </div>

            <!-- Weekly Trend -->
            <div class="card">
              <h2 class="card-title">Son 7 Gun</h2>
              <div class="trend-list">
                @for (day of stats()!.weeklyTrend; track day.date) {
                  <div class="trend-row">
                    <span class="trend-date">{{ formatDay(day.date) }}</span>
                    <div class="trend-bar-wrap">
                      <div class="trend-bar" [style.width.%]="getTrendBarWidth(day.orders)"></div>
                    </div>
                    <span class="trend-orders">{{ day.orders }} siparis</span>
                    <span class="trend-revenue">{{ formatCurrency(day.revenue) }}</span>
                  </div>
                }
              </div>
            </div>

            <!-- Satisfaction -->
            @if (stats()!.satisfaction.totalSurveys > 0) {
              <div class="card">
                <h2 class="card-title">Musteri Memnuniyeti</h2>
                <div class="satisfaction-grid">
                  <div class="satisfaction-item">
                    <span class="satisfaction-value">
                      {{ stats()!.satisfaction.averageRating || '-' }}
                      @if (stats()!.satisfaction.averageRating) {
                        <span class="star">&#9733;</span>
                      }
                    </span>
                    <span class="satisfaction-label text-muted">Ort. Puan</span>
                  </div>
                  <div class="satisfaction-item">
                    <span class="satisfaction-value">{{ stats()!.satisfaction.totalSurveys }}</span>
                    <span class="satisfaction-label text-muted">Anket</span>
                  </div>
                  <div class="satisfaction-item">
                    <span class="satisfaction-value complaint-val">{{ stats()!.satisfaction.complaintCount }}</span>
                    <span class="satisfaction-label text-muted">Sikayet</span>
                  </div>
                </div>
              </div>
            }
          </div>

          <!-- Right column -->
          <div class="dashboard-col">
            <!-- Recent Orders -->
            <div class="card">
              <h2 class="card-title">Son Siparisler</h2>
              @if (stats()!.recentOrders.length === 0) {
                <p class="text-muted empty-msg">Henuz siparis yok.</p>
              } @else {
                <div class="order-list">
                  @for (order of stats()!.recentOrders; track order.id) {
                    <div class="order-row">
                      <div class="order-info">
                        <span class="order-number">#{{ order.orderNumber || '—' }}</span>
                        <span class="order-customer">{{ order.customerName || order.customerPhone || 'Misafir' }}</span>
                      </div>
                      <div class="order-meta">
                        <span class="order-badge" [class]="'badge-' + order.status.toLowerCase()">
                          {{ getStatusLabel(order.status) }}
                        </span>
                        <span class="order-price">{{ formatCurrency(order.totalPrice) }}</span>
                      </div>
                      <div class="order-footer">
                        <span class="text-muted order-items">{{ order.itemCount }} urun</span>
                        <span class="text-muted order-time">{{ timeAgo(order.createdAt) }}</span>
                      </div>
                    </div>
                  }
                </div>
              }
            </div>

            <!-- Popular Items -->
            <div class="card">
              <h2 class="card-title">Populer Urunler</h2>
              @if (stats()!.popularItems.length === 0) {
                <p class="text-muted empty-msg">Henuz veri yok.</p>
              } @else {
                <div class="popular-list">
                  @for (item of stats()!.popularItems; track item.name; let i = $index) {
                    <div class="popular-row">
                      <span class="popular-rank">{{ i + 1 }}</span>
                      <span class="popular-name">{{ item.name }}</span>
                      <span class="popular-qty">{{ item.totalQty }} adet</span>
                    </div>
                  }
                </div>
              }
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .dashboard {
        max-width: 1200px;
        margin: 0 auto;
        animation: fadeIn 0.3s ease;
      }

      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .dashboard-header {
        margin-bottom: var(--spacing-xl);
      }

      .dashboard-title {
        font-size: 2rem;
        font-weight: 700;
        letter-spacing: -0.02em;
        margin-bottom: var(--spacing-xs);
      }

      .dashboard-subtitle {
        font-size: 1rem;
      }

      /* KPI Cards */
      .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: var(--spacing-md);
        margin-bottom: var(--spacing-xl);
      }

      .stat-card {
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        padding: var(--spacing-lg);
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        transition: all var(--transition-fast);

        &:hover {
          border-color: var(--color-border-hover);
          transform: translateY(-2px);
        }
      }

      .stat-icon {
        width: 48px;
        height: 48px;
        border-radius: var(--radius-md);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        flex-shrink: 0;
      }

      .stat-content {
        display: flex;
        flex-direction: column;
      }

      .stat-value {
        font-size: 1.5rem;
        font-weight: 700;
        letter-spacing: -0.02em;
      }

      .stat-label {
        font-size: 0.813rem;
      }

      /* Two column grid */
      .dashboard-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--spacing-lg);
      }

      @media (max-width: 768px) {
        .dashboard-grid {
          grid-template-columns: 1fr;
        }
      }

      .dashboard-col {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-lg);
      }

      .card {
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        padding: var(--spacing-lg);
      }

      .card-title {
        font-size: 1rem;
        font-weight: 600;
        margin-bottom: var(--spacing-md);
      }

      .empty-msg {
        font-size: 0.875rem;
        padding: var(--spacing-md) 0;
      }

      /* Status Grid */
      .status-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--spacing-sm);
      }

      .status-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-xs);
      }

      .status-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .status-dot.pending { background: #f59e0b; }
      .status-dot.confirmed { background: #3b82f6; }
      .status-dot.preparing { background: #8b5cf6; }
      .status-dot.ready { background: #14b8a6; }
      .status-dot.delivered { background: #22c55e; }
      .status-dot.cancelled { background: #ef4444; }

      .status-name {
        flex: 1;
        font-size: 0.813rem;
        color: var(--color-text-secondary);
      }

      .status-count {
        font-weight: 600;
        font-size: 0.875rem;
        font-family: var(--font-mono);
      }

      /* Weekly Trend */
      .trend-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }

      .trend-row {
        display: grid;
        grid-template-columns: 60px 1fr 80px 90px;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-xs) 0;
        font-size: 0.813rem;
      }

      .trend-date {
        color: var(--color-text-secondary);
        font-family: var(--font-mono);
      }

      .trend-bar-wrap {
        height: 6px;
        background: var(--color-border);
        border-radius: 3px;
        overflow: hidden;
      }

      .trend-bar {
        height: 100%;
        background: var(--color-accent-primary);
        border-radius: 3px;
        min-width: 2px;
        transition: width 0.5s ease;
      }

      .trend-orders {
        text-align: right;
        color: var(--color-text-secondary);
      }

      .trend-revenue {
        text-align: right;
        font-weight: 600;
        font-family: var(--font-mono);
      }

      /* Satisfaction */
      .satisfaction-grid {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: var(--spacing-md);
        text-align: center;
      }

      .satisfaction-item {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }

      .satisfaction-value {
        font-size: 1.5rem;
        font-weight: 700;
      }

      .satisfaction-label {
        font-size: 0.75rem;
      }

      .star {
        color: #f59e0b;
        font-size: 1.2rem;
      }

      .complaint-val {
        color: #ef4444;
      }

      /* Order List */
      .order-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }

      .order-row {
        padding: var(--spacing-sm);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        transition: border-color var(--transition-fast);

        &:hover {
          border-color: var(--color-border-hover);
        }
      }

      .order-info {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        margin-bottom: 4px;
      }

      .order-number {
        font-weight: 700;
        font-family: var(--font-mono);
        font-size: 0.875rem;
      }

      .order-customer {
        font-size: 0.813rem;
        color: var(--color-text-secondary);
      }

      .order-meta {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 4px;
      }

      .order-badge {
        padding: 2px 8px;
        border-radius: var(--radius-sm);
        font-size: 0.688rem;
        font-weight: 500;
        text-transform: uppercase;
      }

      .badge-pending_confirmation { background: #fef3c7; color: #92400e; }
      .badge-confirmed { background: #dbeafe; color: #1e40af; }
      .badge-preparing { background: #ede9fe; color: #5b21b6; }
      .badge-ready { background: #ccfbf1; color: #065f46; }
      .badge-delivered { background: #dcfce7; color: #166534; }
      .badge-cancelled { background: #fee2e2; color: #991b1b; }

      .order-price {
        font-weight: 700;
        font-family: var(--font-mono);
        font-size: 0.875rem;
      }

      .order-footer {
        display: flex;
        justify-content: space-between;
        font-size: 0.75rem;
      }

      /* Popular Items */
      .popular-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }

      .popular-row {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-xs) 0;
        border-bottom: 1px solid var(--color-border);

        &:last-child {
          border-bottom: none;
        }
      }

      .popular-rank {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: var(--color-bg-elevated);
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 700;
        font-size: 0.75rem;
        flex-shrink: 0;
      }

      .popular-name {
        flex: 1;
        font-size: 0.875rem;
      }

      .popular-qty {
        font-size: 0.813rem;
        font-family: var(--font-mono);
        color: var(--color-text-secondary);
      }

      /* Loading / Error */
      .loading-state {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-md);
        padding: var(--spacing-xl);
      }

      .loader {
        width: 24px;
        height: 24px;
        border: 3px solid var(--color-border);
        border-top-color: var(--color-accent-primary);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      .error-state {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        padding: var(--spacing-lg);
        background: rgba(239, 68, 68, 0.1);
        border-radius: var(--radius-lg);
      }

      .error-message {
        flex: 1;
        color: var(--color-accent-danger);
      }

      .retry-btn {
        padding: var(--spacing-xs) var(--spacing-md);
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-primary);
        font-size: 0.875rem;
        cursor: pointer;
        transition: all var(--transition-fast);

        &:hover {
          background: var(--color-bg-tertiary);
        }
      }
    `,
  ],
})
export class DashboardComponent implements OnInit {
  private http = inject(HttpClient);
  private authService = inject(AuthService);

  loading = signal(true);
  error = signal<string | null>(null);
  stats = signal<DashboardStats | null>(null);

  private maxTrendOrders = 1;

  ngOnInit(): void {
    this.loadStats();
  }

  loadStats(): void {
    this.loading.set(true);
    this.error.set(null);

    this.http
      .get<{ success: boolean; data: DashboardStats }>(
        `${environment.apiBaseUrl}/dashboard/stats`,
        { headers: this.authService.getAuthHeaders() },
      )
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.stats.set(res.data);
            this.maxTrendOrders = Math.max(
              1,
              ...res.data.weeklyTrend.map((d) => d.orders),
            );
          }
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(err?.error?.error?.message || 'Veriler yuklenemedi');
          this.loading.set(false);
        },
      });
  }

  formatCurrency(amount: number): string {
    return amount.toLocaleString('tr-TR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }) + ' TL';
  }

  formatDay(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');
    const days = ['Paz', 'Pzt', 'Sal', 'Car', 'Per', 'Cum', 'Cmt'];
    return days[d.getDay()];
  }

  getTrendBarWidth(orders: number): number {
    return (orders / this.maxTrendOrders) * 100;
  }

  getStatusLabel(status: string): string {
    const map: Record<string, string> = {
      PENDING_CONFIRMATION: 'Bekliyor',
      CONFIRMED: 'Onaylandi',
      PREPARING: 'Hazirlaniyor',
      READY: 'Hazir',
      DELIVERED: 'Teslim',
      CANCELLED: 'Iptal',
    };
    return map[status] || status;
  }

  timeAgo(dateStr: string): string {
    const now = Date.now();
    const diff = now - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Az once';
    if (mins < 60) return `${mins} dk once`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} saat once`;
    const days = Math.floor(hours / 24);
    return `${days} gun once`;
  }
}
