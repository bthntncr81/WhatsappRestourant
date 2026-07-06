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
    <div class="auth-container">
      <div class="auth-card">
        <div class="auth-header">
          <div class="logo">
            <img src="/logo.jpeg" alt="Superpersonel" style="height:32px; width:32px; border-radius:8px; object-fit:cover;"/>
            <span class="logo-text">Superpersonel</span>
          </div>
          <h1 class="auth-title">Tekrar hoş geldiniz</h1>
          <p class="auth-subtitle text-muted">Hesabınıza giriş yapın</p>
        </div>

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

        <div class="auth-footer">
          <p class="text-muted">
            Hesabınız yok mu?
            <a routerLink="/register" class="auth-link">Hesap oluştur</a>
          </p>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .auth-container {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-lg);
        background: var(--color-bg-primary);
        background-image: radial-gradient(
          ellipse 80% 50% at 50% -20%,
          rgba(27, 85, 131, 0.15),
          transparent
        );
      }

      .auth-card {
        width: 100%;
        max-width: 400px;
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-xl);
        padding: var(--spacing-2xl);
        animation: slideUp 0.3s ease;
      }

      @keyframes slideUp {
        from {
          opacity: 0;
          transform: translateY(16px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .auth-header {
        text-align: center;
        margin-bottom: var(--spacing-xl);
      }

      .logo {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-lg);
      }

      .logo-icon {
        color: var(--color-accent-primary);
      }

      .logo-text {
        font-size: 1.5rem;
        font-weight: 700;
        letter-spacing: -0.02em;
      }

      .auth-title {
        font-size: 1.5rem;
        font-weight: 600;
        margin-bottom: var(--spacing-xs);
      }

      .auth-subtitle {
        font-size: 0.9375rem;
      }

      .auth-form {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
      }

      .error-alert {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-md);
        background: rgba(239, 68, 68, 0.1);
        border: 1px solid rgba(239, 68, 68, 0.3);
        border-radius: var(--radius-md);
        color: var(--color-accent-danger);
        font-size: 0.875rem;
      }

      .form-group {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }

      .form-label {
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--color-text-secondary);
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
        color: var(--color-text-muted);
        cursor: pointer;
        border-radius: var(--radius-sm);
        transition: color var(--transition-fast);
      }
      .password-toggle:hover {
        color: var(--color-text-primary);
      }

      .form-input {
        width: 100%;
        height: 44px;
        padding: 0 var(--spacing-md);
        background: var(--color-bg-tertiary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        color: var(--color-text-primary);
        font-size: 0.9375rem;
        transition: all var(--transition-fast);

        &::placeholder {
          color: var(--color-text-muted);
        }

        &:focus {
          outline: none;
          border-color: var(--color-accent-primary);
          box-shadow: 0 0 0 3px rgba(27, 85, 131, 0.15);
        }

        &:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      }

      .btn-primary {
        height: 44px;
        background: var(--color-accent-primary);
        border: none;
        border-radius: var(--radius-md);
        color: white;
        font-size: 0.9375rem;
        font-weight: 600;
        cursor: pointer;
        transition: all var(--transition-fast);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-sm);
        margin-top: var(--spacing-sm);

        &:hover:not(:disabled) {
          opacity: 0.9;
          transform: translateY(-1px);
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

      .auth-footer {
        text-align: center;
        margin-top: var(--spacing-lg);
        padding-top: var(--spacing-lg);
        border-top: 1px solid var(--color-border);
        font-size: 0.875rem;
      }

      .auth-link {
        color: var(--color-accent-primary);
        font-weight: 500;

        &:hover {
          text-decoration: underline;
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


