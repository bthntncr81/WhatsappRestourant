import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { OrderService, OrderDto, OrderStatus } from '../../services/order.service';

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="orders-page">
      <header class="page-header">
        <h1>📦 Siparişler</h1>
        <div class="filters">
          <select [(ngModel)]="statusFilter" (change)="loadOrders()">
            <option [ngValue]="null">Tüm Durumlar</option>
            <option value="DRAFT">Taslak</option>
            <option value="PENDING_CONFIRMATION">Onay Bekliyor</option>
            <option value="CONFIRMED">Onaylandı</option>
            <option value="PREPARING">Hazırlanıyor</option>
            <option value="READY">Hazır</option>
            <option value="DELIVERED">Teslim Edildi</option>
            <option value="CANCELLED">İptal</option>
          </select>
          <button class="refresh-btn" (click)="loadOrders()">🔄 Yenile</button>
        </div>
      </header>

      <div class="stats-bar">
        <div class="stat" [class.active]="statusFilter === null" (click)="statusFilter = null; loadOrders()">
          <span class="stat-value">{{ stats().total }}</span>
          <span class="stat-label">Toplam</span>
        </div>
        <div class="stat" [class.active]="statusFilter === 'PENDING_CONFIRMATION'" (click)="statusFilter = 'PENDING_CONFIRMATION'; loadOrders()">
          <span class="stat-value warning">{{ stats().pending }}</span>
          <span class="stat-label">Bekleyen</span>
        </div>
        <div class="stat" [class.active]="statusFilter === 'CONFIRMED'" (click)="statusFilter = 'CONFIRMED'; loadOrders()">
          <span class="stat-value info">{{ stats().confirmed }}</span>
          <span class="stat-label">Onaylı</span>
        </div>
        <div class="stat" [class.active]="statusFilter === 'PREPARING'" (click)="statusFilter = 'PREPARING'; loadOrders()">
          <span class="stat-value">{{ stats().preparing }}</span>
          <span class="stat-label">Hazırlanıyor</span>
        </div>
        <div class="stat" [class.active]="statusFilter === 'READY'" (click)="statusFilter = 'READY'; loadOrders()">
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
            <div class="order-card" [class]="'status-' + order.status.toLowerCase()">
              <div class="order-header">
                <div class="order-number">#{{ order.orderNumber || '---' }}</div>
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
                    <span class="item-name">{{ item.menuItemName }}</span>
                  </div>
                }
                @if (order.items.length > 3) {
                  <div class="more-items">+{{ order.items.length - 3 }} ürün daha</div>
                }
              </div>

              <div class="order-footer">
                <span class="order-total">{{ order.totalPrice | number:'1.2-2' }} TL</span>
                <span class="order-time">{{ formatTime(order.createdAt) }}</span>
              </div>

              <div class="order-actions">
                @if (order.status === 'DRAFT' || order.status === 'PENDING_CONFIRMATION') {
                  <button class="action-btn confirm" (click)="confirmOrder(order)">
                    ✓ Onayla
                  </button>
                }
                @if (order.status === 'CONFIRMED') {
                  <button class="action-btn" (click)="updateStatus(order, 'PREPARING')">
                    🍳 Hazırlanıyor
                  </button>
                }
                @if (order.status === 'PREPARING') {
                  <button class="action-btn success" (click)="updateStatus(order, 'READY')">
                    ✓ Hazır
                  </button>
                }
                @if (order.status === 'READY') {
                  <button class="action-btn success" (click)="updateStatus(order, 'DELIVERED')">
                    🚗 Teslim Edildi
                  </button>
                }
                @if (order.status !== 'CANCELLED' && order.status !== 'DELIVERED') {
                  <button class="action-btn danger" (click)="updateStatus(order, 'CANCELLED')">
                    ✗ İptal
                  </button>
                }
                @if (order.orderNumber) {
                  <button class="action-btn" (click)="reprintKitchen(order)">
                    🍳 Mutfak Fişi
                  </button>
                  <button class="action-btn" (click)="reprintCourier(order)">
                    🛵 Kurye Fişi
                  </button>
                }
              </div>
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
  `]
})
export class OrdersComponent implements OnInit {
  private orderService = inject(OrderService);

  orders = signal<OrderDto[]>([]);
  loading = signal(false);
  statusFilter: OrderStatus | null = null;

  stats = computed(() => {
    const all = this.orders();
    return {
      total: all.length,
      pending: all.filter(o => o.status === 'PENDING_CONFIRMATION').length,
      confirmed: all.filter(o => o.status === 'CONFIRMED').length,
      preparing: all.filter(o => o.status === 'PREPARING').length,
      ready: all.filter(o => o.status === 'READY').length,
    };
  });

  ngOnInit(): void {
    this.loadOrders();
  }

  loadOrders(): void {
    this.loading.set(true);
    const params = this.statusFilter ? { status: this.statusFilter } : undefined;
    
    this.orderService.getOrders(params).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.orders.set(res.data.orders);
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
}


