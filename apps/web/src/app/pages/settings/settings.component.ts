import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormGroup, FormControl, Validators } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import {
  WhatsAppConfigService,
  WhatsAppConfigDto,
  WhatsAppTestConnectionDto,
} from '../../services/whatsapp-config.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  template: `
    <div class="settings">
      <div class="settings-header">
        <h1 class="settings-title">Settings</h1>
        <p class="settings-subtitle text-secondary">
          Manage your application preferences.
        </p>
      </div>

      <div class="settings-section">
        <h2 class="section-title">General</h2>
        <div class="settings-card">
          <div class="setting-item">
            <div class="setting-info">
              <span class="setting-label">Dark Mode</span>
              <span class="setting-description text-muted">
                Enable dark mode for the application
              </span>
            </div>
            <label class="toggle">
              <input type="checkbox" checked />
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="setting-item">
            <div class="setting-info">
              <span class="setting-label">Notifications</span>
              <span class="setting-description text-muted">
                Receive email notifications
              </span>
            </div>
            <label class="toggle">
              <input type="checkbox" />
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
      </div>

      <!-- WhatsApp Integration (OWNER/ADMIN only) -->
      @if (isAdmin()) {
        <div class="settings-section">
          <h2 class="section-title">WhatsApp Integration</h2>
          <div class="settings-card">
            <!-- Connection Status Banner -->
            <div class="wa-status-banner" [ngClass]="getStatusClass()">
              <span class="status-dot"></span>
              <span class="status-text">{{ getStatusLabel() }}</span>
              @if (waConfig()?.lastVerifiedAt) {
                <span class="text-muted status-date">
                  Last verified: {{ waConfig()!.lastVerifiedAt | date:'medium' }}
                </span>
              }
              @if (waConfig()?.statusMessage) {
                <span class="text-muted status-date">
                  {{ waConfig()!.statusMessage }}
                </span>
              }
            </div>

            <!-- Webhook URL & Verify Token (shown only when config exists) -->
            @if (waConfig()) {
              <div class="setting-item column">
                <span class="setting-label">Webhook URL</span>
                <span class="setting-description text-muted">
                  Configure this URL in your Meta WhatsApp dashboard
                </span>
                <div class="copy-input">
                  <input type="text" class="setting-input mono" [value]="waConfig()!.webhookUrl" readonly />
                  <button class="btn-copy" (click)="copyToClipboard(waConfig()!.webhookUrl)">
                    {{ copyFeedback() === 'webhookUrl' ? 'Copied!' : 'Copy' }}
                  </button>
                </div>
              </div>

              <div class="setting-item column">
                <span class="setting-label">Verify Token</span>
                <span class="setting-description text-muted">
                  Paste this token in the Meta webhook configuration
                </span>
                <div class="copy-input">
                  <input type="text" class="setting-input mono" [value]="waConfig()!.webhookVerifyToken" readonly />
                  <button class="btn-copy" (click)="copyToClipboard(waConfig()!.webhookVerifyToken, 'verifyToken')">
                    {{ copyFeedback() === 'verifyToken' ? 'Copied!' : 'Copy' }}
                  </button>
                </div>
              </div>
            }

            <!-- Credentials Form -->
            <form [formGroup]="waForm" (ngSubmit)="saveConfig()">
              <div class="setting-item column">
                <span class="setting-label">Phone Number ID</span>
                <input type="text" class="setting-input" formControlName="phoneNumberId"
                       [placeholder]="waConfig()?.phoneNumberId || 'Enter Phone Number ID'" />
              </div>
              <div class="setting-item column">
                <span class="setting-label">WhatsApp Business Account ID</span>
                <input type="text" class="setting-input" formControlName="wabaId"
                       [placeholder]="waConfig()?.wabaId || 'Enter WABA ID'" />
              </div>
              <div class="setting-item column">
                <span class="setting-label">Access Token</span>
                <input type="password" class="setting-input" formControlName="accessToken"
                       [placeholder]="waConfig()?.accessTokenMasked || 'Enter Access Token'" />
              </div>
              <div class="setting-item column">
                <span class="setting-label">App Secret</span>
                <input type="password" class="setting-input" formControlName="appSecret"
                       [placeholder]="waConfig()?.appSecretMasked || 'Enter App Secret'" />
              </div>

              <!-- Action Buttons -->
              <div class="setting-item action-row">
                <div class="btn-group">
                  <button type="submit" class="btn btn-primary" [disabled]="isSaving() || waForm.invalid">
                    {{ isSaving() ? 'Saving...' : 'Save Configuration' }}
                  </button>
                  @if (waConfig()) {
                    <button type="button" class="btn btn-secondary" (click)="testConnection()" [disabled]="isTesting()">
                      {{ isTesting() ? 'Testing...' : 'Test Connection' }}
                    </button>
                    <button type="button" class="btn btn-danger" (click)="disconnectWhatsApp()">
                      Disconnect
                    </button>
                  }
                </div>
              </div>
            </form>

            <!-- Test Result -->
            @if (testResult()) {
              <div class="test-result" [ngClass]="testResult()!.success ? 'success' : 'error'">
                <p class="test-message">{{ testResult()!.message }}</p>
                @if (testResult()!.phoneNumber) {
                  <p class="test-detail">Phone: {{ testResult()!.phoneNumber }}</p>
                }
                @if (testResult()!.qualityRating) {
                  <p class="test-detail">Quality: {{ testResult()!.qualityRating }}</p>
                }
              </div>
            }

            <!-- Error Message -->
            @if (errorMessage()) {
              <div class="error-banner">{{ errorMessage() }}</div>
            }

            <!-- Integration Guide -->
            <div class="wa-guide">
              <button class="guide-toggle" (click)="guideOpen.set(!guideOpen())">
                <span class="guide-toggle-icon">{{ guideOpen() ? '▾' : '▸' }}</span>
                <h3 class="guide-title">WhatsApp Entegrasyon Rehberi</h3>
                <span class="guide-badge">{{ guideOpen() ? 'Gizle' : '5 Adim' }}</span>
              </button>

              @if (guideOpen()) {
                <div class="guide-content">
                  <!-- Step 1 -->
                  <div class="guide-step">
                    <div class="step-header">
                      <span class="step-number">1</span>
                      <span class="step-title">Meta Developer Hesabi ve Uygulama Olusturma</span>
                    </div>
                    <div class="step-body">
                      <ol class="step-list">
                        <li><a href="https://developers.facebook.com" target="_blank" rel="noopener">developers.facebook.com</a> adresine gidin ve giris yapin.</li>
                        <li>Sag ustteki <strong>"My Apps"</strong> butonuna tiklayin.</li>
                        <li><strong>"Create App"</strong> &rarr; <strong>"Other"</strong> &rarr; <strong>"Business"</strong> secin.</li>
                        <li>Uygulama adini girin (ornegin: <code>Restoran WhatsApp</code>) ve olusturun.</li>
                        <li>Uygulama sayfasinda <strong>"Add Product"</strong> bolumunden <strong>WhatsApp</strong> butonuna tiklayin ve <strong>"Set Up"</strong> deyin.</li>
                      </ol>
                    </div>
                  </div>

                  <!-- Step 2 -->
                  <div class="guide-step">
                    <div class="step-header">
                      <span class="step-number">2</span>
                      <span class="step-title">Phone Number ID ve WABA ID Bilgilerini Alma</span>
                    </div>
                    <div class="step-body">
                      <ol class="step-list">
                        <li>Sol menuden <strong>WhatsApp &rarr; API Setup</strong> sayfasina gidin.</li>
                        <li><strong>"From"</strong> alaninda test telefon numaranizi secin.</li>
                        <li>Sayfada gosterilen <strong>Phone Number ID</strong> degerini kopyalayin ve yukaridaki alana yapiştirin.</li>
                        <li><strong>WhatsApp Business Account ID</strong> icin: sol menuden <strong>WhatsApp &rarr; Configuration</strong> sayfasina gidin, URL'deki <code>waba_id=XXXX</code> degerini veya sayfadaki WABA ID'yi kopyalayin.</li>
                      </ol>
                      <div class="step-tip">
                        <span class="tip-icon">💡</span>
                        <span>Production icin kendi telefon numaranizi eklemek isterseniz <strong>"Add phone number"</strong> butonunu kullanin.</span>
                      </div>
                    </div>
                  </div>

                  <!-- Step 3 -->
                  <div class="guide-step highlight">
                    <div class="step-header">
                      <span class="step-number">3</span>
                      <span class="step-title">Kalici Access Token Olusturma (Onemli!)</span>
                    </div>
                    <div class="step-body">
                      <div class="step-warning">
                        <span class="warning-icon">⚠️</span>
                        <span>API Setup sayfasindaki gecici token <strong>24 saat</strong> sonra gecersiz olur. Asagidaki adimlari takip ederek kalici token olusturun.</span>
                      </div>
                      <ol class="step-list">
                        <li><a href="https://business.facebook.com/settings" target="_blank" rel="noopener">business.facebook.com/settings</a> adresine gidin.</li>
                        <li>Sol menuden <strong>Kullanicilar &rarr; Sistem Kullanicilari</strong> (Users &rarr; System Users) sayfasina gidin.</li>
                        <li><strong>"Ekle"</strong> (Add) butonuna basin. Isim girin (ornegin: <code>whatres-api</code>), rol olarak <strong>Admin</strong> secin.</li>
                        <li>Olusturulan sistem kullanicisina tiklayin &rarr; <strong>"Varlik Ekle"</strong> (Add Assets) butonuna basin.</li>
                        <li>
                          Asagidaki varliklari ekleyin:
                          <ul class="step-sublist">
                            <li><strong>Uygulamalar</strong> (Apps) &rarr; WhatsApp uygulamanizi secin &rarr; <strong>Tam Kontrol</strong> (Full Control)</li>
                            <li><strong>WhatsApp Hesaplari</strong> (WhatsApp Accounts) &rarr; WABA hesabinizi secin &rarr; <strong>Tam Kontrol</strong></li>
                          </ul>
                        </li>
                        <li><strong>"Token Olustur"</strong> (Generate Token) butonuna basin.</li>
                        <li>Uygulamanizi secin ve su izinleri (permissions) ekleyin:
                          <ul class="step-sublist">
                            <li><code>whatsapp_business_messaging</code></li>
                            <li><code>whatsapp_business_management</code></li>
                          </ul>
                        </li>
                        <li>Olusturulan tokeni kopyalayin ve yukaridaki <strong>Access Token</strong> alanina yapiştirin.</li>
                      </ol>
                      <div class="step-tip success">
                        <span class="tip-icon">✅</span>
                        <span>Bu token <strong>asla expire olmaz</strong>. Bir kez olusturup kullanabilirsiniz.</span>
                      </div>
                    </div>
                  </div>

                  <!-- Step 4 -->
                  <div class="guide-step">
                    <div class="step-header">
                      <span class="step-number">4</span>
                      <span class="step-title">App Secret Bilgisini Alma</span>
                    </div>
                    <div class="step-body">
                      <ol class="step-list">
                        <li><a href="https://developers.facebook.com" target="_blank" rel="noopener">developers.facebook.com</a> &rarr; uygulamaniza gidin.</li>
                        <li>Sol menuden <strong>Settings &rarr; Basic</strong> sayfasina gidin.</li>
                        <li><strong>App Secret</strong> alaninda <strong>"Show"</strong> butonuna tiklayin.</li>
                        <li>Gosterilen degeri kopyalayin ve yukaridaki <strong>App Secret</strong> alanina yapiştirin.</li>
                      </ol>
                      <div class="step-tip">
                        <span class="tip-icon">🔒</span>
                        <span>App Secret, webhook mesajlarinin dogrulanmasi icin kullanilir. Kimseyle paylaşmayin.</span>
                      </div>
                    </div>
                  </div>

                  <!-- Step 5 -->
                  <div class="guide-step">
                    <div class="step-header">
                      <span class="step-number">5</span>
                      <span class="step-title">Webhook Yapilandirmasi</span>
                    </div>
                    <div class="step-body">
                      <ol class="step-list">
                        <li>Yukaridaki tum bilgileri girdikten sonra <strong>"Save Configuration"</strong> butonuna basin.</li>
                        <li>Kayit basarili oldugunda sayfada <strong>Webhook URL</strong> ve <strong>Verify Token</strong> gosterilecek.</li>
                        <li>Meta Developer sayfanizda <strong>WhatsApp &rarr; Configuration</strong> bolumune gidin.</li>
                        <li><strong>"Edit"</strong> butonuna tiklayin:
                          <ul class="step-sublist">
                            <li><strong>Callback URL</strong> alanina yukaridaki <em>Webhook URL</em>'yi yapiştirin.</li>
                            <li><strong>Verify Token</strong> alanina yukaridaki <em>Verify Token</em>'i yapiştirin.</li>
                          </ul>
                        </li>
                        <li><strong>"Verify and Save"</strong> butonuna basin.</li>
                        <li>Webhook alanlari bolumunde <strong>"messages"</strong> alaninin yanindaki <strong>Subscribe</strong> kutusunu isaretleyin.</li>
                      </ol>
                      <div class="step-tip success">
                        <span class="tip-icon">🎉</span>
                        <span>Tebrikler! Entegrasyon tamamlandi. <strong>"Test Connection"</strong> butonuyla baglantinizi dogrulayin.</span>
                      </div>
                    </div>
                  </div>
                </div>
              }
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .settings { max-width: 800px; margin: 0 auto; }
      .settings-header { margin-bottom: var(--spacing-xl); }
      .settings-title { font-size: 2rem; font-weight: 700; letter-spacing: -0.02em; margin-bottom: var(--spacing-xs); }
      .settings-section { margin-bottom: var(--spacing-xl); }
      .section-title { font-size: 1rem; font-weight: 600; color: var(--color-text-secondary); margin-bottom: var(--spacing-md); text-transform: uppercase; letter-spacing: 0.05em; }
      .settings-card { background: var(--color-bg-secondary); border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; }
      .setting-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--spacing-lg);
        border-bottom: 1px solid var(--color-border);
        &:last-child { border-bottom: none; }

        &.column { flex-direction: column; align-items: flex-start; gap: var(--spacing-sm); }
        &.action-row { justify-content: flex-start; }
      }
      .setting-info { display: flex; flex-direction: column; gap: var(--spacing-xs); }
      .setting-label { font-weight: 500; }
      .setting-description { font-size: 0.875rem; }
      .setting-input {
        width: 100%;
        padding: var(--spacing-sm) var(--spacing-md);
        background: var(--color-bg-tertiary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        color: var(--color-text-primary);
        font-size: 0.875rem;
        &:focus { outline: none; border-color: var(--color-accent-primary); }
        &.mono { font-family: var(--font-mono); font-size: 0.8125rem; }
      }
      .toggle { position: relative; display: inline-block; width: 48px; height: 26px; cursor: pointer; }
      .toggle input { opacity: 0; width: 0; height: 0; }
      .toggle-slider {
        position: absolute; inset: 0; background: var(--color-bg-tertiary); border-radius: 26px; transition: var(--transition-fast);
        &::before { content: ''; position: absolute; height: 20px; width: 20px; left: 3px; bottom: 3px; background: white; border-radius: 50%; transition: var(--transition-fast); }
      }
      .toggle input:checked + .toggle-slider { background: var(--color-accent-primary); }
      .toggle input:checked + .toggle-slider::before { transform: translateX(22px); }

      .wa-status-banner {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-md) var(--spacing-lg);
        border-bottom: 1px solid var(--color-border);
        font-size: 0.875rem;
      }
      .status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
      .status-text { font-weight: 500; }
      .wa-status-banner.disconnected .status-dot { background: var(--color-text-secondary); }
      .wa-status-banner.pending .status-dot { background: #f59e0b; }
      .wa-status-banner.connected .status-dot { background: #10b981; }
      .wa-status-banner.error .status-dot { background: #ef4444; }
      .copy-input { display: flex; width: 100%; gap: var(--spacing-sm); }
      .copy-input .setting-input { flex: 1; }
      .btn-copy {
        padding: var(--spacing-sm) var(--spacing-md);
        background: var(--color-bg-tertiary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        color: var(--color-text-primary);
        cursor: pointer;
        font-size: 0.8125rem;
        white-space: nowrap;
        &:hover { background: var(--color-border); }
      }
      .btn-group { display: flex; gap: var(--spacing-sm); flex-wrap: wrap; }
      .btn {
        padding: var(--spacing-sm) var(--spacing-lg);
        border: none;
        border-radius: var(--radius-md);
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        &:disabled { opacity: 0.5; cursor: not-allowed; }
      }
      .btn-primary { background: var(--color-accent-primary); color: white; &:hover:not(:disabled) { opacity: 0.9; } }
      .btn-secondary { background: var(--color-bg-tertiary); color: var(--color-text-primary); border: 1px solid var(--color-border); &:hover:not(:disabled) { background: var(--color-border); } }
      .btn-danger { background: transparent; color: #ef4444; border: 1px solid #ef4444; &:hover:not(:disabled) { background: rgba(239, 68, 68, 0.1); } }
      .test-result {
        padding: var(--spacing-md) var(--spacing-lg);
        border-bottom: 1px solid var(--color-border);
        font-size: 0.875rem;
        &.success { background: rgba(16, 185, 129, 0.1); border-left: 3px solid #10b981; }
        &.error { background: rgba(239, 68, 68, 0.1); border-left: 3px solid #ef4444; }
      }
      .test-message { font-weight: 500; margin-bottom: var(--spacing-xs); }
      .test-detail { color: var(--color-text-secondary); font-size: 0.8125rem; }
      .error-banner { padding: var(--spacing-md) var(--spacing-lg); background: rgba(239, 68, 68, 0.1); color: #ef4444; font-size: 0.875rem; }
      /* Guide Section */
      .wa-guide { border-top: 1px solid var(--color-border); }
      .guide-toggle {
        display: flex; align-items: center; gap: var(--spacing-sm); width: 100%;
        padding: var(--spacing-md) var(--spacing-lg); background: none; border: none;
        color: var(--color-text-primary); cursor: pointer; text-align: left;
        &:hover { background: var(--color-bg-tertiary); }
      }
      .guide-toggle-icon { font-size: 0.75rem; color: var(--color-text-secondary); width: 16px; }
      .guide-title { font-size: 0.9375rem; font-weight: 600; flex: 1; margin: 0; }
      .guide-badge {
        font-size: 0.6875rem; font-weight: 500; padding: 2px 8px;
        background: var(--color-accent-primary); color: white; border-radius: 10px;
      }
      .guide-content { padding: 0 var(--spacing-lg) var(--spacing-lg); }

      /* Guide Steps */
      .guide-step {
        border: 1px solid var(--color-border); border-radius: var(--radius-md);
        margin-bottom: var(--spacing-sm); overflow: hidden;
        &.highlight { border-color: #f59e0b; }
      }
      .step-header {
        display: flex; align-items: center; gap: var(--spacing-md);
        padding: var(--spacing-md) var(--spacing-lg);
        background: var(--color-bg-tertiary);
      }
      .step-number {
        display: flex; align-items: center; justify-content: center;
        width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;
        background: var(--color-accent-primary); color: white;
        font-size: 0.8125rem; font-weight: 700;
      }
      .guide-step.highlight .step-number { background: #f59e0b; }
      .step-title { font-size: 0.875rem; font-weight: 600; }
      .step-body { padding: var(--spacing-md) var(--spacing-lg); }
      .step-list {
        padding-left: var(--spacing-lg); font-size: 0.8125rem;
        color: var(--color-text-secondary); line-height: 1.7;
        display: flex; flex-direction: column; gap: 6px;
      }
      .step-list a { color: var(--color-accent-primary); text-decoration: none; &:hover { text-decoration: underline; } }
      .step-list code {
        background: var(--color-bg-tertiary); padding: 2px 6px; border-radius: 4px;
        font-family: var(--font-mono); font-size: 0.75rem;
      }
      .step-list strong { color: var(--color-text-primary); }
      .step-sublist {
        padding-left: var(--spacing-lg); margin-top: 4px;
        list-style-type: disc; display: flex; flex-direction: column; gap: 4px;
      }
      .step-warning {
        display: flex; align-items: flex-start; gap: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-md); margin-bottom: var(--spacing-md);
        background: rgba(245, 158, 11, 0.1); border-left: 3px solid #f59e0b;
        border-radius: var(--radius-sm); font-size: 0.8125rem; color: var(--color-text-secondary); line-height: 1.5;
      }
      .warning-icon, .tip-icon { flex-shrink: 0; }
      .step-tip {
        display: flex; align-items: flex-start; gap: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-md); margin-top: var(--spacing-md);
        background: var(--color-bg-tertiary); border-radius: var(--radius-sm);
        font-size: 0.8125rem; color: var(--color-text-secondary); line-height: 1.5;
        &.success { background: rgba(16, 185, 129, 0.1); }
      }
    `,
  ],
})
export class SettingsComponent implements OnInit {
  private authService = inject(AuthService);
  private waConfigService = inject(WhatsAppConfigService);

  isAdmin = this.authService.isAdmin;

  waConfig = signal<WhatsAppConfigDto | null>(null);
  isLoading = signal(false);
  isSaving = signal(false);
  isTesting = signal(false);
  testResult = signal<WhatsAppTestConnectionDto | null>(null);
  errorMessage = signal<string | null>(null);
  copyFeedback = signal<string | null>(null);
  guideOpen = signal(false);

  waForm = new FormGroup({
    phoneNumberId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    wabaId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    accessToken: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    appSecret: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  ngOnInit() {
    if (this.isAdmin()) {
      this.loadConfig();
    }
  }

  loadConfig() {
    this.isLoading.set(true);
    this.waConfigService.getConfig().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.waConfig.set(res.data);
          this.waForm.patchValue({
            phoneNumberId: res.data.phoneNumberId,
            wabaId: res.data.wabaId,
            accessToken: '',
            appSecret: '',
          });
        }
        this.isLoading.set(false);
      },
      error: (err) => {
        this.errorMessage.set('Failed to load WhatsApp configuration');
        this.isLoading.set(false);
      },
    });
  }

  saveConfig() {
    if (this.waForm.invalid) return;

    this.isSaving.set(true);
    this.errorMessage.set(null);
    this.testResult.set(null);

    const formValue = this.waForm.getRawValue();
    this.waConfigService.saveConfig(formValue).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.waConfig.set(res.data);
          this.waForm.patchValue({ accessToken: '', appSecret: '' });
        }
        this.isSaving.set(false);
      },
      error: (err) => {
        this.errorMessage.set(err.error?.error?.message || 'Failed to save configuration');
        this.isSaving.set(false);
      },
    });
  }

  testConnection() {
    this.isTesting.set(true);
    this.testResult.set(null);
    this.errorMessage.set(null);

    this.waConfigService.testConnection().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.testResult.set(res.data);
          // Reload config to get updated status
          this.loadConfig();
        }
        this.isTesting.set(false);
      },
      error: (err) => {
        this.errorMessage.set(err.error?.error?.message || 'Connection test failed');
        this.isTesting.set(false);
      },
    });
  }

  disconnectWhatsApp() {
    if (!confirm('Are you sure you want to disconnect WhatsApp? This will remove your configuration.')) {
      return;
    }

    this.waConfigService.deleteConfig().subscribe({
      next: () => {
        this.waConfig.set(null);
        this.testResult.set(null);
        this.waForm.reset();
      },
      error: (err) => {
        this.errorMessage.set(err.error?.error?.message || 'Failed to disconnect');
      },
    });
  }

  copyToClipboard(value: string, key = 'webhookUrl') {
    navigator.clipboard.writeText(value).then(() => {
      this.copyFeedback.set(key);
      setTimeout(() => this.copyFeedback.set(null), 2000);
    });
  }

  getStatusClass(): string {
    const status = this.waConfig()?.connectionStatus;
    if (!status) return 'disconnected';
    return status.toLowerCase();
  }

  getStatusLabel(): string {
    const status = this.waConfig()?.connectionStatus;
    switch (status) {
      case 'CONNECTED': return 'Connected';
      case 'PENDING': return 'Pending Verification';
      case 'ERROR': return 'Error';
      default: return 'Not Connected';
    }
  }
}
