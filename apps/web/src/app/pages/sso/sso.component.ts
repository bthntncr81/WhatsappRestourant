// POS "OtOrder AI" düğmesinden gelen SSO inişi.
// Token URL FRAGMENT'ında taşınır (#t=..&s=..) — fragment sunucuya/loglara gitmez;
// burada okunur, API'de whatres oturumuna çevrilir ve adres çubuğundan silinir.
import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { BrandLogoComponent } from '../../shared/brand-logo.component';

@Component({
  selector: 'app-sso',
  standalone: true,
  template: `
    <div class="sso-wrap">
      <div class="sso-card">
        <div class="sso-brand">
          <app-brand-logo theme="dark" [height]="26"/>
        </div>
        @if (!error()) {
          <div class="spinner"></div>
          <p>OtOrder hesabınla giriş yapılıyor…</p>
        } @else {
          <p class="err">{{ error() }}</p>
          <a routerLink="/login">Giriş sayfasına dön</a>
        }
      </div>
    </div>
  `,
  styles: [`
    .sso-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #0B0D12; color: #fff; }
    .sso-card { text-align: center; padding: 2rem; }
    .sso-brand { display: flex; justify-content: center; margin-bottom: 1.5rem; }
    .spinner { width: 36px; height: 36px; border: 3px solid rgba(255,255,255,.2); border-top-color: #bb1e10; border-radius: 50%; margin: 0 auto 1rem; animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .err { color: #ffb4ae; max-width: 420px; }
    a { color: #fff; text-decoration: underline; }
  `],
  imports: [RouterLink, BrandLogoComponent],
})
export class SsoComponent implements OnInit {
  private auth = inject(AuthService);
  private router = inject(Router);
  error = signal<string>('');

  ngOnInit(): void {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = params.get('t') || '';
    const subdomain = params.get('s') || '';
    // Token'ı adres çubuğundan hemen sil (geri tuşu/paylaşım sızdırmasın)
    history.replaceState(null, '', window.location.pathname);
    if (!token || !subdomain) {
      this.error.set('SSO bağlantısı eksik — POS panelindeki OtOrder AI düğmesini kullanın.');
      return;
    }
    this.auth.ssoWithOtorderToken(token, subdomain).subscribe({
      next: () => this.router.navigate(['/']),
      error: (err) => {
        const msg = err?.error?.error?.message
          || 'Giriş doğrulanamadı — POS panelinden tekrar deneyin ya da e-posta+şifreyle girin.';
        this.error.set(msg);
      },
    });
  }
}
