import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../services/auth.service';

interface CustomerProfile {
  id: string;
  tenantId: string;
  customerPhone: string;
  customerName: string | null;
  segment: 'ACTIVE' | 'SLEEPING' | 'NEW';
  broadcastOptIn: 'PENDING' | 'OPTED_IN' | 'OPTED_OUT';
  optInAskedAt: string | null;
  optInChangedAt: string | null;
  avgOrderHour: number | null;
  lastOrderAt: string | null;
  orderCount: number;
  totalSpent: number | string;
  createdAt: string;
  updatedAt: string;
}

interface CustomerDetail extends CustomerProfile {
  orders: CustomerOrder[];
  favorites: FavoriteItem[];
}

interface CustomerOrder {
  id: string;
  orderNumber: number;
  status: string;
  totalPrice: number | string;
  createdAt: string;
  itemCount: number;
  items: { menuItemName: string; qty: number; unitPrice: number | string }[];
}

interface FavoriteItem {
  menuItemId: string;
  menuItemName: string;
  totalQty: number;
  orderCount: number;
  currentPrice: number | string;
  category: string | null;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

interface Stats {
  totalCustomers: number;
  optedIn: number;
  segments: Record<string, number>;
  totalSent: number;
  totalOpened: number;
  totalConverted: number;
}

@Component({
  selector: 'app-customers',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <h1 class="page-title">Musteriler</h1>
          <p class="page-subtitle">Musteri profilleri ve siparis gecmisleri</p>
        </div>
        <div class="header-actions">
          <button class="btn btn-secondary" (click)="syncProfiles()" [disabled]="syncing()">
            {{ syncing() ? 'Senkronize ediliyor...' : 'Profilleri Senkronla' }}
          </button>
        </div>
      </div>

      <!-- Stats Cards -->
      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-value">{{ stats()?.totalCustomers || 0 }}</div>
          <div class="stat-label">Toplam Musteri</div>
        </div>
        <div class="stat-card stat-active">
          <div class="stat-value">{{ stats()?.segments?.['ACTIVE'] || 0 }}</div>
          <div class="stat-label">Aktif</div>
        </div>
        <div class="stat-card stat-sleeping">
          <div class="stat-value">{{ stats()?.segments?.['SLEEPING'] || 0 }}</div>
          <div class="stat-label">Uyuyan</div>
        </div>
        <div class="stat-card stat-new">
          <div class="stat-value">{{ stats()?.segments?.['NEW'] || 0 }}</div>
          <div class="stat-label">Yeni</div>
        </div>
        <div class="stat-card stat-optin">
          <div class="stat-value">{{ stats()?.optedIn || 0 }}</div>
          <div class="stat-label">Kampanya Izinli</div>
        </div>
      </div>

      <!-- Filters -->
      <div class="filters-row">
        <div class="search-box">
          <span class="search-icon">&#128269;</span>
          <input
            type="text"
            placeholder="Isim veya telefon ara..."
            [ngModel]="searchQuery()"
            (ngModelChange)="searchQuery.set($event)"
            class="search-input"
          />
        </div>
        <div class="filter-group">
          <select [ngModel]="segmentFilter()" (ngModelChange)="onSegmentChange($event)" class="filter-select">
            <option value="">Tum Segmentler</option>
            <option value="ACTIVE">Aktif</option>
            <option value="SLEEPING">Uyuyan</option>
            <option value="NEW">Yeni</option>
          </select>
          <select [ngModel]="optInFilter()" (ngModelChange)="onOptInChange($event)" class="filter-select">
            <option value="">Tum Izinler</option>
            <option value="OPTED_IN">Kampanya Izinli</option>
            <option value="OPTED_OUT">Reddetti</option>
            <option value="PENDING">Bekliyor</option>
          </select>
          <select [ngModel]="sortBy()" (ngModelChange)="sortBy.set($event)" class="filter-select">
            <option value="orderCount">Siparis Sayisi</option>
            <option value="totalSpent">Toplam Harcama</option>
            <option value="lastOrderAt">Son Siparis</option>
            <option value="name">Isim</option>
          </select>
        </div>
      </div>

      <!-- Content -->
      <div class="content-layout" [class.detail-open]="selectedCustomer()">
        <!-- Customer List -->
        <div class="customer-list">
          @if (loading()) {
            <div class="loading-state">Yukleniyor...</div>
          } @else if (filteredCustomers().length === 0) {
            <div class="empty-state">
              @if (customers().length === 0) {
                <p>Henuz musteri profili yok.</p>
                <p class="text-muted">Profilleri senkronlayarak mevcut musterileri yukleyin.</p>
              } @else {
                <p>Filtrelere uygun musteri bulunamadi.</p>
              }
            </div>
          } @else {
            <div class="table-wrapper">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Musteri</th>
                    <th>Segment</th>
                    <th>Siparis</th>
                    <th>Harcama</th>
                    <th>Son Siparis</th>
                    <th>Kampanya</th>
                    <th>Saat</th>
                  </tr>
                </thead>
                <tbody>
                  @for (c of paginatedCustomers(); track c.id) {
                    <tr
                      class="customer-row"
                      [class.selected]="selectedCustomer()?.id === c.id"
                      (click)="selectCustomer(c)"
                    >
                      <td class="customer-cell">
                        <div class="customer-avatar">{{ getInitial(c) }}</div>
                        <div class="customer-info">
                          <span class="customer-name">{{ c.customerName || 'Isimsiz' }}</span>
                          <span class="customer-phone">{{ formatPhone(c.customerPhone) }}</span>
                        </div>
                      </td>
                      <td>
                        <span class="badge" [class]="'badge-' + c.segment.toLowerCase()">
                          {{ segmentLabel(c.segment) }}
                        </span>
                      </td>
                      <td class="num-cell">{{ c.orderCount }}</td>
                      <td class="num-cell">{{ formatMoney(c.totalSpent) }}</td>
                      <td class="date-cell">{{ c.lastOrderAt ? formatDate(c.lastOrderAt) : '-' }}</td>
                      <td>
                        <span class="badge" [class]="'badge-optin-' + c.broadcastOptIn.toLowerCase()">
                          {{ optInLabel(c.broadcastOptIn) }}
                        </span>
                      </td>
                      <td class="num-cell">{{ c.avgOrderHour != null ? (c.avgOrderHour + ':00') : '-' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            <!-- Pagination -->
            @if (totalPages() > 1) {
              <div class="pagination">
                <button class="btn btn-sm" [disabled]="currentPage() <= 1" (click)="currentPage.set(currentPage() - 1)">Onceki</button>
                <span class="page-info">{{ currentPage() }} / {{ totalPages() }}</span>
                <button class="btn btn-sm" [disabled]="currentPage() >= totalPages()" (click)="currentPage.set(currentPage() + 1)">Sonraki</button>
              </div>
            }
          }
        </div>

        <!-- Customer Detail Panel -->
        @if (selectedCustomer(); as customer) {
          <div class="detail-panel">
            <div class="detail-header">
              <div class="detail-title-row">
                <h2 class="detail-name">{{ customer.customerName || 'Isimsiz' }}</h2>
                <button class="close-btn" (click)="selectedCustomer.set(null)">&times;</button>
              </div>
              <p class="detail-phone">{{ formatPhone(customer.customerPhone) }}</p>
              <div class="detail-badges">
                <span class="badge" [class]="'badge-' + customer.segment.toLowerCase()">{{ segmentLabel(customer.segment) }}</span>
                <span class="badge" [class]="'badge-optin-' + customer.broadcastOptIn.toLowerCase()">{{ optInLabel(customer.broadcastOptIn) }}</span>
              </div>
            </div>

            <div class="detail-stats">
              <div class="detail-stat">
                <span class="detail-stat-value">{{ customer.orderCount }}</span>
                <span class="detail-stat-label">Siparis</span>
              </div>
              <div class="detail-stat">
                <span class="detail-stat-value">{{ formatMoney(customer.totalSpent) }}</span>
                <span class="detail-stat-label">Toplam</span>
              </div>
              <div class="detail-stat">
                <span class="detail-stat-value">{{ customer.avgOrderHour != null ? (customer.avgOrderHour + ':00') : '-' }}</span>
                <span class="detail-stat-label">Ort. Saat</span>
              </div>
            </div>

            <!-- Favorites -->
            @if (detailLoading()) {
              <div class="detail-loading">Detaylar yukleniyor...</div>
            } @else {
              @if (customerFavorites().length > 0) {
                <div class="detail-section">
                  <h3 class="section-title">Favori Urunler</h3>
                  <div class="favorites-list">
                    @for (fav of customerFavorites(); track fav.menuItemId) {
                      <div class="favorite-item">
                        <div class="fav-info">
                          <span class="fav-name">{{ fav.menuItemName }}</span>
                          @if (fav.category) {
                            <span class="fav-category">{{ fav.category }}</span>
                          }
                        </div>
                        <div class="fav-stats">
                          <span class="fav-qty">{{ fav.totalQty }}x</span>
                          <span class="fav-price">{{ formatMoney(fav.currentPrice) }}</span>
                        </div>
                      </div>
                    }
                  </div>
                </div>
              }

              <!-- Order History -->
              @if (customerOrders().length > 0) {
                <div class="detail-section">
                  <h3 class="section-title">Siparis Gecmisi</h3>
                  <div class="orders-list">
                    @for (order of customerOrders(); track order.id) {
                      <div class="order-card" (click)="toggleOrderExpand(order.id)">
                        <div class="order-header-row">
                          <span class="order-number">#{{ order.orderNumber }}</span>
                          <span class="badge badge-status" [class]="'badge-status-' + order.status.toLowerCase()">{{ statusLabel(order.status) }}</span>
                        </div>
                        <div class="order-meta">
                          <span>{{ formatMoney(order.totalPrice) }}</span>
                          <span class="text-muted">{{ formatDate(order.createdAt) }}</span>
                        </div>
                        @if (expandedOrderId() === order.id && order.items.length > 0) {
                          <div class="order-items">
                            @for (item of order.items; track $index) {
                              <div class="order-item-row">
                                <span>{{ item.qty }}x {{ item.menuItemName }}</span>
                                <span class="text-muted">{{ formatMoney(item.unitPrice) }}</span>
                              </div>
                            }
                          </div>
                        }
                      </div>
                    }
                  </div>
                </div>
              }
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .page {
        padding: var(--spacing-xl);
        max-width: 1400px;
      }

      .page-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: var(--spacing-xl);
      }

      .page-title {
        font-size: 1.5rem;
        font-weight: 700;
        margin-bottom: var(--spacing-xs);
      }

      .page-subtitle {
        color: var(--color-text-secondary);
        font-size: 0.875rem;
      }

      .header-actions {
        display: flex;
        gap: var(--spacing-sm);
      }

      .btn {
        padding: var(--spacing-sm) var(--spacing-lg);
        border-radius: var(--radius-md);
        font-weight: 500;
        cursor: pointer;
        border: 1px solid var(--color-border);
        background: var(--color-bg-secondary);
        color: var(--color-text-primary);
        transition: all var(--transition-fast);

        &:hover:not(:disabled) {
          background: var(--color-bg-tertiary);
        }

        &:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      }

      .btn-sm {
        padding: var(--spacing-xs) var(--spacing-md);
        font-size: 0.8125rem;
      }

      .btn-secondary {
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
      }

      /* Stats */
      .stats-row {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: var(--spacing-md);
        margin-bottom: var(--spacing-lg);
      }

      .stat-card {
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        padding: var(--spacing-lg);
        text-align: center;
      }

      .stat-value {
        font-size: 1.75rem;
        font-weight: 700;
        font-family: var(--font-mono);
      }

      .stat-label {
        font-size: 0.75rem;
        color: var(--color-text-secondary);
        margin-top: var(--spacing-xs);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .stat-active .stat-value { color: var(--color-success); }
      .stat-sleeping .stat-value { color: var(--color-warning); }
      .stat-new .stat-value { color: var(--color-primary); }
      .stat-optin .stat-value { color: #5DADE2; }

      /* Filters */
      .filters-row {
        display: flex;
        gap: var(--spacing-md);
        margin-bottom: var(--spacing-lg);
        align-items: center;
        flex-wrap: wrap;
      }

      .search-box {
        position: relative;
        flex: 1;
        min-width: 200px;
      }

      .search-icon {
        position: absolute;
        left: 12px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 0.875rem;
        opacity: 0.5;
      }

      .search-input {
        width: 100%;
        padding: var(--spacing-sm) var(--spacing-md) var(--spacing-sm) 36px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-bg-secondary);
        color: var(--color-text-primary);
        font-size: 0.875rem;

        &:focus {
          outline: none;
          border-color: var(--color-accent-primary);
        }
      }

      .filter-group {
        display: flex;
        gap: var(--spacing-sm);
      }

      .filter-select {
        padding: var(--spacing-sm) var(--spacing-md);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-bg-secondary);
        color: var(--color-text-primary);
        font-size: 0.8125rem;
        cursor: pointer;

        &:focus {
          outline: none;
          border-color: var(--color-accent-primary);
        }
      }

      /* Content Layout */
      .content-layout {
        display: flex;
        gap: var(--spacing-lg);
        transition: all var(--transition-normal);
      }

      .customer-list {
        flex: 1;
        min-width: 0;
      }

      /* Table */
      .table-wrapper {
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        overflow: auto;
      }

      .data-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.875rem;
      }

      .data-table thead {
        position: sticky;
        top: 0;
        background: var(--color-bg-tertiary);
        z-index: 1;
      }

      .data-table th {
        padding: var(--spacing-sm) var(--spacing-md);
        text-align: left;
        font-weight: 600;
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-text-secondary);
        border-bottom: 1px solid var(--color-border);
        white-space: nowrap;
      }

      .data-table td {
        padding: var(--spacing-sm) var(--spacing-md);
        border-bottom: 1px solid var(--color-border);
        white-space: nowrap;
      }

      .customer-row {
        cursor: pointer;
        transition: background var(--transition-fast);

        &:hover {
          background: var(--color-bg-tertiary);
        }

        &.selected {
          background: var(--color-bg-elevated);
        }
      }

      .customer-cell {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }

      .customer-avatar {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: var(--color-accent-primary);
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 600;
        font-size: 0.75rem;
        color: white;
        flex-shrink: 0;
      }

      .customer-info {
        display: flex;
        flex-direction: column;
        gap: 1px;
        min-width: 0;
      }

      .customer-name {
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .customer-phone {
        font-size: 0.75rem;
        color: var(--color-text-secondary);
        font-family: var(--font-mono);
      }

      .num-cell {
        font-family: var(--font-mono);
        text-align: right;
      }

      .date-cell {
        font-size: 0.8125rem;
        color: var(--color-text-secondary);
      }

      /* Badges */
      .badge {
        display: inline-block;
        padding: 2px 8px;
        border-radius: var(--radius-sm);
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }

      .badge-active { background: rgba(34,197,94,0.15); color: var(--color-success); }
      .badge-sleeping { background: rgba(245,158,11,0.15); color: var(--color-warning); }
      .badge-new { background: rgba(27,85,131,0.15); color: var(--color-primary); }
      .badge-optin-opted_in { background: rgba(41,128,185,0.15); color: #5DADE2; }
      .badge-optin-opted_out { background: rgba(239,68,68,0.15); color: var(--color-danger); }
      .badge-optin-pending { background: rgba(156,163,175,0.15); color: var(--color-text-muted); }

      .badge-status-delivered { background: rgba(34,197,94,0.15); color: var(--color-success); }
      .badge-status-confirmed, .badge-status-preparing, .badge-status-ready { background: rgba(27,85,131,0.15); color: var(--color-primary); }
      .badge-status-cancelled { background: rgba(239,68,68,0.15); color: var(--color-danger); }
      .badge-status-pending_confirmation { background: rgba(245,158,11,0.15); color: var(--color-warning); }
      .badge-status-draft { background: rgba(156,163,175,0.15); color: var(--color-text-muted); }

      /* Pagination */
      .pagination {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-md);
        padding: var(--spacing-md);
      }

      .page-info {
        font-size: 0.8125rem;
        color: var(--color-text-secondary);
        font-family: var(--font-mono);
      }

      /* Detail Panel */
      .detail-panel {
        width: 380px;
        flex-shrink: 0;
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        overflow-y: auto;
        max-height: calc(100vh - 280px);
        position: sticky;
        top: var(--spacing-lg);
      }

      .detail-header {
        padding: var(--spacing-lg);
        border-bottom: 1px solid var(--color-border);
      }

      .detail-title-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .detail-name {
        font-size: 1.125rem;
        font-weight: 700;
      }

      .close-btn {
        background: none;
        border: none;
        font-size: 1.5rem;
        cursor: pointer;
        color: var(--color-text-secondary);
        padding: 0;
        line-height: 1;

        &:hover {
          color: var(--color-text-primary);
        }
      }

      .detail-phone {
        font-family: var(--font-mono);
        font-size: 0.875rem;
        color: var(--color-text-secondary);
        margin-top: var(--spacing-xs);
      }

      .detail-badges {
        display: flex;
        gap: var(--spacing-sm);
        margin-top: var(--spacing-sm);
      }

      .detail-stats {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        padding: var(--spacing-md) var(--spacing-lg);
        border-bottom: 1px solid var(--color-border);
        text-align: center;
      }

      .detail-stat-value {
        display: block;
        font-weight: 700;
        font-family: var(--font-mono);
        font-size: 1rem;
      }

      .detail-stat-label {
        display: block;
        font-size: 0.6875rem;
        color: var(--color-text-secondary);
        text-transform: uppercase;
        margin-top: 2px;
      }

      .detail-loading {
        padding: var(--spacing-xl);
        text-align: center;
        color: var(--color-text-secondary);
      }

      .detail-section {
        padding: var(--spacing-md) var(--spacing-lg);
        border-bottom: 1px solid var(--color-border);

        &:last-child {
          border-bottom: none;
        }
      }

      .section-title {
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-text-secondary);
        margin-bottom: var(--spacing-sm);
        font-weight: 600;
      }

      /* Favorites */
      .favorites-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }

      .favorite-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--spacing-sm);
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-sm);
      }

