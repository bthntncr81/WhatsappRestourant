import { Component, inject, signal, OnInit, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../services/auth.service';
import { IconComponent } from '../../shared/icon.component';

@Component({
  selector: 'app-register',
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
          <h1 class="auth-title">Çalışma alanınızı oluşturun</h1>
          <p class="auth-subtitle text-muted">Ücretsiz hesap oluşturun</p>
        </div>

        <form class="auth-form" (ngSubmit)="onSubmit()">
          @if (error()) {
            <div class="error-alert">
              <app-icon name="alert-triangle" [size]="16" class="error-icon"/>
              <span>{{ error() }}</span>
            </div>
          }

          <div class="form-row">
            <div class="form-group">
              <label for="name" class="form-label">Adınız</label>
              <input
                type="text"
                id="name"
                class="form-input"
                [(ngModel)]="name"
                name="name"
                placeholder="Ahmet Yılmaz"
                required
                [disabled]="loading()"
              />
            </div>
          </div>

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
                placeholder="En az 8 karakter"
                required
                minlength="8"
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

          <div class="form-divider">
            <span class="divider-text text-muted">İşletme detayları</span>
          </div>

          <div class="form-group">
            <label for="tenantName" class="form-label">İşletme adı</label>
            <input
              type="text"
              id="tenantName"
              class="form-input"
              [(ngModel)]="tenantName"
              name="tenantName"
              placeholder="İşletmem"
              required
              [disabled]="loading()"
            />
          </div>

          <div class="form-group">
            <label for="phone" class="form-label">Telefon</label>
            <input
              type="tel"
              id="phone"
              class="form-input"
              [(ngModel)]="phone"
              name="phone"
              placeholder="05XX XXX XX XX"
              required
              [disabled]="loading()"
            />
          </div>

          <!-- Legal Consent Checkboxes -->
          <div class="consent-section">
            <label class="consent-item">
              <input type="checkbox" [(ngModel)]="consents.terms" name="consentTerms" [disabled]="loading()"/>
              <span>
                <a class="consent-link" (click)="openLegalModal('TERMS'); $event.preventDefault()">Mesafeli Satış Sözleşmesi</a>'ni okudum ve kabul ediyorum.
              </span>
            </label>
            <label class="consent-item">
              <input type="checkbox" [(ngModel)]="consents.kvkk" name="consentKvkk" [disabled]="loading()"/>
              <span>
                <a class="consent-link" (click)="openLegalModal('KVKK'); $event.preventDefault()">KVKK Aydınlatma Metni</a>'ni okudum ve bilgilendirildim.
              </span>
            </label>
            <label class="consent-item">
              <input type="checkbox" [(ngModel)]="consents.explicitConsent" name="consentExplicit" [disabled]="loading()"/>
              <span>
                Kişisel verilerimin işlenmesine ve yapay zekâ sistemleri tarafından analiz edilmesine
                <a class="consent-link" (click)="openLegalModal('EXPLICIT_CONSENT'); $event.preventDefault()">açık rıza</a> veriyorum.
              </span>
            </label>
            <label class="consent-item">
              <input type="checkbox" [(ngModel)]="consents.dpa" name="consentDpa" [disabled]="loading()"/>
              <span>
                <a class="consent-link" (click)="openLegalModal('DPA'); $event.preventDefault()">Veri İşleme Sözleşmesi</a> hükümlerini kabul ediyorum.
              </span>
            </label>
            <p class="consent-disclaimer">
              Bu hizmeti kullanarak, sistemin bir altyapı hizmeti olduğunu, siparişlerin otomatik
              işlendiğini ve müşteri verileri bakımından veri sorumlusu olduğunuzu kabul edersiniz.
            </p>
          </div>

          <button type="submit" class="btn-primary" [disabled]="loading() || !allConsentsAccepted()">
            @if (loading()) {
              <span class="spinner"></span>
              Hesap oluşturuluyor...
            } @else {
              Kayıt ol
            }
          </button>
          <p class="consent-sub">Kayıt olarak tüm sözleşmeleri kabul etmiş olursunuz.</p>
        </form>

        <div class="auth-footer">
          <p class="text-muted">
            Zaten hesabınız var mı?
            <a routerLink="/login" class="auth-link">Giriş yap</a>
          </p>
        </div>

        <!-- Legal Document Modal -->
        @if (legalModal()) {
          <div class="legal-overlay" (click)="closeLegalModal()">
            <div class="legal-modal" (click)="$event.stopPropagation()">
              <div class="legal-header">
                <h2>{{ legalModal()!.title }}</h2>
                <button class="close-btn" (click)="closeLegalModal()">
                  <app-icon name="x" [size]="18"/>
                </button>
              </div>
              <div class="legal-body" #legalBody (scroll)="onLegalScroll()">
                <pre class="legal-text">{{ legalModal()!.content }}</pre>
              </div>
              <div class="legal-footer">
                <button
                  class="btn-primary legal-accept-btn"
                  (click)="acceptLegal()"
                  [disabled]="!legalScrolledToBottom()"
                >
                  @if (!legalScrolledToBottom()) {
                    Aşağı kaydırarak okuyun ↓
                  } @else {
                    Okudum ve anladım ✓
                  }
                </button>
              </div>
            </div>
          </div>
        }
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
        max-width: 440px;
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

      .form-row {
        display: grid;
        grid-template-columns: 1fr;
        gap: var(--spacing-md);
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

      .form-hint {
        font-size: 0.75rem;
      }

      .form-divider {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        margin: var(--spacing-sm) 0;
      }

      .divider-text {
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .form-divider::before,
      .form-divider::after {
        content: '';
        flex: 1;
        height: 1px;
        background: var(--color-border);
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

      /* Consent checkboxes */
      .consent-section {
        margin-top: var(--spacing-md);
        padding-top: var(--spacing-md);
        border-top: 1px solid var(--color-border);
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .consent-item {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        font-size: 0.82rem;
        line-height: 1.45;
        color: var(--color-text-secondary);
        cursor: pointer;
      }
      .consent-item input[type='checkbox'] {
        margin-top: 3px;
        flex-shrink: 0;
        accent-color: var(--color-accent-primary);
      }
      .consent-link {
        color: var(--color-accent-primary);
        font-weight: 500;
        text-decoration: underline;
        cursor: pointer;
      }
      .consent-disclaimer {
        font-size: 0.75rem;
        color: var(--color-text-muted);
        line-height: 1.5;
        margin: 4px 0 0;
        padding: 8px 12px;
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-sm);
      }
      .consent-sub {
        text-align: center;
        font-size: 0.72rem;
        color: var(--color-text-muted);
        margin: 6px 0 0;
      }

      /* Legal modal */
      .legal-overlay {
        position: fixed;
        inset: 0;
        z-index: 1000;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
      }
      .legal-modal {
        background: var(--color-bg-elevated, #fff);
        border-radius: 16px;
        max-width: 600px;
        width: 100%;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 25px 50px rgba(0, 0, 0, 0.3);
        animation: modalIn 0.2s ease;
      }
      @keyframes modalIn {
        from { opacity: 0; transform: translateY(16px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .legal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 20px 24px;
        border-bottom: 1px solid var(--color-border);
      }
      .legal-header h2 {
        font-size: 1.1rem;
        font-weight: 700;
        margin: 0;
      }
      .close-btn {
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        cursor: pointer;
        color: var(--color-text-secondary);
      }
      .close-btn:hover { background: var(--color-bg-tertiary); }
      .legal-body {
        flex: 1;
        overflow-y: auto;
        padding: 20px 24px;
        max-height: 50vh;
      }
      .legal-text {
        white-space: pre-wrap;
        word-wrap: break-word;
        font-family: inherit;
        font-size: 0.85rem;
        line-height: 1.65;
        color: var(--color-text-secondary);
        margin: 0;
      }
      .legal-footer {
        padding: 16px 24px;
        border-top: 1px solid var(--color-border);
      }
      .legal-accept-btn {
        width: 100%;
      }
      .legal-accept-btn:disabled {
        background: var(--color-bg-tertiary) !important;
        color: var(--color-text-muted) !important;
      }
    `,
  ],
})
export class RegisterComponent implements OnInit {
  @ViewChild('legalBody') legalBodyRef!: ElementRef;

  private authService = inject(AuthService);
  private http = inject(HttpClient);
  private router = inject(Router);

  name = '';
  email = '';
  password = '';
  showPassword = signal(false);
  phone = '';
  tenantName = '';
  loading = signal(false);
  error = signal<string | null>(null);

  consents = {
    terms: false,
    kvkk: false,
    explicitConsent: false,
    dpa: false,
  };

  legalDocuments = signal<Array<{ type: string; title: string; content: string }>>([]);
  legalModal = signal<{ type: string; title: string; content: string } | null>(null);
  legalScrolledToBottom = signal(false);

  ngOnInit(): void {
    this.http
      .get<{ success: boolean; data: { documents: Array<{ type: string; title: string; content: string }> } }>(
        `${environment.apiBaseUrl}/auth/legal-texts`,
      )
      .subscribe({
        next: (res) => {
          if (res.success) this.legalDocuments.set(res.data.documents);
        },
      });
  }

  allConsentsAccepted(): boolean {
    return this.consents.terms && this.consents.kvkk && this.consents.explicitConsent && this.consents.dpa;
  }

  openLegalModal(type: string): void {
    const doc = this.legalDocuments().find((d) => d.type === type);
    if (doc) {
      this.legalScrolledToBottom.set(false);
      this.legalModal.set(doc);
    }
  }

  closeLegalModal(): void {
    this.legalModal.set(null);
  }

  onLegalScroll(): void {
    if (!this.legalBodyRef) return;
    const el = this.legalBodyRef.nativeElement;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
    if (atBottom) this.legalScrolledToBottom.set(true);
  }

  acceptLegal(): void {
    const modal = this.legalModal();
    if (!modal) return;

    switch (modal.type) {
      case 'TERMS':
        this.consents.terms = true;
        break;
      case 'KVKK':
        this.consents.kvkk = true;
        break;
      case 'EXPLICIT_CONSENT':
        this.consents.explicitConsent = true;
        break;
      case 'DPA':
        this.consents.dpa = true;
        break;
    }
    this.closeLegalModal();
  }

  onSubmit(): void {
    if (!this.name || !this.email || !this.password || !this.phone || !this.tenantName) {
      this.error.set('Lütfen tüm alanları doldurun');
      return;
    }

    if (this.password.length < 8) {
      this.error.set('Şifre en az 8 karakter olmalı');
      return;
    }

    if (!this.allConsentsAccepted()) {
      this.error.set('Devam etmek için tüm sözleşmeleri kabul etmelisiniz');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    this.authService
      .register({
        name: this.name,
        email: this.email,
        password: this.password,
        phone: this.phone,
        tenantName: this.tenantName,
        consents: this.consents,
      })
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.router.navigate(['/onboarding']);
          } else {
            this.error.set(response.error?.message || 'Kayıt başarısız');
          }
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(err.error?.error?.message || 'Kayıt başarısız. Lütfen tekrar deneyin.');
          this.loading.set(false);
        },
      });
  }
}


