import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { OrderService, OrderDto, OrderStatus, CustomerDetailDto } from '../../services/order.service';
import { NotificationService } from '../../services/notification.service';

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="orders-page">
      <header class="page-header">
        <h1>📦 Siparişler</h1>
        <div class="filters">
          <select [ngModel]="statusFilter()" (ngModelChange)="statusFilter.set($event)">
            <option [ngValue]="null">Tüm Durumlar</option>
            <option value="DRAFT">Taslak</option>
            <option value="PENDING_CONFIRMATION">Onay Bekliyor</option>
            <option value="CONFIRMED">Onaylandı</option>
            <option value="PREPARING">Hazırlanıyor</option>
            <option value="READY">Hazır</option>
            <option value="DELIVERED">Teslim Edildi</option>
            <option value="CANCELLED">İptal</option>
          </select>
          <button class="sound-toggle-btn" (click)="notificationService.toggleSound()" [title]="notificationService.soundEnabled() ? 'Sesi Kapat' : 'Sesi Aç'">
            {{ notificationService.soundEnabled() ? '🔔' : '🔕' }}
          </button>
          <button class="refresh-btn" (click)="loadOrders()">🔄 Yenile</button>
        </div>
      </header>

      <div class="stats-bar">
        <div class="stat" [class.active]="statusFilter() === null" (click)="statusFilter.set(null)">
          <span class="stat-value">{{ stats().total }}</span>
          <span class="stat-label">Toplam</span>
        </div>
        <div class="stat" [class.active]="statusFilter() === 'PENDING_CONFIRMATION'" [class.pulse]="hasNewPending()" (click)="statusFilter.set('PENDING_CONFIRMATION')">
          <span class="stat-value warning">{{ stats().pending }}</span>
          <span class="stat-label">Bekleyen</span>
        </div>
        <div class="stat" [class.active]="statusFilter() === 'CONFIRMED'" (click)="statusFilter.set('CONFIRMED')">
          <span class="stat-value info">{{ stats().confirmed }}</span>
          <span class="stat-label">Onaylı</span>
        </div>
        <div class="stat" [class.active]="statusFilter() === 'PREPARING'" (click)="statusFilter.set('PREPARING')">
          <span class="stat-value">{{ stats().preparing }}</span>
          <span class="stat-label">Hazırlanıyor</span>
        </div>
        <div class="stat" [class.active]="statusFilter() === 'READY'" (click)="statusFilter.set('READY')">
          <span class="stat-value success">{{ stats().ready }}</span>
          <span class="stat-label">Hazır</span>
        </div>
      </div>

      @if (loading()) {
        <div class="loading">Yükleniyor...</div>
      } @else if (orders().length === 0) {
        <div class="empty-state">
          <span class="empty-icon">📋</span>
          <p>Sipariş bulunamadı</p>
        </div>
      } @else {
        <div class="orders-grid">
          @for (order of orders(); track order.id) {
            <div class="order-card" [class]="'status-' + order.status.toLowerCase()" (click)="openCustomerPanel(order)">
              <div class="order-header">
                <div class="order-number">
                  #{{ order.orderNumber || '---' }}
                  @if (order.parentOrderId) {
                    <span class="addition-badge">+ Ekleme</span>
                  }
                </div>
                <span class="status-badge" [class]="order.status.toLowerCase()">
                  {{ getStatusLabel(order.status) }}
                </span>
              </div>
              
              <div class="order-customer">
                <span class="customer-name">{{ order.customerName || 'Misafir' }}</span>
                <span class="customer-phone">{{ order.customerPhone || '-' }}</span>
                @if (order.storeName) {
                  <span class="store-badge">🏪 {{ order.storeName }}</span>
                }
              </div>

              <div class="order-items">
                @for (item of order.items.slice(0, 3); track item.id) {
                  <div class="item-row">
                    <span class="item-qty">{{ item.qty }}x</span>
                    <span class="item-name">
                      {{ item.menuItemName }}
                      @if (item.optionsJson && item.optionsJson.length > 0) {
                        <span class="item-options">({{ formatOptions(item.optionsJson) }})</span>
                      }
                    </span>
                  </div>
                  @if (item.extrasJson && item.extrasJson.length > 0) {
                    <div class="item-extras">+ {{ formatExtras(item.extrasJson) }}</div>
                  }
                  @if (item.notes) {
                    <div class="item-note">📝 {{ item.notes }}</div>
                  }
                }
                @if (order.items.length > 3) {
                  <div class="more-items">+{{ order.items.length - 3 }} ürün daha</div>
                }
              </div>

              @if (order.notes) {
                <div class="order-note">
                  <span class="order-note-label">Not:</span> {{ order.notes }}
                </div>
              }

              @if (order.rejectionReason) {
                <div class="rejection-reason">
                  <span class="rejection-label">Ret Sebebi:</span>
                  {{ order.rejectionReason }}
                </div>
              }

              <div class="order-footer">
                <span class="order-total">{{ order.totalPrice | number:'1.2-2' }} TL</span>
                <span class="order-time">{{ formatTime(order.createdAt) }}</span>
              </div>

              <div class="order-actions">
                @if (order.status === 'DRAFT' || order.status === 'PENDING_CONFIRMATION') {
                  <button class="action-btn confirm" (click)="$event.stopPropagation(); confirmOrder(order)">
                    ✓ Onayla
                  </button>
                  <button class="action-btn reject" (click)="$event.stopPropagation(); openRejectModal(order)">
                    ✗ Reddet
                  </button>
                }
                @if (order.status === 'CONFIRMED') {
                  <button class="action-btn" (click)="$event.stopPropagation(); updateStatus(order, 'PREPARING')">
                    🍳 Hazırlanıyor
                  </button>
                }
                @if (order.status === 'PREPARING') {
                  <button class="action-btn success" (click)="$event.stopPropagation(); updateStatus(order, 'READY')">
                    ✓ Hazır
                  </button>
                }
                @if (order.status === 'READY') {
                  <button class="action-btn success" (click)="$event.stopPropagation(); updateStatus(order, 'DELIVERED')">
                    🚗 Teslim Edildi
                  </button>
                }
                @if (order.status !== 'CANCELLED' && order.status !== 'DELIVERED') {
                  <button class="action-btn danger" (click)="$event.stopPropagation(); updateStatus(order, 'CANCELLED')">
                    ✗ İptal
                  </button>
                }
                @if (order.orderNumber) {
                  <button class="action-btn" (click)="$event.stopPropagation(); reprintKitchen(order)">
                    🍳 Mutfak Fişi
                  </button>
                  <button class="action-btn" (click)="$event.stopPropagation(); reprintCourier(order)">
                    🛵 Kurye Fişi
                  </button>
                }
              </div>
            </div>
          }
        </div>
      }

      <!-- Reject Modal -->
      @if (showRejectModal()) {
        <div class="modal-overlay" (click)="closeRejectModal()">
          <div class="reject-modal" (click)="$event.stopPropagation()">
            <div class="modal-header">
              <h3>Siparişi Reddet</h3>
              <button class="close-btn" (click)="closeRejectModal()">✕</button>
            </div>
            <div class="modal-body">
              <p class="modal-info">
                Sipariş <strong>#{{ rejectingOrder()?.orderNumber }}</strong> reddedilecek.
                @if (rejectingOrder()?.parentOrderId) {
                  <span class="addition-badge">+ Ekleme</span>
                }
              </p>
              <label class="modal-label">Ret Sebebi:</label>
              <textarea
                class="reject-textarea"
                [(ngModel)]="rejectReason"
                placeholder="Ret sebebini yazın..."
                rows="3"
              ></textarea>
            </div>
            <div class="modal-actions">
              <button class="action-btn" (click)="closeRejectModal()">İptal</button>
              <button
                class="action-btn reject"
                [disabled]="!rejectReason.trim()"
                (click)="submitReject()"
              >
                Reddet
              </button>
            </div>
          </div>
        </div>
      }

      <!-- Customer Detail Panel -->
      @if (showCustomerPanel()) {
        <div class="panel-overlay" (click)="closeCustomerPanel()"></div>
        <div class="customer-panel" (click)="$event.stopPropagation()">
          <div class="panel-header">
            <h3>Musteri Detayi</h3>
            <button class="close-btn" (click)="closeCustomerPanel()">✕</button>
          </div>

          @if (customerDetailLoading()) {
            <div class="panel-loading">Yukleniyor...</div>
          } @else if (customerDetail()) {
            <div class="panel-content">
              <!-- Customer Info -->
              <div class="panel-section">
                <div class="customer-info-header">
                  <span class="customer-avatar">{{ (customerDetail()!.customerName || 'M')[0].toUpperCase() }}</span>
                  <div>
                    <div class="customer-detail-name">{{ customerDetail()!.customerName || 'Misafir' }}</div>
                    <div class="customer-detail-phone">{{ customerDetail()!.customerPhone }}</div>
                    @if (customerDetail()!.firstOrderDate) {
                      <div class="customer-since">Ilk siparis: {{ formatDate(customerDetail()!.firstOrderDate!) }}</div>
                    }
                  </div>
                </div>
              </div>

              <!-- Stats -->
              <div class="panel-section">
                <h4 class="section-title">Istatistikler</h4>
                <div class="stats-grid-panel">
                  <div class="stat-card-panel">
                    <span class="stat-card-value">{{ customerDetail()!.stats.totalOrders }}</span>
                    <span class="stat-card-label-panel">Siparis</span>
                  </div>
                  <div class="stat-card-panel">
                    <span class="stat-card-value">{{ customerDetail()!.stats.totalSpent | number:'1.0-0' }} TL</span>
                    <span class="stat-card-label-panel">Toplam</span>
                  </div>
                  <div class="stat-card-panel">
                    <span class="stat-card-value">{{ customerDetail()!.stats.averageOrderValue | number:'1.0-0' }} TL</span>
                    <span class="stat-card-label-panel">Ortalama</span>
                  </div>
                  <div class="stat-card-panel">
                    <span class="stat-card-value">{{ customerDetail()!.stats.cancelledOrders }}</span>
                    <span class="stat-card-label-panel">Iptal</span>
                  </div>
                </div>
              </div>

              <!-- Current Order Address -->
              @if (selectedOrder()?.deliveryAddress) {
                <div class="panel-section">
                  <h4 class="section-title">Teslimat Adresi (Bu Siparis)</h4>
                  <div class="address-card current">
                    <span class="address-icon">📍</span>
                    <span>{{ selectedOrder()!.deliveryAddress }}</span>
                  </div>
                </div>
              }

              <!-- Favorite Items -->
              @if (customerDetail()!.favoriteItems.length > 0) {
                <div class="panel-section">
                  <h4 class="section-title">En Cok Siparis Edilen</h4>
                  @for (item of customerDetail()!.favoriteItems; track item.menuItemName) {
                    <div class="favorite-item">
                      <span class="favorite-name">{{ item.menuItemName }}</span>
                      <span class="favorite-count">{{ item.totalQty }}x ({{ item.orderCount }} siparis)</span>
                    </div>
                  }
                </div>
              }

              <!-- Saved Addresses -->
              @if (customerDetail()!.savedAddresses.length > 0) {
                <div class="panel-section">
                  <h4 class="section-title">Kayitli Adresler</h4>
                  @for (addr of customerDetail()!.savedAddresses; track addr.id) {
                    <div class="address-card">
                      <div class="address-name-panel">{{ addr.name }}</div>
                      <div class="address-text">{{ addr.address }}</div>
                    </div>
                  }
                </div>
              }

              <!-- Order History -->
              @if (customerDetail()!.recentOrders.length > 0) {
                <div class="panel-section">
                  <h4 class="section-title">Siparis Gecmisi</h4>
                  @for (histOrder of customerDetail()!.recentOrders; track histOrder.id) {
                    <div class="history-order">
                      <div class="history-header">
                        <span class="history-number">#{{ histOrder.orderNumber || '---' }}</span>
                        <span class="status-badge small" [class]="histOrder.status.toLowerCase()">
                          {{ getStatusLabel(histOrder.status) }}
                        </span>
                      </div>
                      <div class="history-items">
                        @for (hItem of histOrder.items.slice(0, 3); track hItem.menuItemName) {
                          <span class="history-item">{{ hItem.qty }}x {{ hItem.menuItemName }}</span>
                        }
                        @if (histOrder.items.length > 3) {
                          <span class="history-item more">+{{ histOrder.items.length - 3 }} urun daha</span>
                        }
                      </div>
                      <div class="history-footer">
                        <span class="history-total">{{ histOrder.totalPrice | number:'1.2-2' }} TL</span>
                        <span class="history-date">{{ formatDate(histOrder.createdAt) }}</span>
                      </div>
                    </div>
                  }
                </div>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
    }

    .orders-page {
      padding: 24px;
      max-width: 1400px;
      margin: 0 auto;
    }

    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
    }

    .page-header h1 {
      font-size: 1.75rem;
      font-weight: 600;
      color: var(--text-primary, #fff);
    }

    .filters {
      display: flex;
      gap: 12px;
      align-items: center;
    }

    .filters select {
      padding: 8px 16px;
      border-radius: 8px;
      border: 1px solid var(--border-color, #333);
      background: var(--bg-secondary, #1a1a2e);
      color: var(--text-primary, #fff);
      font-size: 0.9rem;
      cursor: pointer;
    }

    .refresh-btn {
      padding: 8px 16px;
      border-radius: 8px;
      border: none;
      background: var(--accent-primary, #6366f1);
      color: white;
      font-size: 0.9rem;
      cursor: pointer;
      transition: all 0.2s;
    }

    .refresh-btn:hover {
      background: var(--accent-primary-dark, #5558e3);
    }

    .sound-toggle-btn {
      padding: 8px 12px;
      border-radius: 8px;
      border: 1px solid var(--border-color, #333);
      background: var(--bg-secondary, #1a1a2e);
      color: var(--text-primary, #fff);
      font-size: 1rem;
      cursor: pointer;
      transition: all 0.2s;
    }

    .sound-toggle-btn:hover {
      border-color: var(--accent-primary, #6366f1);
    }

    .stat.pulse {
      animation: pulse-glow 1.5s ease-in-out infinite;
    }

    @keyframes pulse-glow {
      0%, 100% { background: transparent; }
      50% { background: rgba(245, 158, 11, 0.15); }
    }

    .stats-bar {
      display: flex;
      gap: 16px;
      margin-bottom: 24px;
      padding: 16px;
      background: var(--bg-secondary, #1a1a2e);
      border-radius: 12px;
      border: 1px solid var(--border-color, #333);
    }

    .stat {
      flex: 1;
      text-align: center;
      padding: 12px;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .stat:hover, .stat.active {
      background: var(--bg-tertiary, #252542);
    }

    .stat-value {
      display: block;
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--text-primary, #fff);
    }

    .stat-value.warning { color: #f59e0b; }
    .stat-value.info { color: #3b82f6; }
    .stat-value.success { color: #10b981; }

    .stat-label {
      font-size: 0.8rem;
      color: var(--text-secondary, #888);
    }

    .loading, .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 64px;
      color: var(--text-secondary, #888);
    }

    .empty-icon {
      font-size: 4rem;
      margin-bottom: 16px;
    }

    .orders-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 16px;
    }

    .order-card {
      background: var(--bg-secondary, #1a1a2e);
      border-radius: 12px;
      border: 1px solid var(--border-color, #333);
      padding: 16px;
      transition: all 0.2s;
    }

    .order-card:hover {
      border-color: var(--accent-primary, #6366f1);
    }

    .order-card.status-pending_confirmation {
      border-left: 4px solid #f59e0b;
    }

    .order-card.status-confirmed {
      border-left: 4px solid #3b82f6;
    }

    .order-card.status-preparing {
      border-left: 4px solid #8b5cf6;
    }

    .order-card.status-ready {
      border-left: 4px solid #10b981;
    }

    .order-card.status-cancelled {
      border-left: 4px solid #ef4444;
      opacity: 0.7;
    }

    .order-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .order-number {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--text-primary, #fff);
    }

    .status-badge {
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }

    .status-badge.draft { background: #374151; color: #9ca3af; }
    .status-badge.pending_confirmation { background: #fef3c7; color: #92400e; }
    .status-badge.confirmed { background: #dbeafe; color: #1e40af; }
    .status-badge.preparing { background: #ede9fe; color: #5b21b6; }
    .status-badge.ready { background: #d1fae5; color: #065f46; }
    .status-badge.delivered { background: #f0fdf4; color: #166534; }
    .status-badge.cancelled { background: #fee2e2; color: #991b1b; }

    .order-customer {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 12px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border-color, #333);
    }

    .customer-name {
      font-weight: 600;
      color: var(--text-primary, #fff);
    }

    .customer-phone {
      font-size: 0.85rem;
      color: var(--text-secondary, #888);
    }

    .store-badge {
      display: inline-block;
      margin-top: 4px;
      padding: 2px 8px;
      background: var(--accent-primary, #6366f1);
      color: white;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 500;
    }

    .order-items {
      margin-bottom: 12px;
    }

    .item-row {
      display: flex;
      gap: 8px;
      padding: 4px 0;
      font-size: 0.9rem;
    }

    .item-qty {
      font-weight: 600;
      color: var(--accent-primary, #6366f1);
      min-width: 32px;
    }

    .item-name {
      color: var(--text-primary, #fff);
    }

    .more-items {
      font-size: 0.85rem;
      color: var(--text-secondary, #888);
      font-style: italic;
      padding-top: 4px;
    }

    .item-options {
      font-size: 0.8rem;
      color: var(--text-secondary, #888);
      font-weight: 400;
    }

    .item-extras {
      font-size: 0.8rem;
      color: #a78bfa;
      padding-left: 40px;
    }

    .item-note {
      font-size: 0.8rem;
      color: #fbbf24;
      padding-left: 40px;
      font-style: italic;
    }

    .order-note {
      padding: 8px 12px;
      margin-bottom: 12px;
      background: rgba(251, 191, 36, 0.1);
      border-radius: 6px;
      border-left: 3px solid #fbbf24;
      font-size: 0.85rem;
      color: #fde68a;
    }

    .order-note-label {
      font-weight: 600;
      color: #fbbf24;
    }

    .order-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 12px;
      border-top: 1px solid var(--border-color, #333);
      margin-bottom: 12px;
    }

    .order-total {
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--accent-secondary, #10b981);
    }

    .order-time {
      font-size: 0.8rem;
      color: var(--text-secondary, #888);
    }

    .order-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .action-btn {
      flex: 1;
      min-width: calc(50% - 4px);
      padding: 8px 12px;
      border-radius: 6px;
      border: none;
      font-size: 0.8rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      background: var(--bg-tertiary, #252542);
      color: var(--text-primary, #fff);
    }

    .action-btn:hover {
      background: var(--bg-hover, #2f2f4f);
    }

    .action-btn.confirm {
      background: var(--accent-primary, #6366f1);
      color: white;
    }

    .action-btn.confirm:hover {
      background: var(--accent-primary-dark, #5558e3);
    }

    .action-btn.success {
      background: #10b981;
      color: white;
    }

    .action-btn.success:hover {
      background: #059669;
    }

    .action-btn.danger {
      background: transparent;
      border: 1px solid #ef4444;
      color: #ef4444;
    }

    .action-btn.danger:hover {
      background: #ef4444;
      color: white;
    }

    .action-btn.reject {
      background: transparent;
      border: 1px solid #f59e0b;
      color: #f59e0b;
    }

    .action-btn.reject:hover {
      background: #f59e0b;
      color: white;
    }

    .action-btn.reject:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .addition-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.7rem;
      font-weight: 600;
      background: #8b5cf6;
      color: white;
      margin-left: 8px;
      vertical-align: middle;
    }

    .rejection-reason {
      padding: 8px 12px;
      margin-bottom: 12px;
      background: rgba(239, 68, 68, 0.1);
      border-radius: 6px;
      border-left: 3px solid #ef4444;
      font-size: 0.85rem;
      color: #fca5a5;
    }

    .rejection-label {
      font-weight: 600;
      color: #ef4444;
      margin-right: 4px;
    }

    /* Reject Modal */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 24px;
    }

    .reject-modal {
      background: var(--bg-secondary, #1a1a2e);
      border: 1px solid var(--border-color, #333);
      border-radius: 12px;
      width: 100%;
      max-width: 440px;
      overflow: hidden;
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid var(--border-color, #333);
    }

    .modal-header h3 {
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--text-primary, #fff);
    }

    .close-btn {
      background: transparent;
      border: none;
      color: var(--text-secondary, #888);
      font-size: 1.2rem;
      cursor: pointer;
      padding: 4px;
    }

    .modal-body {
      padding: 20px;
    }

    .modal-info {
      margin-bottom: 16px;
      color: var(--text-secondary, #888);
      font-size: 0.9rem;
    }

    .modal-label {
      display: block;
      margin-bottom: 8px;
      font-weight: 500;
      font-size: 0.9rem;
      color: var(--text-primary, #fff);
    }

    .reject-textarea {
      width: 100%;
      padding: 12px;
      border-radius: 8px;
      border: 1px solid var(--border-color, #333);
      background: var(--bg-tertiary, #252542);
      color: var(--text-primary, #fff);
      font-size: 0.9rem;
      resize: vertical;
      min-height: 80px;
      font-family: inherit;
    }

    .reject-textarea:focus {
      outline: none;
      border-color: #f59e0b;
    }

    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      padding: 16px 20px;
      border-top: 1px solid var(--border-color, #333);
    }

    /* Customer Detail Panel */
    .order-card { cursor: pointer; }

    .panel-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 999;
    }

    .customer-panel {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      width: 420px;
      max-width: 90vw;
      background: var(--bg-primary, #0f0f23);
      border-left: 1px solid var(--border-color, #333);
      z-index: 1000;
      display: flex;
      flex-direction: column;
      animation: slideIn 0.25s ease-out;
    }

    @keyframes slideIn {
      from { transform: translateX(100%); }
      to { transform: translateX(0); }
    }

    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid var(--border-color, #333);
      flex-shrink: 0;
    }

    .panel-header h3 {
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--text-primary, #fff);
    }

    .panel-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 48px;
      color: var(--text-secondary, #888);
    }

    .panel-content {
      flex: 1;
      overflow-y: auto;
      padding: 16px 20px;
    }

    .panel-section {
      margin-bottom: 24px;
    }

    .section-title {
      font-size: 0.85rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary, #888);
      margin-bottom: 12px;
    }

    .customer-info-header {
      display: flex;
      gap: 12px;
      align-items: center;
    }

    .customer-avatar {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: var(--accent-primary, #6366f1);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.2rem;
      font-weight: 700;
      flex-shrink: 0;
    }

    .customer-detail-name {
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--text-primary, #fff);
    }

    .customer-detail-phone {
      font-size: 0.9rem;
      color: var(--text-secondary, #888);
      font-family: var(--font-mono);
    }

    .customer-since {
      font-size: 0.8rem;
      color: var(--text-secondary, #888);
      margin-top: 4px;
    }

    .stats-grid-panel {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
    }

    .stat-card-panel {
      background: var(--bg-secondary, #1a1a2e);
      border: 1px solid var(--border-color, #333);
      border-radius: 8px;
      padding: 12px;
      text-align: center;
    }

    .stat-card-value {
      display: block;
      font-size: 1.2rem;
      font-weight: 700;
      color: var(--text-primary, #fff);
    }

    .stat-card-label-panel {
      font-size: 0.75rem;
      color: var(--text-secondary, #888);
    }

    .favorite-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      background: var(--bg-secondary, #1a1a2e);
      border-radius: 6px;
      margin-bottom: 6px;
    }

    .favorite-name {
      font-size: 0.9rem;
      color: var(--text-primary, #fff);
      font-weight: 500;
    }

    .favorite-count {
      font-size: 0.8rem;
      color: var(--accent-primary, #6366f1);
      font-weight: 600;
    }

    .address-card {
      padding: 10px 12px;
      background: var(--bg-secondary, #1a1a2e);
      border-radius: 6px;
      margin-bottom: 6px;
      font-size: 0.85rem;
      color: var(--text-primary, #fff);
    }

    .address-card.current {
      border: 1px solid var(--accent-primary, #6366f1);
      display: flex;
      gap: 8px;
      align-items: flex-start;
    }

    .address-name-panel {
      font-weight: 600;
      font-size: 0.85rem;
      margin-bottom: 2px;
    }

    .address-text {
      font-size: 0.8rem;
      color: var(--text-secondary, #888);
    }

    .history-order {
      padding: 12px;
      background: var(--bg-secondary, #1a1a2e);
      border-radius: 8px;
      margin-bottom: 8px;
      border: 1px solid var(--border-color, #333);
    }

    .history-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }

    .history-number {
      font-weight: 700;
      color: var(--text-primary, #fff);
    }

    .status-badge.small {
      font-size: 0.65rem;
      padding: 2px 8px;
    }

    .history-items {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 8px;
      margin-bottom: 8px;
    }

    .history-item {
      font-size: 0.8rem;
      color: var(--text-secondary, #888);
    }

    .history-item.more {
      font-style: italic;
    }

    .history-footer {
      display: flex;
      justify-content: space-between;
      font-size: 0.8rem;
    }

    .history-total {
      font-weight: 600;
      color: var(--accent-secondary, #10b981);
    }

    .history-date {
      color: var(--text-secondary, #888);
    }
  `]
})
export class OrdersComponent implements OnInit, OnDestroy {
  private orderService = inject(OrderService);
  notificationService = inject(NotificationService);

  private allOrders = signal<OrderDto[]>([]);
  loading = signal(false);
  statusFilter = signal<OrderStatus | null>(null);
  hasNewPending = signal(false);

  orders = computed(() => {
    const all = this.allOrders();
    const filter = this.statusFilter();
    if (!filter) return all;
    return all.filter(o => o.status === filter);
  });

  // Reject modal state
  showRejectModal = signal(false);
  rejectingOrder = signal<OrderDto | null>(null);
  rejectReason = '';

  // Customer detail panel state
  showCustomerPanel = signal(false);
  customerDetail = signal<CustomerDetailDto | null>(null);
  customerDetailLoading = signal(false);
  selectedOrder = signal<OrderDto | null>(null);

  stats = computed(() => {
    const all = this.allOrders();
    return {
      total: all.length,
      pending: all.filter(o => o.status === 'PENDING_CONFIRMATION').length,
      confirmed: all.filter(o => o.status === 'CONFIRMED').length,
      preparing: all.filter(o => o.status === 'PREPARING').length,
      ready: all.filter(o => o.status === 'READY').length,
    };
  });

  // Polling
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private knownOrderIds = new Set<string>();

  ngOnInit(): void {
    this.loadOrders();
    this.startPolling();
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  private startPolling(): void {
    this.pollInterval = setInterval(() => {
      this.pollOrders();
    }, 5000);
  }

  private stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private pollOrders(): void {
    this.orderService.getOrders().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          const fetched = res.data.orders;
          this.detectNewOrders(fetched);
          this.allOrders.set(fetched);
        }
      },
    });
  }

  private detectNewOrders(fetched: OrderDto[]): void {
    if (this.knownOrderIds.size === 0) return;

    const newPending = fetched.filter(
      o => o.status === 'PENDING_CONFIRMATION' && !this.knownOrderIds.has(o.id)
    );

    if (newPending.length > 0) {
      this.hasNewPending.set(true);
      this.notificationService.playOrderNotification();
      setTimeout(() => this.hasNewPending.set(false), 5000);
    }

    this.knownOrderIds = new Set(fetched.map(o => o.id));
  }

  loadOrders(): void {
    this.loading.set(true);

    this.orderService.getOrders().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          const fetched = res.data.orders;
          this.allOrders.set(fetched);
          this.knownOrderIds = new Set(fetched.map(o => o.id));
        }
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  getStatusLabel(status: OrderStatus): string {
    const labels: Record<OrderStatus, string> = {
      DRAFT: 'Taslak',
      PENDING_CONFIRMATION: 'Bekliyor',
      CONFIRMED: 'Onaylandı',
      PREPARING: 'Hazırlanıyor',
      READY: 'Hazır',
      DELIVERED: 'Teslim',
      CANCELLED: 'İptal',
    };
    return labels[status];
  }

  formatTime(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  }

  confirmOrder(order: OrderDto): void {
    this.orderService.confirmOrder(order.id).subscribe({
      next: () => this.loadOrders(),
      error: (err) => console.error('Confirm failed:', err),
    });
  }

  updateStatus(order: OrderDto, status: OrderStatus): void {
    this.orderService.updateOrderStatus(order.id, status).subscribe({
      next: () => this.loadOrders(),
      error: (err) => console.error('Update failed:', err),
    });
  }

  openRejectModal(order: OrderDto): void {
    this.rejectingOrder.set(order);
    this.rejectReason = '';
    this.showRejectModal.set(true);
  }

  closeRejectModal(): void {
    this.showRejectModal.set(false);
    this.rejectingOrder.set(null);
    this.rejectReason = '';
  }

  submitReject(): void {
    const order = this.rejectingOrder();
    if (!order || !this.rejectReason.trim()) return;

    this.orderService.rejectOrder(order.id, this.rejectReason.trim()).subscribe({
      next: () => {
        this.closeRejectModal();
        this.loadOrders();
      },
      error: (err) => {
        console.error('Reject failed:', err);
        alert(err.error?.error?.message || 'Ret işlemi başarısız oldu');
      },
    });
  }

  openCustomerPanel(order: OrderDto): void {
    if (!order.customerPhone) return;

    this.selectedOrder.set(order);
    this.showCustomerPanel.set(true);
    this.customerDetailLoading.set(true);
    this.customerDetail.set(null);

    this.orderService.getCustomerDetails(order.customerPhone).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.customerDetail.set(res.data);
        }
        this.customerDetailLoading.set(false);
      },
      error: () => this.customerDetailLoading.set(false),
    });
  }

  closeCustomerPanel(): void {
    this.showCustomerPanel.set(false);
    this.selectedOrder.set(null);
    this.customerDetail.set(null);
  }

  formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  reprintKitchen(order: OrderDto): void {
    this.orderService.reprintOrder(order.id, 'KITCHEN').subscribe({
      next: () => alert('Mutfak fişi yazdırma kuyruğuna eklendi'),
      error: (err) => console.error('Reprint failed:', err),
    });
  }

  reprintCourier(order: OrderDto): void {
    this.orderService.reprintOrder(order.id, 'COURIER').subscribe({
      next: () => alert('Kurye fişi yazdırma kuyruğuna eklendi'),
      error: (err) => console.error('Reprint failed:', err),
    });
  }

  formatOptions(options: { groupName: string; optionName: string; priceDelta: number }[]): string {
    return options.map(o => o.optionName).join(', ');
  }

  formatExtras(extras: { name: string; qty: number; price: number }[]): string {
    return extras.map(e => e.qty > 1 ? `${e.qty}x ${e.name}` : e.name).join(', ');
  }
}


