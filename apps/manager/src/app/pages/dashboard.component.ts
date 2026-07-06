import { Component, inject, signal, OnInit } from '@angular/core';
import { AdminService } from '../admin.service';

@Component({
  selector: 'mgr-dashboard',
  standalone: true,
  template: `
    <h1>Genel Bakış</h1>
    @if (stats(); as s) {
      <div class="grid">
        <div class="stat"><div class="k">Toplam İşletme</div><div class="v">{{ s.totalTenants }}</div></div>
        <div class="stat"><div class="k">Aktif Abonelik</div><div class="v">{{ s.activeSubscriptions }}</div></div>
        <div class="stat"><div class="k">Deneme</div><div class="v">{{ s.trialCount }}</div></div>
        <div class="stat"><div class="k">Süresi Dolmuş</div><div class="v">{{ s.expiredCount }}</div></div>
        <div class="stat"><div class="k">Toplam Kullanıcı</div><div class="v">{{ s.totalUsers }}</div></div>
        <div class="stat accent"><div class="k">Aylık Yinelenen Gelir (MRR)</div><div class="v">₺{{ fmt(s.mrr) }}</div></div>
        <div class="stat green"><div class="k">Toplam Tahsilat</div><div class="v">₺{{ fmt(s.totalRevenue) }}</div></div>
      </div>
    } @else if (loading()) {
      <p class="muted">Yükleniyor…</p>
    } @else {
      <p class="muted">Veri alınamadı.</p>
    }
  `,
  styles: [`
    h1 { font-size: 1.5rem; margin: 0 0 24px; }
    .muted { color: var(--text2); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
    .stat { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; }
    .stat .k { color: var(--text2); font-size: 0.85rem; }
    .stat .v { font-size: 1.8rem; font-weight: 700; margin-top: 8px; }
    .stat.accent .v { color: var(--accent); }
    .stat.green .v { color: var(--green); }
  `],
})
export class DashboardComponent implements OnInit {
  private admin = inject(AdminService);
  loading = signal(true);
  stats = signal<any | null>(null);

  ngOnInit(): void {
    this.admin.getStats().subscribe({
      next: (res) => { this.stats.set(res.data ?? null); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  fmt(n: number): string {
    return (n || 0).toLocaleString('tr-TR');
  }
}
