import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AdminService } from '../admin.service';

@Component({
  selector: 'mgr-tenants',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="head">
      <h1>İşletmeler</h1>
      <input class="search" [(ngModel)]="search" (input)="onSearch()" placeholder="İsim veya slug ara…" />
    </div>

    @if (loading()) {
      <p class="muted">Yükleniyor…</p>
    } @else if (tenants().length === 0) {
      <p class="muted">İşletme bulunamadı.</p>
    } @else {
      <div class="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>İşletme</th><th>Plan</th><th>Durum</th><th>Kullanıcı</th><th>Sipariş</th><th>Şube</th><th>Dönem Sonu</th><th></th>
            </tr>
          </thead>
          <tbody>
            @for (t of tenants(); track t.id) {
              <tr>
                <td><div class="tname">{{ t.name }}</div><div class="tslug">{{ t.slug }}</div></td>
                <td>{{ planName(t.subscription?.plan) }}</td>
                <td><span class="badge" [attr.data-s]="t.subscription?.status">{{ statusText(t.subscription?.status) }}</span></td>
                <td>{{ t.userCount }}</td>
                <td>{{ t.orderCount }}</td>
                <td>{{ t.storeCount }}</td>
                <td>{{ t.subscription?.currentPeriodEnd ? (date(t.subscription.currentPeriodEnd)) : '—' }}</td>
                <td><a [routerLink]="['/tenants', t.id]" class="detail">Detay →</a></td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styles: [`
    .head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
    h1 { font-size: 1.5rem; margin: 0; }
    .search { height: 40px; width: 280px; max-width: 100%; padding: 0 12px; background: var(--bg3); border: 1px solid var(--border); border-radius: 8px; color: var(--text); }
    .search:focus { outline: none; border-color: var(--accent); }
    .muted { color: var(--text2); }
    .tbl-wrap { overflow-x: auto; background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); }
    table { width: 100%; border-collapse: collapse; min-width: 720px; }
    th { text-align: left; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.03em; color: var(--text2); padding: 14px 16px; border-bottom: 1px solid var(--border); }
    td { padding: 14px 16px; border-bottom: 1px solid var(--border); }
    tr:last-child td { border-bottom: 0; }
    .tname { font-weight: 600; }
    .tslug { color: var(--text2); font-size: 0.8rem; }
    .badge { font-size: 0.78rem; padding: 3px 9px; border-radius: 100px; background: var(--bg3); }
    .badge[data-s="ACTIVE"] { background: rgba(16,185,129,0.15); color: #34d399; }
    .badge[data-s="EXPIRED"] { background: rgba(239,68,68,0.15); color: #f87171; }
    .badge[data-s="UNPAID"] { background: rgba(245,158,11,0.15); color: #fbbf24; }
    .badge[data-s="CANCELLED"] { background: rgba(148,163,184,0.15); color: #94a3b8; }
    .detail { font-weight: 600; white-space: nowrap; }
  `],
})
export class TenantsComponent implements OnInit {
  private admin = inject(AdminService);
  loading = signal(true);
  tenants = signal<any[]>([]);
  search = '';
  private searchTimer: any = null;

  ngOnInit(): void { this.load(); }

  onSearch(): void {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.load(), 300);
  }

  load(): void {
    this.loading.set(true);
    this.admin.getTenants(this.search.trim() || undefined).subscribe({
      next: (res) => { this.tenants.set(res.data?.tenants ?? []); this.loading.set(false); },
      error: () => this.loading.set(false),
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
  date(iso: string): string {
    return new Date(iso).toLocaleDateString('tr-TR');
  }
}