      .fav-info {
        display: flex;
        flex-direction: column;
        gap: 1px;
        min-width: 0;
      }

      .fav-name {
        font-weight: 500;
        font-size: 0.8125rem;
      }

      .fav-category {
        font-size: 0.6875rem;
        color: var(--color-text-secondary);
      }

      .fav-stats {
        display: flex;
        gap: var(--spacing-sm);
        align-items: center;
        flex-shrink: 0;
      }

      .fav-qty {
        font-family: var(--font-mono);
        font-size: 0.75rem;
        color: var(--color-text-secondary);
      }

      .fav-price {
        font-family: var(--font-mono);
        font-size: 0.8125rem;
        font-weight: 600;
      }

      /* Orders */
      .orders-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }

      .order-card {
        padding: var(--spacing-sm);
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-sm);
        cursor: pointer;
        transition: background var(--transition-fast);

        &:hover {
          background: var(--color-bg-elevated);
        }
      }

      .order-header-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 2px;
      }

      .order-number {
        font-weight: 600;
        font-family: var(--font-mono);
        font-size: 0.8125rem;
      }

      .order-meta {
        display: flex;
        justify-content: space-between;
        font-size: 0.8125rem;
      }

      .order-items {
        margin-top: var(--spacing-sm);
        padding-top: var(--spacing-sm);
        border-top: 1px solid var(--color-border);
      }

      .order-item-row {
        display: flex;
        justify-content: space-between;
        font-size: 0.75rem;
        padding: 1px 0;
        color: var(--color-text-secondary);
      }

      /* States */
      .loading-state, .empty-state {
        padding: var(--spacing-xxl);
        text-align: center;
        color: var(--color-text-secondary);
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
      }

      .text-muted {
        color: var(--color-text-secondary);
      }

      @media (max-width: 1200px) {
        .stats-row {
          grid-template-columns: repeat(3, 1fr);
        }
      }

      @media (max-width: 768px) {
        .page { padding: var(--spacing-md); }
        .stats-row { grid-template-columns: repeat(2, 1fr); }
        .filters-row { flex-direction: column; }
        .filter-group { flex-wrap: wrap; }
        .detail-panel { display: none; }
        .content-layout.detail-open .detail-panel {
          display: block;
          position: fixed;
          inset: 0;
          width: 100%;
          max-height: 100vh;
          z-index: 200;
          border-radius: 0;
        }
      }
    `,
  ],
})
export class CustomersComponent implements OnInit {
  private http = inject(HttpClient);
  private authService = inject(AuthService);
  private apiUrl = environment.apiBaseUrl;

  // State
  customers = signal<CustomerProfile[]>([]);
  stats = signal<Stats | null>(null);
  loading = signal(true);
  syncing = signal(false);
  selectedCustomer = signal<CustomerProfile | null>(null);
  detailLoading = signal(false);
  customerFavorites = signal<FavoriteItem[]>([]);
  customerOrders = signal<CustomerOrder[]>([]);
  expandedOrderId = signal<string | null>(null);

  // Filters
  searchQuery = signal('');
  segmentFilter = signal('');
  optInFilter = signal('');
  sortBy = signal('orderCount');
  currentPage = signal(1);
  pageSize = 25;

  filteredCustomers = computed(() => {
    let list = [...this.customers()];
    const query = this.searchQuery().toLowerCase().trim();
    if (query) {
      list = list.filter(
        (c) =>
          (c.customerName || '').toLowerCase().includes(query) ||
          c.customerPhone.includes(query),
      );
    }
    const seg = this.segmentFilter();
    if (seg) list = list.filter((c) => c.segment === seg);
    const opt = this.optInFilter();
    if (opt) list = list.filter((c) => c.broadcastOptIn === opt);

    const sort = this.sortBy();
    list.sort((a, b) => {
      switch (sort) {
        case 'totalSpent':
          return Number(b.totalSpent) - Number(a.totalSpent);
        case 'lastOrderAt':
          return (
            new Date(b.lastOrderAt || 0).getTime() -
            new Date(a.lastOrderAt || 0).getTime()
          );
        case 'name':
          return (a.customerName || 'ZZZ').localeCompare(b.customerName || 'ZZZ');
        default:
          return b.orderCount - a.orderCount;
      }
    });
    return list;
  });

  totalPages = computed(() => Math.ceil(this.filteredCustomers().length / this.pageSize) || 1);

  paginatedCustomers = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize;
    return this.filteredCustomers().slice(start, start + this.pageSize);
  });

  ngOnInit() {
    this.loadStats();
    this.loadCustomers();
  }

  private loadCustomers() {
    this.loading.set(true);
    this.http
      .get<ApiResponse<{ profiles: CustomerProfile[]; total: number }>>(
        `${this.apiUrl}/broadcast/customers?limit=1000`,
        { headers: this.authService.getAuthHeaders() },
      )
      .subscribe({
        next: (res) => {
          if (res.success) this.customers.set(res.data.profiles);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  private loadStats() {
    this.http
      .get<ApiResponse<Stats>>(`${this.apiUrl}/broadcast/stats`, {
        headers: this.authService.getAuthHeaders(),
      })
      .subscribe({
        next: (res) => {
          if (res.success) this.stats.set(res.data);
        },
      });
  }

  syncProfiles() {
    this.syncing.set(true);
    this.http
      .post<ApiResponse<{ created: number; updated: number }>>(
        `${this.apiUrl}/broadcast/customers/sync`,
        {},
        { headers: this.authService.getAuthHeaders() },
      )
      .subscribe({
        next: (res) => {
          this.syncing.set(false);
          if (res.success) {
            this.loadCustomers();
            this.loadStats();
          }
        },
        error: () => this.syncing.set(false),
      });
  }

  selectCustomer(c: CustomerProfile) {
    if (this.selectedCustomer()?.id === c.id) {
      this.selectedCustomer.set(null);
      return;
    }
    this.selectedCustomer.set(c);
    this.loadCustomerDetail(c);
  }

  private loadCustomerDetail(c: CustomerProfile) {
    this.detailLoading.set(true);
    this.customerFavorites.set([]);
    this.customerOrders.set([]);
    this.expandedOrderId.set(null);

    // Load favorites
    this.http
      .get<ApiResponse<FavoriteItem[]>>(
        `${this.apiUrl}/broadcast/customers/${c.id}/favorites`,
        { headers: this.authService.getAuthHeaders() },
      )
      .subscribe({
        next: (res) => {
          if (res.success) this.customerFavorites.set(res.data);
        },
      });

    // Load orders
    this.http
      .get<ApiResponse<CustomerOrder[]>>(
        `${this.apiUrl}/broadcast/customers/${c.id}/orders`,
        { headers: this.authService.getAuthHeaders() },
      )
      .subscribe({
        next: (res) => {
          if (res.success) this.customerOrders.set(res.data);
          this.detailLoading.set(false);
        },
        error: () => this.detailLoading.set(false),
      });
  }

  toggleOrderExpand(orderId: string) {
    this.expandedOrderId.set(this.expandedOrderId() === orderId ? null : orderId);
  }

  onSegmentChange(val: string) {
    this.segmentFilter.set(val);
    this.currentPage.set(1);
  }

  onOptInChange(val: string) {
    this.optInFilter.set(val);
    this.currentPage.set(1);
  }

  // Formatters
  getInitial(c: CustomerProfile): string {
    return (c.customerName || c.customerPhone).charAt(0).toUpperCase();
  }

  formatPhone(phone: string): string {
    if (phone.startsWith('90') && phone.length === 12) {
      return `+${phone.slice(0, 2)} ${phone.slice(2, 5)} ${phone.slice(5, 8)} ${phone.slice(8)}`;
    }
    return phone;
  }

  formatMoney(val: number | string): string {
    return Number(val).toFixed(2) + ' TL';
  }

  formatDate(date: string): string {
    return new Date(date).toLocaleDateString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  segmentLabel(s: string): string {
    switch (s) {
      case 'ACTIVE': return 'Aktif';
      case 'SLEEPING': return 'Uyuyan';
      case 'NEW': return 'Yeni';
      default: return s;
    }
  }

  optInLabel(s: string): string {
    switch (s) {
      case 'OPTED_IN': return 'Izinli';
      case 'OPTED_OUT': return 'Reddetti';
      case 'PENDING': return 'Bekliyor';
      default: return s;
    }
  }

  statusLabel(s: string): string {
    const map: Record<string, string> = {
      DRAFT: 'Taslak',
      PENDING_CONFIRMATION: 'Onay Bekliyor',
      CONFIRMED: 'Onaylandi',
      PREPARING: 'Hazirlaniyor',
      READY: 'Hazir',
      DELIVERED: 'Teslim Edildi',
      CANCELLED: 'Iptal',
    };
    return map[s] || s;
  }
}
