import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AdminService } from '../admin.service';

@Component({
  selector: 'mgr-tenant-detail',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <a routerLink="/tenants" class="back">← İşletmeler</a>

    @if (tenant(); as t) {
      <div class="top">
        <div>
          <h1>{{ t.name }}</h1>
          <div class="slug">{{ t.slug }} · {{ date(t.createdAt) }} tarihinde kayıt</div>
        </div>
      </div>

      @if (actionMsg()) { <div class="ok">{{ actionMsg() }}</div> }
      @if (actionErr()) { <div class="err">{{ actionErr() }}</div> }

      <div class="cols">
        <!-- Abonelik -->
        <section class="card">
          <h2>Abonelik</h2>
          @if (t.subscription; as s) {
            <div class="row"><span>Plan</span><b>{{ planName(s.plan) }}</b></div>
            <div class="row"><span>Durum</span><span class="badge" [attr.data-s]="s.status">{{ statusText(s.status) }}</span></div>
            <div class="row"><span>Faturalama</span><b>{{ s.billingCycle === 'ANNUAL' ? 'Yıllık' : 'Aylık' }}</b></div>
            <div class="row"><span>Dönem Sonu</span><b>{{ s.currentPeriodEnd ? date(s.currentPeriodEnd) : '—' }}</b></div>
            <div class="row"><span>Sipariş Kullanımı</span><b>{{ s.ordersUsed }} / {{ s.monthlyOrderLimit }}</b></div>
            <div class="row"><span>Mesaj Kullanımı</span><b>{{ s.messagesUsed }} / {{ s.monthlyMessageLimit }}</b></div>
            <div class="row"><span>Şube Limiti</span><b>{{ s.maxStores }}</b></div>
            <div class="row"><span>iyzico Ref</span><b class="mono">{{ s.iyzicoSubscriptionRef || '—' }}</b></div>
          } @else {
            <p class="muted">Abonelik kaydı yok.</p>
          }
        </section>

        <!-- Yönetim aksiyonları -->
        <section class="card">
          <h2>Yönetim İşlemleri</h2>
          <div class="act">
            <label>Süre uzat (gün)</label>
            <div class="inline">
              <input type="number" [(ngModel)]="extendDays" min="1" />
              <button (click)="act('extend', { days: extendDays })" [disabled]="busy()">Uzat</button>
            </div>
          </div>
          <div class="act">
            <label>Plan değiştir</label>
            <div class="inline">
              <select [(ngModel)]="newPlan">
                <option value="SILVER">Gümüş</option>
                <option value="GOLD">Altın</option>
                <option value="PLATINUM">Platin</option>
                <option value="TEST">Test (₺1)</option>
              </select>
              <button (click)="act('change-plan', { plan: newPlan })" [disabled]="busy()">Değiştir</button>
            </div>
          </div>
          <div class="act-row">
            <button class="green" (click)="act('activate', {})" [disabled]="busy()">Aktifleştir</button>
            <button class="red" (click)="act('suspend', {})" [disabled]="busy()">Askıya Al</button>
          </div>
        </section>

        <!-- Üyeler -->
        <section class="card wide">
          <h2>Kullanıcılar ({{ t.members.length }})</h2>
          <div class="tbl-wrap">
            <table>
              <thead><tr><th>Ad</th><th>E-posta</th><th>Telefon</th><th>Rol</th></tr></thead>
              <tbody>
                @for (m of t.members; track m.id) {
                  <tr><td>{{ m.name }}</td><td>{{ m.email }}</td><td>{{ m.phone || '—' }}</td><td>{{ m.role }}</td></tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        <!-- Ödemeler -->
        <section class="card wide">
          <h2>Ödeme / Fatura Geçmişi</h2>
          @if (transactions().length === 0) {
            <p class="muted">İşlem kaydı yok.</p>
          } @else {
            <div class="tbl-wrap">
              <table>
                <thead><tr><th>Tarih</th><th>Tür</th><th>Tutar</th><th>Durum</th><th>Plan</th><th>Not</th></tr></thead>
                <tbody>
                  @for (x of transactions(); track x.id) {
                    <tr>
                      <td>{{ dateTime(x.createdAt) }}</td>
                      <td>{{ txType(x.type) }}</td>
                      <td>₺{{ fmt(x.amount) }}</td>
                      <td><span class="badge" [attr.data-s]="x.status">{{ txStatus(x.status) }}</span></td>
                      <td>{{ planName(x.plan) }}</td>
                      <td class="note">{{ x.errorMessage || '' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>
      </div>
    } @else if (loading()) {
      <p class="muted">Yükleniyor…</p>
    } @else {
      <p class="muted">İşletme bulunamadı.</p>
    }
  `,
  styles: [`
    .back { display: inline-block; color: var(--text2); margin-bottom: 16px; }
    h1 { font-size: 1.5rem; margin: 0; }
    .slug { color: var(--text2); font-size: 0.85rem; margin-top: 4px; }
    .muted { color: var(--text2); }
    .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 20px; }
    .card { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; }
    .card.wide { grid-column: 1 / -1; }
    h2 { font-size: 1rem; margin: 0 0 16px; }
    .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 0.9rem; }
    .row:last-child { border-bottom: 0; }
    .row span { color: var(--text2); }
    .mono { font-family: monospace; font-size: 0.78rem; }
    .badge { font-size: 0.78rem; padding: 3px 9px; border-radius: 100px; background: var(--bg3); }
    .badge[data-s="ACTIVE"],.badge[data-s="SUCCESS"] { background: rgba(16,185,129,0.15); color: #34d399; }
    .badge[data-s="EXPIRED"],.badge[data-s="FAILED"] { background: rgba(239,68,68,0.15); color: #f87171; }
    .badge[data-s="UNPAID"],.badge[data-s="PENDING"] { background: rgba(245,158,11,0.15); color: #fbbf24; }
    .badge[data-s="CANCELLED"] { background: rgba(148,163,184,0.15); color: #94a3b8; }
    .act { margin-bottom: 16px; }
    .act label { display: block; font-size: 0.85rem; color: var(--text2); margin-bottom: 6px; }
    .inline { display: flex; gap: 8px; }
    .inline input, .inline select { flex: 1; height: 38px; padding: 0 10px; background: var(--bg3); border: 1px solid var(--border); border-radius: 8px; color: var(--text); }
    .inline button, .act-row button { height: 38px; padding: 0 16px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; font-weight: 600; cursor: pointer; }
    .inline button:hover { background: var(--accent-h); }
    .act-row { display: flex; gap: 8px; margin-top: 8px; }
    .act-row .green { background: var(--green); }
    .act-row .red { background: var(--red); }
    button:disabled { opacity: 0.6; cursor: default; }
    .tbl-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; min-width: 480px; }
    th { text-align: left; font-size: 0.76rem; text-transform: uppercase; color: var(--text2); padding: 10px 12px; border-bottom: 1px solid var(--border); }
    td { padding: 10px 12px; border-bottom: 1px solid var(--border); font-size: 0.88rem; }
    tr:last-child td { border-bottom: 0; }
    .note { color: var(--text2); font-size: 0.8rem; }
    .ok { background: rgba(16,185,129,0.12); border: 1px solid rgba(16,185,129,0.3); color: #34d399; padding: 10px 12px; border-radius: 8px; margin-top: 16px; }
    .err { background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.3); color: #f87171; padding: 10px 12px; border-radius: 8px; margin-top: 16px; }
    @media (max-width: 720px) { .cols { grid-template-columns: 1fr; } }
  `],
})
export class TenantDetailComponent implements OnInit {
  private admin = inject(AdminService);
  private route = inject(ActivatedRoute);

  id = '';
  loading = signal(true);
  busy = signal(false);
  tenant = signal<any | null>(null);
  transactions = signal<any[]>([]);
  actionMsg = signal<string | null>(null);
  actionErr = signal<string | null>(null);

  extendDays = 30;
  newPlan = 'GOLD';

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') || '';
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.admin.getTenant(this.id).subscribe({
      next: (res) => { this.tenant.set(res.data ?? null); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
    this.admin.getTransactions(this.id).subscribe({
      next: (res) => this.transactions.set(res.data?.transactions ?? []),
    });
  }

  act(action: string, params: any): void {
    this.busy.set(true);
    this.actionMsg.set(null);
    this.actionErr.set(null);
    this.admin.manageSubscription(this.id, { action, ...params }).subscribe({
      next: (res) => {
        this.busy.set(false);
        if (res.success) {
          this.actionMsg.set('İşlem başarılı.');
          this.load();
        } else {
          this.actionErr.set(res.error?.message || 'İşlem başarısız.');
        }
      },
      error: (err) => {
        this.busy.set(false);
        this.actionErr.set(err?.error?.error?.message || 'İşlem başarısız.');
      },
    });
  }

  planName(p?: string): string {
    const m: Record<string, string> = { TRIAL: 'Deneme', SILVER: 'Gümüş', GOLD: 'Altın', PLATINUM: 'Platin', TEST: 'Test', STARTER: 'Starter', PRO: 'Pro' };
    return p ? (m[p] || p) : '—';
  }
  statusText(s?: string): string {
    const m: Record<string, string> = { ACTIVE: 'Aktif', EXPIRED: 'Süresi Dolmuş', UNPAID: 'Ödenmemiş', CANCELLED: 'İptal', PENDING: 'Beklemede' };
    return s ? (m[s] || s) : '—';
  }
  txType(t: string): string {
    const m: Record<string, string> = { SUBSCRIPTION_PAYMENT: 'Abonelik', SUBSCRIPTION_RENEWAL: 'Yenileme', SUBSCRIPTION_UPGRADE: 'Yükseltme', REFUND: 'İade' };
    return m[t] || t;
  }
  txStatus(s: string): string {
    const m: Record<string, string> = { SUCCESS: 'Başarılı', FAILED: 'Başarısız', PENDING: 'Beklemede', REFUNDED: 'İade Edildi' };
    return m[s] || s;
  }
  fmt(n: number): string { return (n || 0).toLocaleString('tr-TR'); }
  date(iso: string): string { return new Date(iso).toLocaleDateString('tr-TR'); }
  dateTime(iso: string): string { return new Date(iso).toLocaleString('tr-TR'); }
}
