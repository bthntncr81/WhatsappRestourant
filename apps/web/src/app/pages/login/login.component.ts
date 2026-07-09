import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { IconComponent } from '../../shared/icon.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IconComponent],
  template: `
    <div class="auth-page">
      <!-- Left: brand panel -->
      <aside class="brand-panel">
        <div class="brand-panel-inner">
          <div class="wordmark">
            <span class="wordmark-name">OtOrder</span>
            <span class="wordmark-ai">AI</span>
          </div>

          <div class="brand-copy">
            <p class="brand-eyebrow">
              <span class="live-dot"></span>
              WhatsApp hattın 7/24 açık
            </p>
            <h2 class="brand-headline">Siparişleri yapay zekâ alsın.</h2>
            <p class="brand-sub">
              WhatsApp'ta müşterinle konuşan, siparişi POS'una düşüren asistan.
            </p>
          </div>

          <div class="chat-demo" aria-hidden="true">
            <div class="chat-bubble in">2 büyük karışık pizza, 1 ayran. Adres kayıtlı olan.</div>
            <div class="chat-bubble out">
              <span class="bubble-tag">OtOrder AI</span>
              Siparişini aldım. 2 Karışık Pizza (L) + 1 Ayran, toplam 540 TL. Onaylıyor musun?
            </div>
            <div class="chat-bubble in short">Onay</div>
            <div class="chat-order">
              <span class="order-dot"></span>
              Sipariş #4821 POS ekranına düştü
            </div>
          </div>

          <p class="brand-foot">Restoranlar için yapay zekâ sipariş asistanı</p>
        </div>
      </aside>

      <!-- Right: form panel -->
      <main class="form-panel">
        <div class="form-card">
          <div class="form-brand">
            <span class="form-brand-name">OtOrder</span>
            <span class="wordmark-ai">AI</span>
          </div>

          <h1 class="form-title">Tekrar hoş geldin</h1>
          <p class="form-sub">Panele girmek için hesabınla devam et.</p>

          <form class="auth-form" (ngSubmit)="onSubmit()">
            @if (error()) {
              <div class="error-alert">
                <app-icon name="alert-triangle" [size]="16" class="error-icon"/>
                <span>{{ error() }}</span>
              </div>
            }

            <div class="form-group">
              <label for="email" class="form-label">E-posta</label>
              <input
                type="email"
                id="email"
                class="form-input"
                [(ngModel)]="email"
                name="email"
                placeholder="ornek@example.com"
                required
                [disabled]="loading()"
              />
            </div>

            <div class="form-group">
              <label for="password" class="form-label">Şifre</label>
              <div class="password-wrap">
                <input
                  [type]="showPassword() ? 'text' : 'password'"
                  id="password"
                  class="form-input"
                  [(ngModel)]="password"
                  name="password"
                  placeholder="••••••••"
                  required
                  [disabled]="loading()"
                />
                <button
                  type="button"
                  class="password-toggle"
                  (click)="showPassword.set(!showPassword())"
                  [attr.aria-label]="showPassword() ? 'Şifreyi gizle' : 'Şifreyi göster'"
                  tabindex="-1"
                >
                  <app-icon [name]="showPassword() ? 'eye-off' : 'eye'" [size]="18"/>
                </button>
              </div>
            </div>

            <button type="submit" class="btn-primary" [disabled]="loading()">
              @if (loading()) {
                <span class="spinner"></span>
                Giriş yapılıyor...
              } @else {
                Giriş Yap
              }
            </button>
          </form>

          <p class="form-note">
            OtOrder Pro AI paketi olan hesaplar POS e-posta ve şifresiyle giriş yapabilir.
          </p>

          <div class="auth-footer">
            <p>
              Hesabın yok mu?
              <a routerLink="/register" class="auth-link">Hesap oluştur</a>
            </p>
          </div>
        </div>
      </main>
    </div>
  `,
  styles: [
    `
      .auth-page {
        min-height: 100vh;
        display: grid;
        grid-template-columns: 1.1fr 1fr;
        background: #0b0d12;
      }

      /* ============ Brand panel (left) ============ */

      .brand-panel {
        position: relative;
        overflow: hidden;
        background: #0b0d12;
        background-image:
          radial-gradient(ellipse 90% 60% at 12% -8%, rgba(187, 30, 16, 0.22), transparent 62%),
          radial-gradient(ellipse 65% 45% at 92% 112%, rgba(187, 30, 16, 0.12), transparent 60%);
      }

      .brand-panel::before {
        content: '';
        position: absolute;
        inset: 0;
        background-image:
          linear-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px);
        background-size: 44px 44px;
        -webkit-mask-image: radial-gradient(ellipse 85% 75% at 38% 28%, #000 25%, transparent 78%);
        mask-image: radial-gradient(ellipse 85% 75% at 38% 28%, #000 25%, transparent 78%);
        pointer-events: none;
      }

      .brand-panel-inner {
        position: relative;
        display: flex;
        flex-direction: column;
        min-height: 100vh;
        padding: 44px 56px;
        max-width: 660px;
      }

      .wordmark {
        display: flex;
        align-items: center;
        gap: 10px;
        animation: rise 0.5s ease both;
      }

      .wordmark-name {
        font-family: var(--font-display, 'Sora', sans-serif);
        font-size: 1.375rem;
        font-weight: 800;
        letter-spacing: -0.03em;
        color: #ffffff;
      }

      .wordmark-ai {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 24px;
        padding: 0 8px;
        border-radius: 7px;
        background: #bb1e10;
        color: #ffffff;
        font-family: var(--font-display, 'Sora', sans-serif);
        font-size: 0.75rem;
        font-weight: 800;
        letter-spacing: 0.07em;
      }

      .brand-copy {
        margin-top: clamp(40px, 11vh, 110px);
        animation: rise 0.5s ease 0.05s both;
      }

      .brand-eyebrow {
        display: flex;
        align-items: center;
        gap: 9px;
        font-size: 0.8125rem;
        font-weight: 600;
        letter-spacing: 0.02em;
        color: #9aa3b2;
      }

      .live-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #25d366;
        animation: livePulse 2.4s ease-out infinite;
      }

      @keyframes livePulse {
        0% {
          box-shadow: 0 0 0 0 rgba(37, 211, 102, 0.45);
        }
        70% {
          box-shadow: 0 0 0 9px rgba(37, 211, 102, 0);
        }
        100% {
          box-shadow: 0 0 0 0 rgba(37, 211, 102, 0);
        }
      }

      .brand-headline {
        font-family: var(--font-display, 'Sora', sans-serif);
        font-size: clamp(2rem, 3.2vw, 2.75rem);
        font-weight: 700;
        letter-spacing: -0.03em;
        line-height: 1.12;
        color: #ffffff;
        margin: 16px 0 12px;
      }

      .brand-sub {
        font-size: 1.0625rem;
        line-height: 1.6;
        color: #b9c0cc;
        max-width: 42ch;
      }

      /* Chat composition */

      .chat-demo {
        margin-top: clamp(32px, 6vh, 56px);
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-width: 410px;
      }

      .chat-bubble {
        padding: 12px 16px;
        border-radius: 16px;
        font-size: 0.875rem;
        line-height: 1.5;
        animation: rise 0.5s ease both;
      }

      .chat-bubble.in {
        align-self: flex-start;
        max-width: 85%;
        background: #171b24;
        border: 1px solid rgba(255, 255, 255, 0.07);
        border-bottom-left-radius: 6px;
        color: #dfe3ea;
        animation-delay: 0.12s;
      }

      .chat-bubble.in.short {
        animation-delay: 0.36s;
      }

      .chat-bubble.out {
        align-self: flex-end;
        max-width: 88%;
        background: linear-gradient(180deg, rgba(187, 30, 16, 0.2), rgba(187, 30, 16, 0.1));
        border: 1px solid rgba(187, 30, 16, 0.38);
        border-bottom-right-radius: 6px;
        color: #f3e9e7;
        animation-delay: 0.24s;
      }

      .bubble-tag {
        display: block;
        font-size: 0.6875rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #ff8a7d;
        margin-bottom: 4px;
      }

      .chat-order {
        align-self: flex-end;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 14px;
        border-radius: 999px;
        background: rgba(37, 211, 102, 0.08);
        border: 1px solid rgba(37, 211, 102, 0.25);
        color: #7fe0a8;
        font-size: 0.8125rem;
        font-weight: 600;
        animation: rise 0.5s ease 0.48s both;
      }

      .order-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #25d366;
      }

      .brand-foot {
        margin-top: auto;
        padding-top: 40px;
        font-size: 0.8125rem;
        color: #6d7482;
      }

      @keyframes rise {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      /* ============ Form panel (right) ============ */

      .form-panel {
        display: flex;
        align-items: center;
        justify-content: center;
        background: #faf9f7;
        padding: 48px 32px;
      }

      .form-card {
        width: 100%;
        max-width: 384px;
        animation: rise 0.5s ease 0.1s both;
      }

      .form-brand {
        display: none;
        align-items: center;
        gap: 9px;
        margin-bottom: 28px;
      }

      .form-brand-name {
        font-family: var(--font-display, 'Sora', sans-serif);
        font-size: 1.25rem;
        font-weight: 800;
        letter-spacing: -0.03em;
        color: #16181d;
      }

      .form-title {
        font-family: var(--font-display, 'Sora', sans-serif);
        font-size: 1.625rem;
        font-weight: 700;
        letter-spacing: -0.02em;
        color: #16181d;
        margin-bottom: 6px;
      }

      .form-sub {
        font-size: 0.9375rem;
        color: #6b6f76;
        margin-bottom: 28px;
      }

      .auth-form {
        display: flex;
        flex-direction: column;
        gap: 18px;
      }

      .error-alert {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 14px;
        background: #fdecea;
        border: 1px solid #f5c1ba;
        border-radius: 10px;
        color: #a61b0e;
        font-size: 0.875rem;
      }

      .form-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .form-label {
        font-size: 0.8125rem;
        font-weight: 600;
        color: #3e4249;
      }

      .password-wrap {
        position: relative;
      }
      .password-wrap .form-input {
        padding-right: 44px;
      }
      .password-toggle {
        position: absolute;
        right: 6px;
        top: 50%;
        transform: translateY(-50%);
        width: 32px;
        height: 32px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: none;
        color: #8a8e95;
        cursor: pointer;
        border-radius: 8px;
        transition: color 150ms ease;
      }
      .password-toggle:hover {
        color: #16181d;
      }

      .form-input {
        width: 100%;
        height: 46px;
        padding: 0 14px;
        background: #ffffff;
        border: 1px solid #e2dfda;
        border-radius: 10px;
        color: #16181d;
        font-size: 0.9375rem;
        font-family: inherit;
        transition: border-color 150ms ease, box-shadow 150ms ease;

        &::placeholder {
          color: #a6a9af;
        }

        &:focus {
          outline: none;
          border-color: #bb1e10;
          box-shadow: 0 0 0 3px rgba(187, 30, 16, 0.12);
        }

        &:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      }

      .btn-primary {
        height: 48px;
        background: #bb1e10;
        border: none;
        border-radius: 10px;
        color: white;
        font-size: 0.9375rem;
        font-weight: 700;
        cursor: pointer;
        transition: background 150ms ease, transform 150ms ease;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        margin-top: 4px;
        box-shadow: 0 10px 22px -10px rgba(187, 30, 16, 0.55);

        &:hover:not(:disabled) {
          background: #a11a0e;
          transform: translateY(-1px);
        }

        &:active:not(:disabled) {
          transform: translateY(0);
        }

        &:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }
      }

      .spinner {
        width: 16px;
        height: 16px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-top-color: white;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      .form-note {
        margin-top: 16px;
        padding: 10px 12px;
        background: #f2f0ec;
        border-radius: 10px;
        font-size: 0.78rem;
        line-height: 1.5;
        color: #6b6f76;
      }

      .auth-footer {
        margin-top: 24px;
        padding-top: 20px;
        border-top: 1px solid #e7e5e0;
        font-size: 0.875rem;
        color: #6b6f76;
        text-align: center;
      }

      .auth-link {
        color: #bb1e10;
        font-weight: 600;

        &:hover {
          color: #a11a0e;
          text-decoration: underline;
        }
      }

      /* ============ Responsive ============ */

      @media (max-width: 960px) {
        .auth-page {
          grid-template-columns: 1fr;
        }

        .brand-panel {
          display: none;
        }

        .form-panel {
          min-height: 100vh;
        }

        .form-brand {
          display: flex;
        }
      }
    `,
  ],
})
export class LoginComponent {
  private authService = inject(AuthService);
  private router = inject(Router);

  email = '';
  password = '';
  showPassword = signal(false);
  loading = signal(false);
  error = signal<string | null>(null);

  onSubmit(): void {
    if (!this.email || !this.password) {
      this.error.set('Lütfen tüm alanları doldurun');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    this.authService.login({ email: this.email, password: this.password }).subscribe({
      next: (response) => {
        if (response.success) {
          this.router.navigate(['/']);
        } else {
          this.error.set(response.error?.message || 'Giriş başarısız');
        }
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err.error?.error?.message || 'Giriş başarısız. Lütfen tekrar deneyin.');
        this.loading.set(false);
      },
    });
  }
}
