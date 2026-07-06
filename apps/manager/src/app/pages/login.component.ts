import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AdminService } from '../admin.service';

@Component({
  selector: 'mgr-login',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="wrap">
      <div class="card">
        <div class="brand">Superpersonel <span>Yönetim</span></div>
        <p class="sub">Süper yönetici girişi</p>

        @if (error()) {
          <div class="err">{{ error() }}</div>
        }

        <form (ngSubmit)="submit()">
          <label>E-posta</label>
          <input type="email" [(ngModel)]="email" name="email" autocomplete="username" required />

          <label>Şifre</label>
          <div class="pw">
            <input [type]="show() ? 'text' : 'password'" [(ngModel)]="password" name="password" autocomplete="current-password" required />
            <button type="button" (click)="show.set(!show())" tabindex="-1">{{ show() ? 'Gizle' : 'Göster' }}</button>
          </div>

          <button type="submit" class="primary" [disabled]="loading()">
            {{ loading() ? 'Giriş yapılıyor…' : 'Giriş Yap' }}
          </button>
        </form>
      </div>
    </div>
  `,
  styles: [`
    .wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { width: 100%; max-width: 380px; background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); padding: 32px; }
    .brand { font-size: 1.4rem; font-weight: 700; }
    .brand span { color: var(--accent); }
    .sub { color: var(--text2); margin: 4px 0 24px; }
    label { display: block; font-size: 0.85rem; color: var(--text2); margin: 14px 0 6px; }
    input { width: 100%; height: 42px; padding: 0 12px; background: var(--bg3); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 0.95rem; }
    input:focus { outline: none; border-color: var(--accent); }
    .pw { position: relative; }
    .pw button { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: transparent; border: 0; color: var(--text2); cursor: pointer; font-size: 0.8rem; }
    .primary { width: 100%; height: 44px; margin-top: 22px; background: var(--accent); color: #fff; border: 0; border-radius: 8px; font-weight: 600; font-size: 0.95rem; cursor: pointer; }
    .primary:hover { background: var(--accent-h); }
    .primary:disabled { opacity: 0.6; cursor: default; }
    .err { background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.3); color: #fca5a5; padding: 10px 12px; border-radius: 8px; font-size: 0.85rem; margin-bottom: 8px; }
  `],
})
export class LoginComponent {
  private admin = inject(AdminService);
  private router = inject(Router);

  email = '';
  password = '';
  show = signal(false);
  loading = signal(false);
  error = signal<string | null>(null);

  submit(): void {
    if (!this.email || !this.password) return;
    this.loading.set(true);
    this.error.set(null);
    this.admin.login(this.email, this.password).subscribe({
      next: (res) => {
        this.loading.set(false);
        if (res.success && res.data) {
          this.admin.setToken(res.data.token);
          this.router.navigate(['/']);
        } else {
          this.error.set(res.error?.message || 'Giriş başarısız.');
        }
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err?.error?.error?.message || 'Giriş başarısız.');
      },
    });
  }
}
