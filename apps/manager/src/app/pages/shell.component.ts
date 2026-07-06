import { Component, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { AdminService } from '../admin.service';

@Component({
  selector: 'mgr-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="layout">
      <aside class="side">
        <div class="brand">Superpersonel <span>Yönetim</span></div>
        <nav>
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Genel Bakış</a>
          <a routerLink="/tenants" routerLinkActive="active">İşletmeler</a>
        </nav>
        <button class="logout" (click)="logout()">Çıkış Yap</button>
      </aside>
      <main class="main">
        <router-outlet/>
      </main>
    </div>
  `,
  styles: [`
    .layout { display: flex; min-height: 100vh; }
    .side { width: 230px; flex-shrink: 0; background: var(--bg2); border-right: 1px solid var(--border); padding: 24px 16px; display: flex; flex-direction: column; }
    .brand { font-size: 1.1rem; font-weight: 700; padding: 0 8px 24px; }
    .brand span { color: var(--accent); }
    nav { display: flex; flex-direction: column; gap: 4px; flex: 1; }
    nav a { padding: 10px 12px; border-radius: 8px; color: var(--text2); font-weight: 500; }
    nav a:hover { background: var(--bg3); color: var(--text); }
    nav a.active { background: var(--accent); color: #fff; }
    .logout { background: transparent; border: 1px solid var(--border); color: var(--text2); padding: 10px; border-radius: 8px; cursor: pointer; }
    .logout:hover { color: var(--text); border-color: var(--text2); }
    .main { flex: 1; padding: 32px; overflow-x: auto; }
    @media (max-width: 640px) {
      .layout { flex-direction: column; }
      .side { width: auto; flex-direction: row; align-items: center; padding: 12px; }
      .brand { padding: 0 12px 0 4px; }
      nav { flex-direction: row; }
      .main { padding: 16px; }
    }
  `],
})
export class ShellComponent {
  private admin = inject(AdminService);
  private router = inject(Router);
  logout(): void {
    this.admin.logout();
    this.router.navigate(['/login']);
  }
}
