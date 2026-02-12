import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OrderService, PrintJobDto, PrintJobStatus } from '../../services/order.service';

@Component({
  selector: 'app-print-jobs',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="print-jobs-page">
      <header class="page-header">
        <h1>🖨️ Yazdırma Kuyrukları</h1>
        <div class="filters">
          <select [(ngModel)]="statusFilter" (change)="loadJobs()">
            <option [ngValue]="null">Tüm Durumlar</option>
            <option value="PENDING">Bekliyor</option>
            <option value="PROCESSING">İşleniyor</option>
            <option value="DONE">Tamamlandı</option>
            <option value="FAILED">Başarısız</option>
          </select>
          <button class="refresh-btn" (click)="loadJobs()">🔄 Yenile</button>
        </div>
      </header>

      <div class="stats-bar">
        <div class="stat" [class.active]="statusFilter === 'PENDING'" (click)="statusFilter = 'PENDING'; loadJobs()">
          <span class="stat-value warning">{{ countByStatus('PENDING') }}</span>
          <span class="stat-label">Bekliyor</span>
        </div>
        <div class="stat" [class.active]="statusFilter === 'PROCESSING'" (click)="statusFilter = 'PROCESSING'; loadJobs()">
          <span class="stat-value info">{{ countByStatus('PROCESSING') }}</span>
          <span class="stat-label">İşleniyor</span>
        </div>
        <div class="stat" [class.active]="statusFilter === 'DONE'" (click)="statusFilter = 'DONE'; loadJobs()">
          <span class="stat-value success">{{ countByStatus('DONE') }}</span>
          <span class="stat-label">Tamamlandı</span>
        </div>
        <div class="stat" [class.active]="statusFilter === 'FAILED'" (click)="statusFilter = 'FAILED'; loadJobs()">
          <span class="stat-value danger">{{ countByStatus('FAILED') }}</span>
          <span class="stat-label">Başarısız</span>
        </div>
      </div>

      @if (loading()) {
        <div class="loading">Yükleniyor...</div>
      } @else if (jobs().length === 0) {
        <div class="empty-state">
          <span class="empty-icon">🖨️</span>
          <p>Yazdırma işi bulunamadı</p>
        </div>
      } @else {
        <div class="jobs-table-container">
          <table class="jobs-table">
            <thead>
              <tr>
                <th>Tip</th>
                <th>Sipariş No</th>
                <th>Durum</th>
                <th>Oluşturulma</th>
                <th>İşlenme</th>
                <th>Deneme</th>
                <th>Hata</th>
                <th>İşlemler</th>
              </tr>
            </thead>
            <tbody>
              @for (job of jobs(); track job.id) {
                <tr [class]="'status-' + job.status.toLowerCase()">
                  <td>
                    <span class="type-badge" [class]="job.type.toLowerCase()">
                      {{ job.type === 'KITCHEN' ? '🍳 Mutfak' : '🛵 Kurye' }}
                    </span>
                  </td>
                  <td class="order-number">#{{ job.payloadJson.orderNumber }}</td>
                  <td>
                    <span class="status-badge" [class]="job.status.toLowerCase()">
                      {{ getStatusLabel(job.status) }}
                    </span>
                  </td>
                  <td class="time">{{ formatTime(job.createdAt) }}</td>
                  <td class="time">{{ job.processedAt ? formatTime(job.processedAt) : '-' }}</td>
                  <td class="retry-count">{{ job.retryCount }}</td>
                  <td class="error-cell">
                    @if (job.errorMessage) {
                      <span class="error-message" [title]="job.errorMessage">
                        {{ truncateError(job.errorMessage) }}
                      </span>
                    } @else {
                      <span class="no-error">-</span>
                    }
                  </td>
                  <td class="actions">
                    <div class="action-buttons">
                      <button class="action-btn view" (click)="viewJob(job)" title="Görüntüle">
                        👁️
                      </button>
                      @if (job.status === 'PENDING' || job.status === 'PROCESSING') {
                        <button class="action-btn stop" (click)="cancelJob(job)" title="Durdur">
                          ⏹️
                        </button>
                      }
                      @if (job.status === 'FAILED') {
                        <button class="action-btn retry" (click)="retryJob(job)" title="Tekrar Dene">
                          🔄
                        </button>
                      }
                      <button class="action-btn delete" (click)="deleteJob(job)" title="Sil">
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      <div class="info-box">
        <h3>ℹ️ Print Bridge Servisi</h3>
        <p>
          Yazdırma işlemleri <code>print-bridge</code> servisi tarafından yürütülür.
          Bu servis şubede çalışan bir bilgisayarda kurulu olmalı ve API'ye bağlı olmalıdır.
        </p>
        <pre>cd apps/print-bridge
pnpm install
cp .env.example .env  # API_URL, TENANT_ID, API_TOKEN ayarla
pnpm dev</pre>
      </div>

      <!-- View Job Modal -->
      @if (viewingJob()) {
        <div class="modal-overlay" (click)="closeModal()">
          <div class="modal-content" (click)="$event.stopPropagation()">
            <div class="modal-header">
              <h2>📄 Yazdırma İşi Detayı</h2>
              <button class="close-btn" (click)="closeModal()">✕</button>
            </div>
            <div class="modal-body">
              <div class="detail-grid">
                <div class="detail-item">
                  <label>Tip:</label>
                  <span>{{ viewingJob()!.type === 'KITCHEN' ? '🍳 Mutfak' : '🛵 Kurye' }}</span>
                </div>
                <div class="detail-item">
                  <label>Sipariş No:</label>
                  <span>#{{ viewingJob()!.payloadJson.orderNumber }}</span>
                </div>
                <div class="detail-item">
                  <label>Durum:</label>
                  <span class="status-badge" [class]="viewingJob()!.status.toLowerCase()">
                    {{ getStatusLabel(viewingJob()!.status) }}
                  </span>
                </div>
                <div class="detail-item">
                  <label>Oluşturulma:</label>
                  <span>{{ formatTime(viewingJob()!.createdAt) }}</span>
                </div>
                <div class="detail-item">
                  <label>İşlenme:</label>
                  <span>{{ viewingJob()!.processedAt ? formatTime(viewingJob()!.processedAt!) : '-' }}</span>
                </div>
                <div class="detail-item">
                  <label>Deneme Sayısı:</label>
                  <span>{{ viewingJob()!.retryCount }}</span>
                </div>
              </div>
              
              @if (viewingJob()!.errorMessage) {
                <div class="error-box">
                  <h4>❌ Hata Mesajı:</h4>
                  <pre>{{ viewingJob()!.errorMessage }}</pre>
                </div>
              }

              <div class="payload-section">
                <h4>📋 İçerik (Payload):</h4>
                <div class="order-details">
                  <p><strong>Müşteri:</strong> {{ viewingJob()!.payloadJson.customerName || 'Belirtilmemiş' }}</p>
                  <p><strong>Telefon:</strong> {{ viewingJob()!.payloadJson.customerPhone }}</p>
                  @if (viewingJob()!.payloadJson.deliveryAddress) {
                    <p><strong>Adres:</strong> {{ viewingJob()!.payloadJson.deliveryAddress }}</p>
                  }
                  <p><strong>Tarih:</strong> {{ viewingJob()!.payloadJson.timestamp }}</p>
                  
                  <h5>🛒 Ürünler:</h5>
                  <table class="items-table">
                    <thead>
                      <tr>
                        <th>Ürün</th>
                        <th>Adet</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (item of viewingJob()!.payloadJson.items; track $index) {
                        <tr>
                          <td>
                            {{ item.name }}
                            @if (item.options && item.options.length > 0) {
                              <div class="item-options">
                                @for (opt of item.options; track $index) {
                                  <span class="option-tag">{{ opt }}</span>
                                }
                              </div>
                            }
                            @if (item.notes) {
                              <div class="item-note">📝 {{ item.notes }}</div>
                            }
                          </td>
                          <td>{{ item.qty }}</td>
                        </tr>
                      }
                    </tbody>
                    @if (viewingJob()!.payloadJson.totalPrice) {
                      <tfoot>
                        <tr>
                          <td><strong>Toplam:</strong></td>
                          <td><strong>{{ viewingJob()!.payloadJson.totalPrice | currency:'₺' }}</strong></td>
                        </tr>
                      </tfoot>
                    }
                  </table>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              @if (viewingJob()!.status === 'FAILED') {
                <button class="btn btn-primary" (click)="retryJob(viewingJob()!); closeModal()">
                  🔄 Tekrar Dene
                </button>
              }
              <button class="btn btn-secondary" (click)="closeModal()">Kapat</button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
    }

    .print-jobs-page {
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
    .stat-value.danger { color: #ef4444; }

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

    .jobs-table-container {
      background: var(--bg-secondary, #1a1a2e);
      border-radius: 12px;
      border: 1px solid var(--border-color, #333);
      overflow: hidden;
    }

    .jobs-table {
      width: 100%;
      border-collapse: collapse;
    }

    .jobs-table th {
      text-align: left;
      padding: 12px 16px;
      background: var(--bg-tertiary, #252542);
      color: var(--text-secondary, #888);
      font-weight: 600;
      font-size: 0.85rem;
      text-transform: uppercase;
    }

    .jobs-table td {
      padding: 12px 16px;
      border-top: 1px solid var(--border-color, #333);
      color: var(--text-primary, #fff);
    }

    .jobs-table tr:hover {
      background: var(--bg-tertiary, #252542);
    }

    .jobs-table tr.status-failed {
      background: rgba(239, 68, 68, 0.1);
    }

    .type-badge {
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 0.8rem;
      font-weight: 500;
    }

    .type-badge.kitchen {
      background: #fef3c7;
      color: #92400e;
    }

    .type-badge.courier {
      background: #dbeafe;
      color: #1e40af;
    }

    .order-number {
      font-weight: 600;
      font-family: monospace;
    }

    .status-badge {
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: 600;
    }

    .status-badge.pending { background: #fef3c7; color: #92400e; }
    .status-badge.processing { background: #dbeafe; color: #1e40af; }
    .status-badge.done { background: #d1fae5; color: #065f46; }
    .status-badge.failed { background: #fee2e2; color: #991b1b; }

    .time {
      font-size: 0.85rem;
      color: var(--text-secondary, #888);
      font-family: monospace;
    }

    .retry-count {
      text-align: center;
    }

    .error-cell {
      max-width: 200px;
    }

    .error-message {
      color: #ef4444;
      font-size: 0.8rem;
      cursor: help;
    }

    .no-error {
      color: var(--text-secondary, #888);
    }

    .actions {
      min-width: 120px;
    }

    .action-buttons {
      display: flex;
      gap: 6px;
      justify-content: flex-end;
    }

    .action-btn {
      width: 32px;
      height: 32px;
      border-radius: 6px;
      border: 1px solid var(--border-color, #333);
      background: var(--bg-tertiary, #252542);
      color: white;
      font-size: 0.85rem;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .action-btn:hover {
      transform: scale(1.1);
    }

    .action-btn.view:hover {
      background: #3b82f6;
      border-color: #3b82f6;
    }

    .action-btn.stop:hover {
      background: #f59e0b;
      border-color: #f59e0b;
    }

    .action-btn.retry:hover {
      background: #6366f1;
      border-color: #6366f1;
    }

    .action-btn.delete:hover {
      background: #ef4444;
      border-color: #ef4444;
    }

    .info-box {
      margin-top: 24px;
      padding: 20px;
      background: var(--bg-secondary, #1a1a2e);
      border-radius: 12px;
      border: 1px solid var(--border-color, #333);
    }

    .info-box h3 {
      margin-bottom: 12px;
      color: var(--text-primary, #fff);
    }

    .info-box p {
      color: var(--text-secondary, #888);
      margin-bottom: 16px;
    }

    .info-box code {
      background: var(--bg-tertiary, #252542);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: monospace;
    }

    .info-box pre {
      background: var(--bg-tertiary, #252542);
      padding: 16px;
      border-radius: 8px;
      font-family: monospace;
      font-size: 0.85rem;
      overflow-x: auto;
      color: var(--text-primary, #fff);
    }

    /* Modal Styles */
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      backdrop-filter: blur(4px);
    }

    .modal-content {
      background: var(--bg-secondary, #1a1a2e);
      border-radius: 16px;
      border: 1px solid var(--border-color, #333);
      width: 90%;
      max-width: 700px;
      max-height: 85vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      animation: modalSlide 0.3s ease;
    }

    @keyframes modalSlide {
      from {
        opacity: 0;
        transform: translateY(-20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px 24px;
      border-bottom: 1px solid var(--border-color, #333);
    }

    .modal-header h2 {
      margin: 0;
      font-size: 1.25rem;
      color: var(--text-primary, #fff);
    }

    .close-btn {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: none;
      background: var(--bg-tertiary, #252542);
      color: var(--text-primary, #fff);
      font-size: 1.2rem;
      cursor: pointer;
      transition: all 0.2s;
    }

    .close-btn:hover {
      background: #ef4444;
    }

    .modal-body {
      padding: 24px;
      overflow-y: auto;
      flex: 1;
    }

    .detail-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-bottom: 24px;
    }

    .detail-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .detail-item label {
      font-size: 0.8rem;
      color: var(--text-secondary, #888);
    }

    .detail-item span {
      font-size: 0.95rem;
      color: var(--text-primary, #fff);
    }

    .error-box {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid #ef4444;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 24px;
    }

    .error-box h4 {
      margin: 0 0 8px;
      color: #ef4444;
      font-size: 0.9rem;
    }

    .error-box pre {
      margin: 0;
      font-family: monospace;
      font-size: 0.85rem;
      color: #fca5a5;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .payload-section {
      background: var(--bg-tertiary, #252542);
      border-radius: 12px;
      padding: 20px;
    }

    .payload-section h4 {
      margin: 0 0 16px;
      color: var(--text-primary, #fff);
    }

    .order-details p {
      margin: 0 0 8px;
      font-size: 0.9rem;
      color: var(--text-secondary, #888);
    }

    .order-details p strong {
      color: var(--text-primary, #fff);
    }

    .order-details h5 {
      margin: 16px 0 8px;
      color: var(--text-primary, #fff);
      font-size: 0.95rem;
    }

    .items-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }

    .items-table th {
      text-align: left;
      padding: 8px;
      border-bottom: 1px solid var(--border-color, #333);
      color: var(--text-secondary, #888);
    }

    .items-table td {
      padding: 8px;
      border-bottom: 1px solid var(--border-color, #333);
      color: var(--text-primary, #fff);
    }

    .items-table tfoot td {
      border-bottom: none;
      border-top: 2px solid var(--border-color, #333);
    }

    .item-options {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 4px;
    }

    .option-tag {
      background: var(--accent-primary, #6366f1);
      color: white;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
    }

    .item-note {
      font-size: 0.8rem;
      color: #f59e0b;
      margin-top: 4px;
    }

    .modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      padding: 16px 24px;
      border-top: 1px solid var(--border-color, #333);
    }

    .btn {
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 0.9rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      border: none;
    }

    .btn-primary {
      background: var(--accent-primary, #6366f1);
      color: white;
    }

    .btn-primary:hover {
      background: var(--accent-primary-dark, #5558e3);
    }

    .btn-secondary {
      background: var(--bg-tertiary, #252542);
      color: var(--text-primary, #fff);
      border: 1px solid var(--border-color, #333);
    }

    .btn-secondary:hover {
      background: var(--bg-primary, #0f0f1a);
    }
  `]
})
export class PrintJobsComponent implements OnInit {
  private orderService = inject(OrderService);

  jobs = signal<PrintJobDto[]>([]);
  loading = signal(false);
  statusFilter: PrintJobStatus | null = null;
  viewingJob = signal<PrintJobDto | null>(null);

  ngOnInit(): void {
    this.loadJobs();
  }

  loadJobs(): void {
    this.loading.set(true);
    const params = this.statusFilter ? { status: this.statusFilter, limit: 100 } : { limit: 100 };
    
    this.orderService.getPrintJobs(params).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.jobs.set(res.data.jobs);
        }
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  countByStatus(status: PrintJobStatus): number {
    return this.jobs().filter(j => j.status === status).length;
  }

  getStatusLabel(status: PrintJobStatus): string {
    const labels: Record<PrintJobStatus, string> = {
      PENDING: 'Bekliyor',
      PROCESSING: 'İşleniyor',
      DONE: 'Tamamlandı',
      FAILED: 'Başarısız',
    };
    return labels[status];
  }

  formatTime(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  truncateError(error: string): string {
    return error.length > 30 ? error.substring(0, 30) + '...' : error;
  }

  retryJob(job: PrintJobDto): void {
    this.orderService.retryPrintJob(job.id).subscribe({
      next: () => this.loadJobs(),
      error: (err) => console.error('Retry failed:', err),
    });
  }

  viewJob(job: PrintJobDto): void {
    this.viewingJob.set(job);
  }

  closeModal(): void {
    this.viewingJob.set(null);
  }

  cancelJob(job: PrintJobDto): void {
    if (confirm(`#${job.payloadJson.orderNumber} numaralı yazdırma işini durdurmak istediğinize emin misiniz?`)) {
      this.orderService.cancelPrintJob(job.id).subscribe({
        next: () => {
          this.loadJobs();
        },
        error: (err) => {
          console.error('Cancel failed:', err);
          alert('İşlem durdurulamadı: ' + (err.error?.error?.message || err.message));
        },
      });
    }
  }

  deleteJob(job: PrintJobDto): void {
    if (confirm(`#${job.payloadJson.orderNumber} numaralı yazdırma işini silmek istediğinize emin misiniz?`)) {
      this.orderService.deletePrintJob(job.id).subscribe({
        next: () => {
          this.loadJobs();
        },
        error: (err) => {
          console.error('Delete failed:', err);
          alert('İşlem silinemedi: ' + (err.error?.error?.message || err.message));
        },
      });
    }
  }
}

