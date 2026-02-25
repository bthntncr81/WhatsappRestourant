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

            <!-- How to get credentials guide -->
            <div class="wa-guide">
              <h3 class="guide-title">Bu bilgileri nereden alabilirim?</h3>
              <ol class="guide-steps">
                <li>
                  <strong>Meta for Developers</strong> hesabi olusturun:
                  <a href="https://developers.facebook.com" target="_blank" rel="noopener">developers.facebook.com</a>
                </li>
                <li>
                  Yeni bir uygulama olusturun ve <strong>WhatsApp</strong> urununu ekleyin.
                </li>
                <li>
                  <strong>Phone Number ID</strong> ve <strong>WhatsApp Business Account ID</strong> bilgilerini
                  <em>WhatsApp &gt; API Setup</em> sayfasindan bulabilirsiniz.
                </li>
                <li>
                  <strong>Permanent Access Token</strong> olusturmak icin
                  <em>System Users</em> sayfasina gidin, bir system user olusturup
                  <code>whatsapp_business_messaging</code> iznini verin ve token uretin.
                </li>
                <li>
                  <strong>App Secret</strong> bilgisini uygulamanizin
                  <em>Settings &gt; Basic</em> sayfasinda bulabilirsiniz.
                </li>
                <li>
                  Yukaridaki bilgileri girdikten sonra <strong>Save Configuration</strong> butonuna basin,
                  ardindan gosterilen <strong>Webhook URL</strong> ve <strong>Verify Token</strong> degerlerini
                  Meta dashboard'da <em>WhatsApp &gt; Configuration &gt; Webhook</em> bolumune yapiştirin.
                </li>
              </ol>
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
      .wa-guide { padding: var(--spacing-lg); border-top: 1px solid var(--color-border); }
      .guide-title { font-size: 0.9375rem; font-weight: 600; margin-bottom: var(--spacing-md); }
      .guide-steps { padding-left: var(--spacing-lg); font-size: 0.8125rem; color: var(--color-text-secondary); display: flex; flex-direction: column; gap: var(--spacing-sm); line-height: 1.6; }
      .guide-steps a { color: var(--color-accent-primary); text-decoration: none; &:hover { text-decoration: underline; } }
      .guide-steps code { background: var(--color-bg-tertiary); padding: 2px 6px; border-radius: 4px; font-family: var(--font-mono); font-size: 0.75rem; }
      .guide-steps strong { color: var(--color-text-primary); }
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
