import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule, ReactiveFormsModule, FormGroup, FormControl, Validators } from '@angular/forms';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../services/auth.service';
import {
  WhatsAppConfigService,
  WhatsAppConfigDto,
  WhatsAppTestConnectionDto,
} from '../../services/whatsapp-config.service';
import { MenuMediaService, MenuMediaDto } from '../../services/menu-media.service';
import {
  PosConfigService,
  PosConfigDto,
  PosTestConnectionDto as PosTestResult,
  PosMenuSyncResultDto,
} from '../../services/pos-config.service';
import { IconComponent } from '../../shared/icon.component';
import { DialogService } from '../../shared/dialog.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, IconComponent],
  template: `
    <div class="settings">
      <div class="settings-header">
        <h1 class="settings-title">Ayarlar</h1>
        <p class="settings-subtitle text-secondary">
          Uygulama tercihlerinizi yönetin.
        </p>
      </div>

      <div class="settings-section">
        <h2 class="section-title">Genel</h2>
        <div class="settings-card">
          <div class="setting-item">
            <div class="setting-info">
              <span class="setting-label">Koyu Tema</span>
              <span class="setting-description text-muted">
                Uygulama için koyu temayı etkinleştirin
              </span>
            </div>
            <label class="toggle">
              <input type="checkbox" checked />
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="setting-item">
            <div class="setting-info">
              <span class="setting-label">Bildirimler</span>
              <span class="setting-description text-muted">
                E-posta bildirimleri alın
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
          <h2 class="section-title">WhatsApp Entegrasyonu</h2>
          <div class="settings-card">
            <!-- Connection Status Banner -->
            <div class="wa-status-banner" [ngClass]="getStatusClass()">
              <span class="status-dot"></span>
              <span class="status-text">{{ getStatusLabel() }}</span>
              @if (waConfig()?.lastVerifiedAt) {
                <span class="text-muted status-date">
                  Son doğrulama: {{ waConfig()!.lastVerifiedAt | date:'medium' }}
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
                  Bu URL'yi Meta WhatsApp panelinde yapılandırın
                </span>
                <div class="copy-input">
                  <input type="text" class="setting-input mono" [value]="waConfig()!.webhookUrl" readonly />
                  <button class="btn-copy" (click)="copyToClipboard(waConfig()!.webhookUrl)">
                    {{ copyFeedback() === 'webhookUrl' ? 'Kopyalandı!' : 'Kopyala' }}
                  </button>
                </div>
              </div>

              <div class="setting-item column">
                <span class="setting-label">Doğrulama Anahtarı</span>
                <span class="setting-description text-muted">
                  Bu anahtarı Meta webhook yapılandırmasına yapıştırın
                </span>
                <div class="copy-input">
                  <input type="text" class="setting-input mono" [value]="waConfig()!.webhookVerifyToken" readonly />
                  <button class="btn-copy" (click)="copyToClipboard(waConfig()!.webhookVerifyToken, 'verifyToken')">
                    {{ copyFeedback() === 'verifyToken' ? 'Kopyalandı!' : 'Kopyala' }}
                  </button>
                </div>
              </div>
            }

            <!-- Credentials Form -->
            <form [formGroup]="waForm" (ngSubmit)="saveConfig()">
              <div class="setting-item column">
                <span class="setting-label">Phone Number ID</span>
                <input type="text" class="setting-input" formControlName="phoneNumberId"
                       [placeholder]="waConfig()?.phoneNumberId || 'Telefon Numarası ID girin'" />
              </div>
              <div class="setting-item column">
                <span class="setting-label">WhatsApp Business Account ID</span>
                <input type="text" class="setting-input" formControlName="wabaId"
                       [placeholder]="waConfig()?.wabaId || 'WABA ID girin'" />
              </div>
              <div class="setting-item column">
                <span class="setting-label">Access Token</span>
                <input type="password" class="setting-input" formControlName="accessToken"
                       [placeholder]="waConfig()?.accessTokenMasked || 'Erişim Anahtarı girin'" />
              </div>
              <div class="setting-item column">
                <span class="setting-label">App Secret</span>
                <input type="password" class="setting-input" formControlName="appSecret"
                       [placeholder]="waConfig()?.appSecretMasked || 'Uygulama Gizli Anahtarı girin'" />
              </div>

              <!-- Action Buttons -->
              <div class="setting-item action-row">
                <div class="btn-group">
                  <button type="submit" class="btn btn-primary" [disabled]="isSaving() || waForm.invalid">
                    {{ isSaving() ? 'Kaydediliyor...' : 'Yapılandırmayı Kaydet' }}
                  </button>
                  @if (waConfig()) {
                    <button type="button" class="btn btn-secondary" (click)="testConnection()" [disabled]="isTesting()">
                      {{ isTesting() ? 'Test ediliyor...' : 'Bağlantıyı Test Et' }}
                    </button>
                    <button type="button" class="btn btn-secondary" (click)="subscribeWebhook()" [disabled]="isSubscribing()">
                      {{ isSubscribing() ? 'Etkinleştiriliyor...' : 'Webhook\\'u Etkinleştir' }}
                    </button>
                    <button type="button" class="btn btn-danger" (click)="disconnectWhatsApp()">
                      Bağlantıyı Kes
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
                  <p class="test-detail">Telefon: {{ testResult()!.phoneNumber }}</p>
                }
                @if (testResult()!.qualityRating) {
                  <p class="test-detail">Kalite: {{ testResult()!.qualityRating }}</p>
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
                <span class="guide-toggle-icon">
                  @if (guideOpen()) {
                    <app-icon name="chevron-down" [size]="14"/>
                  } @else {
                    <app-icon name="chevron-right" [size]="14"/>
                  }
                </span>
                <h3 class="guide-title">WhatsApp Entegrasyon Rehberi</h3>
                <span class="guide-badge">{{ guideOpen() ? 'Gizle' : '5 Adım' }}</span>
              </button>

              @if (guideOpen()) {
                <div class="guide-content">
                  <!-- Step 1 -->
                  <div class="guide-step">
                    <div class="step-header">
                      <span class="step-number">1</span>
                      <span class="step-title">Meta Developer Hesabı ve Uygulama Oluşturma</span>
                    </div>
                    <div class="step-body">
                      <ol class="step-list">
                        <li><a href="https://developers.facebook.com" target="_blank" rel="noopener">developers.facebook.com</a> adresine gidin ve giriş yapın.</li>
                        <li>Sağ üstteki <strong>"My Apps"</strong> butonuna tıklayın.</li>
                        <li><strong>"Create App"</strong> &rarr; <strong>"Other"</strong> &rarr; <strong>"Business"</strong> seçin.</li>
                        <li>Uygulama adını girin (örneğin: <code>Restoran WhatsApp</code>) ve oluşturun.</li>
                        <li>Uygulama sayfasında <strong>"Add Product"</strong> bölümünden <strong>WhatsApp</strong> butonuna tıklayın ve <strong>"Set Up"</strong> deyin.</li>
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
                        <li>Sol menüden <strong>WhatsApp &rarr; API Setup</strong> sayfasına gidin.</li>
                        <li><strong>"From"</strong> alanında test telefon numaranızı seçin.</li>
                        <li>Sayfada gösterilen <strong>Phone Number ID</strong> değerini kopyalayın ve yukarıdaki alana yapıştırın.</li>
                        <li><strong>WhatsApp Business Account ID</strong> için: sol menüden <strong>WhatsApp &rarr; Configuration</strong> sayfasına gidin, URL'deki <code>waba_id=XXXX</code> değerini veya sayfadaki WABA ID'yi kopyalayın.</li>
                      </ol>
                      <div class="step-tip">
                        <span class="tip-icon"><app-icon name="lightbulb" [size]="16"/></span>
                        <span>Production için kendi telefon numaranızı eklemek isterseniz <strong>"Add phone number"</strong> butonunu kullanın.</span>
                      </div>
                    </div>
                  </div>

                  <!-- Step 3 -->
                  <div class="guide-step highlight">
                    <div class="step-header">
                      <span class="step-number">3</span>
                      <span class="step-title">Kalıcı Access Token Oluşturma (Önemli!)</span>
                    </div>
                    <div class="step-body">
                      <div class="step-warning">
                        <span class="warning-icon"><app-icon name="alert-triangle" [size]="16"/></span>
                        <span>API Setup sayfasındaki geçici token <strong>24 saat</strong> sonra geçersiz olur. Aşağıdaki adımları takip ederek kalıcı token oluşturun.</span>
                      </div>
                      <ol class="step-list">
                        <li><a href="https://business.facebook.com/settings" target="_blank" rel="noopener">business.facebook.com/settings</a> adresine gidin.</li>
                        <li>Sol menüden <strong>Kullanıcılar &rarr; Sistem Kullanıcıları</strong> (Users &rarr; System Users) sayfasına gidin.</li>
                        <li><strong>"Ekle"</strong> (Add) butonuna basın. İsim girin (örneğin: <code>otorder-api</code>), rol olarak <strong>Admin</strong> seçin.</li>
                        <li>Oluşturulan sistem kullanıcısına tıklayın &rarr; <strong>"Varlık Ekle"</strong> (Add Assets) butonuna basın.</li>
                        <li>
                          Asagidaki varliklari ekleyin:
                          <ul class="step-sublist">
                            <li><strong>Uygulamalar</strong> (Apps) &rarr; WhatsApp uygulamanızı seçin &rarr; <strong>Tam Kontrol</strong> (Full Control)</li>
                            <li><strong>WhatsApp Hesapları</strong> (WhatsApp Accounts) &rarr; WABA hesabınızı seçin &rarr; <strong>Tam Kontrol</strong></li>
                          </ul>
                        </li>
                        <li><strong>"Token Oluştur"</strong> (Generate Token) butonuna basın.</li>
                        <li>Uygulamanızı seçin ve şu izinleri (permissions) ekleyin:
                          <ul class="step-sublist">
                            <li><code>whatsapp_business_messaging</code></li>
                            <li><code>whatsapp_business_management</code></li>
                          </ul>
                        </li>
                        <li>Oluşturulan tokeni kopyalayın ve yukarıdaki <strong>Access Token</strong> alanına yapıştırın.</li>
                      </ol>
                      <div class="step-tip success">
                        <span class="tip-icon"><app-icon name="check-circle" [size]="16"/></span>
                        <span>Bu token <strong>asla expire olmaz</strong>. Bir kez oluşturup kullanabilirsiniz.</span>
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
                        <li><a href="https://developers.facebook.com" target="_blank" rel="noopener">developers.facebook.com</a> &rarr; uygulamanıza gidin.</li>
                        <li>Sol menüden <strong>Settings &rarr; Basic</strong> sayfasına gidin.</li>
                        <li><strong>App Secret</strong> alanında <strong>"Show"</strong> butonuna tıklayın.</li>
                        <li>Gösterilen değeri kopyalayın ve yukarıdaki <strong>App Secret</strong> alanına yapıştırın.</li>
                      </ol>
                      <div class="step-tip">
                        <span class="tip-icon"><app-icon name="lock" [size]="16"/></span>
                        <span>App Secret, webhook mesajlarının doğrulanması için kullanılır. Kimseyle paylaşmayın.</span>
                      </div>
                    </div>
                  </div>

                  <!-- Step 5 -->
                  <div class="guide-step">
                    <div class="step-header">
                      <span class="step-number">5</span>
                      <span class="step-title">Webhook Yapılandırması</span>
                    </div>
                    <div class="step-body">
                      <ol class="step-list">
                        <li>Yukarıdaki tüm bilgileri girdikten sonra <strong>"Save Configuration"</strong> butonuna basın.</li>
                        <li>Kayıt başarılı olduğunda sayfada <strong>Webhook URL</strong> ve <strong>Verify Token</strong> gösterilecek.</li>
                        <li>Meta Developer sayfanızda <strong>WhatsApp &rarr; Configuration</strong> bölümüne gidin.</li>
                        <li><strong>"Edit"</strong> butonuna tıklayın:
                          <ul class="step-sublist">
                            <li><strong>Callback URL</strong> alanına yukarıdaki <em>Webhook URL</em>'yi yapıştırın.</li>
                            <li><strong>Verify Token</strong> alanına yukarıdaki <em>Verify Token</em>'i yapıştırın.</li>
                          </ul>
                        </li>
                        <li><strong>"Verify and Save"</strong> butonuna basın.</li>
                        <li>Webhook alanları bölümünde <strong>"messages"</strong> alanının yanındaki <strong>Subscribe</strong> kutusunu işaretleyin.</li>
                      </ol>
                      <div class="step-tip success">
                        <span class="tip-icon"><app-icon name="party-popper" [size]="16"/></span>
                        <span>Tebrikler! Entegrasyon tamamlandı. <strong>"Test Connection"</strong> butonuyla bağlantınızı doğrulayın.</span>
                      </div>
                    </div>
                  </div>
                </div>
              }
            </div>
          </div>
        </div>

        <!-- POS Integration -->
        <div class="settings-section">
          <h2 class="section-title">POS Menü Entegrasyonu</h2>
          <div class="settings-card">
            <!-- Connection Status Banner -->
            <div class="wa-status-banner" [ngClass]="posConfig()?.isConfigured ? 'connected' : 'disconnected'">
              <span class="status-dot"></span>
              <span class="status-text">{{ posConfig()?.isConfigured ? 'Bağlı' : 'Bağlı Değil' }}</span>
              @if (posConfig()?.lastMenuSync) {
                <span class="text-muted status-date">
                  Son sync: {{ posConfig()!.lastMenuSync | date:'medium' }}
                </span>
              }
            </div>

            <!-- Webhook URL (shown only when config exists) -->
            @if (posConfig()?.isConfigured) {
              <div class="setting-item column">
                <span class="setting-label">Webhook URL</span>
                <span class="setting-description text-muted">
                  POS sisteminizde bu URL'yi webhook olarak tanımlayabilirsiniz
                </span>
                <div class="copy-input">
                  <input type="text" class="setting-input mono" [value]="posConfig()!.webhookUrl" readonly />
                  <button class="btn-copy" (click)="copyToClipboard(posConfig()!.webhookUrl, 'posWebhook')">
                    {{ copyFeedback() === 'posWebhook' ? 'Kopyalandı!' : 'Kopyala' }}
                  </button>
                </div>
              </div>
            }

            <!-- OtOrder tek-tik baglanti -->
            <div class="setting-item column otorder-connect">
              <span class="setting-label">OtOrder'a Bağla</span>
              <span class="setting-description text-muted">
                OtOrder hesabınızla giriş yapın; API anahtarı otomatik oluşturulur ve menünüz senkronlanır.
              </span>
              <form [formGroup]="otorderForm" (ngSubmit)="connectOtorder()" class="otorder-form">
                <div class="otorder-row">
                  <input type="text" class="setting-input" formControlName="subdomain" placeholder="restoraniniz" />
                  <span class="otorder-suffix">.otorder.com</span>
                </div>
                <input type="email" class="setting-input" formControlName="email" placeholder="OtOrder e-postanız" />
                <input type="password" class="setting-input" formControlName="password" placeholder="OtOrder şifreniz" autocomplete="off" />
                <button type="submit" class="btn btn-primary" [disabled]="isOtorderConnecting() || otorderForm.invalid">
                  {{ isOtorderConnecting() ? 'Bağlanıyor...' : 'OtOrder ile Bağlan' }}
                </button>
              </form>
              @if (otorderResult()) {
                <div class="test-result success">
                  <p class="test-message">✓ {{ otorderResult()!.subdomain }}.otorder.com bağlandı</p>
                  @if (otorderResult()!.sync) {
                    <p class="test-detail">
                      Menü senkronu: {{ otorderResult()!.sync!.categoriesFound || 0 }} kategori,
                      {{ otorderResult()!.sync!.itemsCreated || 0 }} ürün
                    </p>
                  }
                </div>
              }
              @if (otorderError()) {
                <div class="error-banner">{{ otorderError() }}</div>
              }
              <span class="setting-description text-muted otorder-divider">veya API bilgilerini elle girin:</span>
            </div>

            <!-- POS Credentials Form -->
            <form [formGroup]="posForm" (ngSubmit)="savePosConfig()">
              <div class="setting-item column">
                <span class="setting-label">API URL</span>
                <span class="setting-description text-muted">
                  POS sisteminizin API adresi
                </span>
                <input type="text" class="setting-input" formControlName="apiUrl"
                       [placeholder]="posConfig()?.apiUrl || 'https://api.posmenunuz.com'" />
              </div>
              <div class="setting-item column">
                <span class="setting-label">API Key</span>
                <input type="password" class="setting-input" formControlName="apiKey"
                       [placeholder]="posConfig()?.apiKey || 'API anahtarinizi girin'" />
              </div>
              <div class="setting-item column">
                <span class="setting-label">Location ID <span class="text-muted">(opsiyonel)</span></span>
                <input type="text" class="setting-input" formControlName="locationId"
                       [placeholder]="posConfig()?.locationId || 'Birden fazla sube varsa giriniz'" />
              </div>

              <!-- Action Buttons -->
              <div class="setting-item action-row">
                <div class="btn-group">
                  <button type="submit" class="btn btn-primary" [disabled]="isPosSaving() || posForm.invalid">
                    {{ isPosSaving() ? 'Kaydediliyor...' : 'Kaydet' }}
                  </button>
                  @if (posConfig()?.isConfigured) {
                    <button type="button" class="btn btn-secondary" (click)="testPosConnection()" [disabled]="isPosTesting()">
                      {{ isPosTesting() ? 'Test ediliyor...' : 'Baglantiyi Test Et' }}
                    </button>
                    <button type="button" class="btn btn-secondary" (click)="syncPosMenu()" [disabled]="isPosSyncing()">
                      {{ isPosSyncing() ? 'Senkronize ediliyor...' : 'Menuyu Senkronize Et' }}
                    </button>
                  }
                </div>
              </div>
            </form>

            <!-- POS Test Result -->
            @if (posTestResult()) {
              <div class="test-result" [ngClass]="posTestResult()!.connected ? 'success' : 'error'">
                <p class="test-message">{{ posTestResult()!.connected ? 'Baglanti basarili!' : 'Baglanti basarisiz' }}</p>
                @if (posTestResult()!.lastUpdated) {
                  <p class="test-detail">Son menu guncelleme: {{ posTestResult()!.lastUpdated | date:'medium' }}</p>
                }
              </div>
            }

            <!-- POS Sync Result -->
            @if (posSyncResult()) {
              <div class="test-result success">
                <p class="test-message">{{ posSyncResult()!.message }}</p>
                <p class="test-detail">
                  {{ posSyncResult()!.categoriesFound }} kategori,
                  {{ posSyncResult()!.itemsCreated }} urun,
                  {{ posSyncResult()!.optionGroupsCreated }} opsiyon grubu
                </p>
              </div>
            }

            <!-- POS Error Message -->
            @if (posError()) {
              <div class="error-banner">{{ posError() }}</div>
            }
          </div>
        </div>

        <!-- Çalışma Saatleri -->
        <div class="settings-section">
          <h2 class="section-title">Çalışma Saatleri</h2>
          <div class="settings-card">
            <div class="setting-item column">
              <span class="setting-description text-muted">
                Çalışma saatleri dışında gelen siparişlerde müşteri bilgilendirilir.
                Kesintisiz çalışıyorsanız <strong>24 saat</strong> kutusunu işaretleyin.
                Kapanış saati açılıştan önceyse (ör. 18:00 - 03:00) gece yarısını geçen çalışma olarak kabul edilir.
              </span>
            </div>
            @for (day of weekDays; track day.key) {
              <div class="setting-item" style="gap: 8px; align-items: center;">
                <label style="width: 90px; font-size: 13px; font-weight: 500;">{{ day.label }}</label>
                <label style="display: flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer;">
                  <input type="checkbox" [checked]="!isDayClosed(day.key)" (change)="toggleDayClosed(day.key)"/>
                  Açık
                </label>
                @if (!isDayClosed(day.key)) {
                  <label style="display: flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer;">
                    <input type="checkbox" [checked]="isDayAllDay(day.key)" (change)="toggleDayAllDay(day.key)"/>
                    24 saat
                  </label>
                  @if (!isDayAllDay(day.key)) {
                    <input type="time" [value]="getDayOpen(day.key)" (change)="setDayTime(day.key, 'open', $event)"
                           style="padding: 4px 8px; border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-bg-tertiary); color: var(--color-text-primary); font-size: 12px;"/>
                    <span style="font-size: 12px;">-</span>
                    <input type="time" [value]="getDayClose(day.key)" (change)="setDayTime(day.key, 'close', $event)"
                           style="padding: 4px 8px; border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-bg-tertiary); color: var(--color-text-primary); font-size: 12px;"/>
                  } @else {
                    <span style="font-size: 12px; color: var(--color-text-secondary);">Kesintisiz açık</span>
                  }
                }
              </div>
            }
            <div class="setting-item action-row">
              <button class="btn btn-primary" (click)="saveWorkingHours()" [disabled]="isSavingHours()">
                {{ isSavingHours() ? 'Kaydediliyor...' : 'Kaydet' }}
              </button>
            </div>
            @if (hoursSaved()) {
              <div class="test-result success">
                <p class="test-message">Çalışma saatleri kaydedildi!</p>
              </div>
            }
          </div>
        </div>

        <!-- iyzico Ödeme Ayarları -->
        <div class="settings-section">
          <h2 class="section-title">iyzico Ödeme Ayarları</h2>
          <div class="settings-card">
            <div class="setting-item">
              <div class="setting-info">
                <span class="setting-label">Mod</span>
                <span class="setting-description text-muted">Test (sandbox) veya Production (canli)</span>
              </div>
              <div style="display: flex; gap: 8px;">
                <button class="btn" [class.btn-primary]="iyzicoMode() === 'test'" [class.btn-secondary]="iyzicoMode() !== 'test'" (click)="iyzicoMode.set('test')">Test</button>
                <button class="btn" [class.btn-primary]="iyzicoMode() === 'prod'" [class.btn-secondary]="iyzicoMode() !== 'prod'" (click)="iyzicoMode.set('prod')">Production</button>
              </div>
            </div>
            <div class="setting-item column">
              <span class="setting-label">API Key</span>
              <input type="text" class="setting-input" [value]="iyzicoApiKey()" (input)="iyzicoApiKey.set($any($event.target).value)" placeholder="sandbox-xxxx veya prod API key"/>
            </div>
            <div class="setting-item column">
              <span class="setting-label">Secret Key</span>
              <input type="password" class="setting-input" [value]="iyzicoSecretKey()" (input)="iyzicoSecretKey.set($any($event.target).value)" placeholder="***"/>
            </div>
            <div class="setting-item action-row">
              <button class="btn btn-primary" (click)="saveIyzico()" [disabled]="isSavingIyzico()">
                {{ isSavingIyzico() ? 'Kaydediliyor...' : 'Kaydet' }}
              </button>
            </div>
            @if (iyzicoSaved()) {
              <div class="test-result success">
                <p class="test-message">iyzico ayarları kaydedildi! ({{ iyzicoMode() === 'prod' ? 'CANLI' : 'TEST' }} mod)</p>
              </div>
            }
          </div>
        </div>

        <!-- Gel Al İndirim Ayarı -->
        <div class="settings-section">
          <h2 class="section-title">Gel Al İndirimi</h2>
          <div class="settings-card">
            <div class="setting-item">
              <div class="setting-info">
                <span class="setting-label">Gel Al İndirim Oranı (%)</span>
                <span class="setting-description text-muted">
                  Gel al siparişlerinde uygulanacak indirim yüzdesi. 0 veya boş bırakılırsa indirim uygulanmaz.
                </span>
              </div>
              <div class="pickup-discount-input">
                <input type="number" class="setting-input" min="0" max="100" step="1"
                       [value]="pickupDiscountPercent()"
                       (input)="onPickupDiscountChange($event)" />
                <span class="input-suffix">%</span>
              </div>
            </div>
            <div class="setting-item action-row">
              <button class="btn btn-primary" (click)="savePickupDiscount()" [disabled]="isSavingPickupDiscount()">
                {{ isSavingPickupDiscount() ? 'Kaydediliyor...' : 'Kaydet' }}
              </button>
            </div>
            @if (pickupDiscountSaved()) {
              <div class="test-result success">
                <p class="test-message">İndirim oranı kaydedildi!</p>
              </div>
            }
          </div>
        </div>

        <!-- Sipariş Bildirim Telefonları -->
        <div class="settings-section">
          <h2 class="section-title">Sipariş Bildirim Telefonları</h2>
          <div class="settings-card">
            <div class="setting-item column">
              <span class="setting-label">WhatsApp Bildirim Numaraları</span>
              <span class="setting-description text-muted">
                Yeni sipariş geldiğinde bu numaralara WhatsApp ile bildirim gönderilir (ürünler, fiyat, konum linki).
              </span>
            </div>

            @for (phone of notifyPhones(); track $index) {
              <div class="setting-item" style="gap: 8px;">
                <input type="tel" class="setting-input" [value]="phone"
                       (input)="updateNotifyPhone($index, $event)"
                       placeholder="905xxxxxxxxx" style="flex: 1;" />
                <button class="btn btn-danger" style="padding: 6px 12px;" (click)="removeNotifyPhone($index)">Sil</button>
              </div>
            }

            <div class="setting-item action-row" style="gap: 8px;">
              <button class="btn btn-secondary" (click)="addNotifyPhone()">+ Numara Ekle</button>
              <button class="btn btn-primary" (click)="saveNotifyPhones()" [disabled]="isSavingNotifyPhones()">
                {{ isSavingNotifyPhones() ? 'Kaydediliyor...' : 'Kaydet' }}
              </button>
            </div>
            @if (notifyPhonesSaved()) {
              <div class="test-result success">
                <p class="test-message">Bildirim numaraları kaydedildi!</p>
              </div>
            }
          </div>
        </div>

        <!-- Menu Media Upload -->
        <div class="settings-section">
          <h2 class="section-title">Menü Görselleri</h2>
          <div class="settings-card">
            <div class="setting-item column">
              <span class="setting-label">WhatsApp Menü Görselleri</span>
              <span class="setting-description text-muted">
                Müşteriler "menü" yazdığında gönderilecek görselleri yükleyin. (maks. 10 dosya, jpeg/png/webp/pdf)
              </span>
            </div>

            <!-- Upload Area -->
            <div class="setting-item">
              <label class="upload-area" [class.dragging]="isDragging()">
                <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
                       (change)="onFileSelected($event)" hidden #fileInput />
                <div class="upload-content" (click)="fileInput.click()"
                     (dragover)="onDragOver($event)" (dragleave)="isDragging.set(false)" (drop)="onDrop($event)">
                  <app-icon name="upload" [size]="24"/>
                  <span class="upload-text">
                    @if (isUploadingMedia()) {
                      Yükleniyor...
                    } @else {
                      Dosya secin veya surukleyin
                    }
                  </span>
                  <span class="upload-hint text-muted">{{ menuMedia().length }} / 10 dosya</span>
                </div>
              </label>
            </div>

            @if (mediaError()) {
              <div class="error-banner">{{ mediaError() }}</div>
            }

            <!-- Media List -->
            @for (item of menuMedia(); track item.id) {
              <div class="media-item">
                <div class="media-preview">
                  @if (item.type === 'IMAGE') {
                    <img [src]="item.url" [alt]="item.filename" class="media-thumb" />
                  } @else {
                    <div class="media-pdf-icon">
                      <app-icon name="file-text" [size]="24"/>
                    </div>
                  }
                </div>
                <div class="media-info">
                  <span class="media-filename">{{ item.filename }}</span>
                  <span class="media-size text-muted">{{ formatFileSize(item.sizeBytes) }}</span>
                </div>
                <button class="btn-icon btn-danger-icon" (click)="deleteMedia(item.id)" title="Sil">
                  <app-icon name="trash" [size]="16"/>
                </button>
              </div>
            }

            @if (menuMedia().length === 0) {
              <div class="media-empty text-muted">
                Henüz menü görseli yüklenmemiş.
              </div>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .settings { max-width: 800px; margin: 0 auto; }
      .otorder-connect { border-bottom: 1px dashed var(--color-border); }
      .otorder-form { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; }
      .otorder-row { display: flex; align-items: center; gap: 8px; }
      .otorder-row .setting-input { flex: 1; }
      .otorder-suffix { color: var(--color-text-secondary); font-size: 0.9rem; white-space: nowrap; }
      .otorder-divider { margin-top: 14px; }
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
        &::before { content: ''; position: absolute; height: 20px; width: 20px; left: 3px; bottom: 3px; background: var(--color-bg-primary); border-radius: 50%; transition: var(--transition-fast); }
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

      /* Menu Media Upload */
      .upload-area {
        width: 100%; cursor: pointer;
        &.dragging .upload-content { border-color: var(--color-accent-primary); background: rgba(0, 83, 155, 0.05); }
      }
      .upload-content {
        display: flex; flex-direction: column; align-items: center; gap: var(--spacing-sm);
        padding: var(--spacing-xl); border: 2px dashed var(--color-border);
        border-radius: var(--radius-md); transition: var(--transition-fast);
        color: var(--color-text-secondary);
        &:hover { border-color: var(--color-accent-primary); background: rgba(0, 83, 155, 0.03); }
      }
      .upload-text { font-size: 0.875rem; font-weight: 500; }
      .upload-hint { font-size: 0.75rem; }
      .media-item {
        display: flex; align-items: center; gap: var(--spacing-md);
        padding: var(--spacing-md) var(--spacing-lg);
        border-bottom: 1px solid var(--color-border);
        &:last-child { border-bottom: none; }
      }
      .media-preview { flex-shrink: 0; width: 56px; height: 56px; border-radius: var(--radius-sm); overflow: hidden; }
      .media-thumb { width: 100%; height: 100%; object-fit: cover; }
      .media-pdf-icon {
        width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
        background: var(--color-bg-tertiary); color: var(--color-text-secondary);
      }
      .media-info { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .media-filename { font-size: 0.875rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .media-size { font-size: 0.75rem; }
      .btn-icon {
        display: flex; align-items: center; justify-content: center;
        width: 32px; height: 32px; border: none; border-radius: var(--radius-sm);
        background: transparent; cursor: pointer; flex-shrink: 0;
      }
      .btn-danger-icon { color: #ef4444; &:hover { background: rgba(239, 68, 68, 0.1); } }
      .media-empty { padding: var(--spacing-xl); text-align: center; font-size: 0.875rem; }
      .pickup-discount-input {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
      }
      .pickup-discount-input input {
        width: 80px;
        text-align: center;
      }
      .input-suffix {
        font-weight: 600;
        color: var(--color-text-secondary);
      }
    `,
  ],
})
export class SettingsComponent implements OnInit {
  private http = inject(HttpClient);
  private authService = inject(AuthService);
  private waConfigService = inject(WhatsAppConfigService);
  private menuMediaService = inject(MenuMediaService);
  private posConfigService = inject(PosConfigService);
  private dialog = inject(DialogService);

  isAdmin = this.authService.isAdmin;

  waConfig = signal<WhatsAppConfigDto | null>(null);
  isLoading = signal(false);
  isSaving = signal(false);
  isTesting = signal(false);
  isSubscribing = signal(false);
  testResult = signal<WhatsAppTestConnectionDto | null>(null);
  errorMessage = signal<string | null>(null);
  copyFeedback = signal<string | null>(null);
  guideOpen = signal(false);

  // POS Integration
  posConfig = signal<PosConfigDto | null>(null);
  isPosSaving = signal(false);
  isPosTesting = signal(false);
  isPosSyncing = signal(false);
  posTestResult = signal<PosTestResult | null>(null);
  posSyncResult = signal<PosMenuSyncResultDto | null>(null);
  posError = signal<string | null>(null);

  posForm = new FormGroup({
    apiUrl: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    apiKey: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    locationId: new FormControl('', { nonNullable: true }),
  });

  // OtOrder tek-tik baglanti
  isOtorderConnecting = signal(false);
  otorderResult = signal<{ subdomain: string; sync?: { categoriesFound?: number; itemsCreated?: number } | null } | null>(null);
  otorderError = signal<string | null>(null);
  otorderForm = new FormGroup({
    subdomain: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  connectOtorder() {
    if (this.otorderForm.invalid || this.isOtorderConnecting()) return;
    this.isOtorderConnecting.set(true);
    this.otorderError.set(null);
    this.otorderResult.set(null);
    this.http
      .post<any>(
        `${environment.apiBaseUrl}/integrations/pos/connect-otorder`,
        this.otorderForm.getRawValue(),
        { headers: this.authService.getAuthHeaders() },
      )
      .subscribe({
        next: (res) => {
          this.isOtorderConnecting.set(false);
          if (res.success) {
            this.otorderResult.set(res.data);
            this.otorderForm.controls.password.reset();
            this.loadPosConfig();
          } else {
            this.otorderError.set(res.error?.message || 'Baglanti kurulamadi');
          }
        },
        error: (err) => {
          this.isOtorderConnecting.set(false);
          this.otorderError.set(err?.error?.error?.message || err?.error?.message || 'Baglanti kurulamadi');
        },
      });
  }

  // Pickup Discount
  pickupDiscountPercent = signal<number>(0);
  isSavingPickupDiscount = signal(false);
  pickupDiscountSaved = signal(false);

  // Working Hours
  workingHours = signal<any>({});
  isSavingHours = signal(false);
  hoursSaved = signal(false);
  weekDays = [
    { key: 'mon', label: 'Pazartesi' },
    { key: 'tue', label: 'Sali' },
    { key: 'wed', label: 'Carsamba' },
    { key: 'thu', label: 'Persembe' },
    { key: 'fri', label: 'Cuma' },
    { key: 'sat', label: 'Cumartesi' },
    { key: 'sun', label: 'Pazar' },
  ];

  // Google Maps
  googleMapsKey = signal('');
  isSavingGoogleMaps = signal(false);
  googleMapsSaved = signal(false);

  // iyzico
  iyzicoApiKey = signal('');
  iyzicoSecretKey = signal('');
  iyzicoMode = signal<'test' | 'prod'>('test');
  isSavingIyzico = signal(false);
  iyzicoSaved = signal(false);

  // Order Notification Phones
  notifyPhones = signal<string[]>([]);
  isSavingNotifyPhones = signal(false);
  notifyPhonesSaved = signal(false);

  // Menu Media
  menuMedia = signal<MenuMediaDto[]>([]);
  isUploadingMedia = signal(false);
  mediaError = signal<string | null>(null);
  isDragging = signal(false);

  waForm = new FormGroup({
    phoneNumberId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    wabaId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    accessToken: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    appSecret: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  ngOnInit() {
    if (this.isAdmin()) {
      this.loadConfig();
      this.loadPosConfig();
      this.loadPickupDiscount();
      this.loadWorkingHours();
      this.loadGoogleMaps();
      this.loadIyzico();
      this.loadNotifyPhones();
      this.loadMenuMedia();
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
        this.errorMessage.set('WhatsApp yapılandırması yüklenemedi');
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
        this.errorMessage.set(err.error?.error?.message || 'Yapılandırma kaydedilemedi');
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
        this.errorMessage.set(err.error?.error?.message || 'Bağlantı testi başarısız');
        this.isTesting.set(false);
      },
    });
  }

  subscribeWebhook() {
    this.isSubscribing.set(true);
    this.errorMessage.set(null);
    this.waConfigService.subscribeWebhook().subscribe({
      next: (res) => {
        this.isSubscribing.set(false);
        if (res.success && res.data?.success) {
          this.dialog.success(res.data.message || 'Webhook etkinleştirildi.');
        } else {
          this.dialog.error(res.data?.message || 'Webhook etkinleştirilemedi.');
        }
      },
      error: (err) => {
        this.isSubscribing.set(false);
        this.dialog.error(err.error?.error?.message || 'Webhook etkinleştirilemedi.');
      },
    });
  }

  async disconnectWhatsApp(): Promise<void> {
    const ok = await this.dialog.confirm(
      'WhatsApp bağlantısını kesmek istediğinize emin misiniz? Mevcut yapılandırmanız silinecek.',
      { title: 'WhatsApp bağlantısını kes', confirmText: 'Bağlantıyı kes', variant: 'danger' },
    );
    if (!ok) return;

    this.waConfigService.deleteConfig().subscribe({
      next: () => {
        this.waConfig.set(null);
        this.testResult.set(null);
        this.waForm.reset();
      },
      error: (err) => {
        this.errorMessage.set(err.error?.error?.message || 'Bağlantı kesilemedi');
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
      case 'CONNECTED': return 'Bağlı';
      case 'PENDING': return 'Doğrulama Bekliyor';
      case 'ERROR': return 'Hata';
      default: return 'Bağlı Değil';
    }
  }

  // ==================== POS Integration ====================

  loadPosConfig() {
    this.posConfigService.getConfig().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.posConfig.set(res.data);
          if (res.data.apiUrl) {
            this.posForm.patchValue({
              apiUrl: res.data.apiUrl,
              apiKey: '',
              locationId: res.data.locationId || '',
            });
          }
        }
      },
      error: () => {
        this.posError.set('POS ayarları yüklenemedi');
      },
    });
  }

  savePosConfig() {
    if (this.posForm.invalid) return;

    this.isPosSaving.set(true);
    this.posError.set(null);
    this.posTestResult.set(null);
    this.posSyncResult.set(null);

    const formValue = this.posForm.getRawValue();
    this.posConfigService.saveConfig(formValue).subscribe({
      next: (res) => {
        if (res.success) {
          this.loadPosConfig();
          this.posForm.patchValue({ apiKey: '' });
        } else {
          this.posError.set(res.error?.message || 'Kaydetme basarisiz');
        }
        this.isPosSaving.set(false);
      },
      error: (err) => {
        this.posError.set(err.error?.error?.message || 'Kaydetme basarisiz');
        this.isPosSaving.set(false);
      },
    });
  }

  testPosConnection() {
    this.isPosTesting.set(true);
    this.posTestResult.set(null);
    this.posError.set(null);
    this.posSyncResult.set(null);

    this.posConfigService.testConnection().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.posTestResult.set(res.data);
        } else {
          this.posError.set(res.error?.message || 'Baglanti testi basarisiz');
        }
        this.isPosTesting.set(false);
      },
      error: (err) => {
        this.posError.set(err.error?.error?.message || 'Baglanti testi basarisiz');
        this.isPosTesting.set(false);
      },
    });
  }

  syncPosMenu() {
    this.isPosSyncing.set(true);
    this.posSyncResult.set(null);
    this.posError.set(null);
    this.posTestResult.set(null);

    this.posConfigService.syncMenu().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.posSyncResult.set(res.data);
          this.loadPosConfig(); // Refresh last sync time
        } else {
          this.posError.set(res.error?.message || 'Senkronizasyon basarisiz');
        }
        this.isPosSyncing.set(false);
      },
      error: (err) => {
        this.posError.set(err.error?.error?.message || 'Senkronizasyon basarisiz');
        this.isPosSyncing.set(false);
      },
    });
  }

  // ==================== Pickup Discount ====================

  loadPickupDiscount() {
    this.posConfigService.getPickupDiscount().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.pickupDiscountPercent.set(res.data.pickupDiscountPercent || 0);
        }
      },
    });
  }

  onPickupDiscountChange(event: Event) {
    const value = parseInt((event.target as HTMLInputElement).value) || 0;
    this.pickupDiscountPercent.set(Math.max(0, Math.min(100, value)));
  }

  savePickupDiscount() {
    this.isSavingPickupDiscount.set(true);
    this.pickupDiscountSaved.set(false);
    this.posConfigService.savePickupDiscount(this.pickupDiscountPercent()).subscribe({
      next: (res) => {
        if (res.success) {
          this.pickupDiscountSaved.set(true);
          setTimeout(() => this.pickupDiscountSaved.set(false), 3000);
        }
        this.isSavingPickupDiscount.set(false);
      },
      error: () => {
        this.isSavingPickupDiscount.set(false);
      },
    });
  }

  // ==================== Working Hours ====================

  loadWorkingHours() {
    this.http.get<any>(`${environment.apiBaseUrl}/integrations/working-hours`, { headers: this.authService.getAuthHeaders() }).subscribe({
      next: (res) => {
        if (res.success && res.data?.workingHours) {
          this.workingHours.set(res.data.workingHours);
        } else {
          // Default: Mon-Sat 10:00-22:00, Sun closed
          this.workingHours.set({
            mon: { open: '10:00', close: '22:00' }, tue: { open: '10:00', close: '22:00' },
            wed: { open: '10:00', close: '22:00' }, thu: { open: '10:00', close: '22:00' },
            fri: { open: '10:00', close: '22:00' }, sat: { open: '10:00', close: '22:00' },
            sun: { open: '10:00', close: '22:00' }, closed: [],
          });
        }
      },
    });
  }

  isDayClosed(day: string): boolean {
    return (this.workingHours()?.closed || []).includes(day);
  }

  getDayOpen(day: string): string {
    return this.workingHours()?.[day]?.open || '10:00';
  }

  getDayClose(day: string): string {
    return this.workingHours()?.[day]?.close || '22:00';
  }

  toggleDayClosed(day: string): void {
    const wh = { ...this.workingHours() };
    const closed: string[] = [...(wh.closed || [])];
    if (closed.includes(day)) {
      wh.closed = closed.filter((d: string) => d !== day);
      if (!wh[day]) wh[day] = { open: '10:00', close: '22:00' };
    } else {
      wh.closed = [...closed, day];
    }
    this.workingHours.set(wh);
  }

  isDayAllDay(day: string): boolean {
    const d = this.workingHours()?.[day];
    return d?.allDay === true || (!!d?.open && d.open === d.close);
  }

  toggleDayAllDay(day: string): void {
    const wh = { ...this.workingHours() };
    const cur = { ...(wh[day] || { open: '10:00', close: '22:00' }) };
    if (this.isDayAllDay(day)) {
      cur.allDay = false;
      if (!cur.open || cur.open === cur.close) { cur.open = '10:00'; cur.close = '22:00'; }
    } else {
      cur.allDay = true;
    }
    wh[day] = cur;
    this.workingHours.set(wh);
  }

  setDayTime(day: string, field: 'open' | 'close', event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    const wh = { ...this.workingHours() };
    if (!wh[day]) wh[day] = { open: '10:00', close: '22:00' };
    wh[day] = { ...wh[day], [field]: val };
    this.workingHours.set(wh);
  }

  saveWorkingHours() {
    this.isSavingHours.set(true);
    this.hoursSaved.set(false);
    this.http.put<any>(
      `${environment.apiBaseUrl}/integrations/working-hours`,
      { workingHours: this.workingHours() },
      { headers: this.authService.getAuthHeaders() }
    ).subscribe({
      next: (res) => {
        if (res.success) {
          this.hoursSaved.set(true);
          setTimeout(() => this.hoursSaved.set(false), 3000);
        }
        this.isSavingHours.set(false);
      },
      error: () => this.isSavingHours.set(false),
    });
  }

  // ==================== Google Maps ====================

  loadGoogleMaps() {
    this.http.get<any>(`${environment.apiBaseUrl}/integrations/google-maps`, { headers: this.authService.getAuthHeaders() }).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.googleMapsKey.set(res.data.apiKey || '');
        }
      },
    });
  }

  saveGoogleMaps() {
    this.isSavingGoogleMaps.set(true);
    this.googleMapsSaved.set(false);
    this.http.put<any>(
      `${environment.apiBaseUrl}/integrations/google-maps`,
      { apiKey: this.googleMapsKey() },
      { headers: this.authService.getAuthHeaders() }
    ).subscribe({
      next: (res) => {
        if (res.success) {
          this.googleMapsSaved.set(true);
          setTimeout(() => this.googleMapsSaved.set(false), 3000);
        }
        this.isSavingGoogleMaps.set(false);
      },
      error: () => this.isSavingGoogleMaps.set(false),
    });
  }

  // ==================== iyzico ====================

  loadIyzico() {
    this.http.get<any>(`${environment.apiBaseUrl}/integrations/iyzico`, { headers: this.authService.getAuthHeaders() }).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.iyzicoApiKey.set(res.data.apiKey || '');
          this.iyzicoSecretKey.set(res.data.secretKey || '');
          this.iyzicoMode.set(res.data.mode || 'test');
        }
      },
    });
  }

  saveIyzico() {
    this.isSavingIyzico.set(true);
    this.iyzicoSaved.set(false);
    this.http.put<any>(
      `${environment.apiBaseUrl}/integrations/iyzico`,
      { apiKey: this.iyzicoApiKey(), secretKey: this.iyzicoSecretKey(), mode: this.iyzicoMode() },
      { headers: this.authService.getAuthHeaders() }
    ).subscribe({
      next: (res) => {
        if (res.success) {
          this.iyzicoSaved.set(true);
          setTimeout(() => this.iyzicoSaved.set(false), 3000);
        }
        this.isSavingIyzico.set(false);
      },
      error: () => this.isSavingIyzico.set(false),
    });
  }

  // ==================== Order Notification Phones ====================

  loadNotifyPhones() {
    this.http.get<any>(`${environment.apiBaseUrl}/integrations/order-notify-phones`, { headers: this.authService.getAuthHeaders() }).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.notifyPhones.set(res.data.phones || []);
        }
      },
    });
  }

  addNotifyPhone() {
    this.notifyPhones.update(phones => [...phones, '']);
  }

  removeNotifyPhone(index: number) {
    this.notifyPhones.update(phones => phones.filter((_, i) => i !== index));
  }

  updateNotifyPhone(index: number, event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.notifyPhones.update(phones => phones.map((p, i) => i === index ? value : p));
  }

  saveNotifyPhones() {
    this.isSavingNotifyPhones.set(true);
    this.notifyPhonesSaved.set(false);
    const phones = this.notifyPhones().filter(p => p.trim().length > 0);
    this.http.put<any>(
      `${environment.apiBaseUrl}/integrations/order-notify-phones`,
      { phones },
      { headers: this.authService.getAuthHeaders() }
    ).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.notifyPhones.set(res.data.phones);
          this.notifyPhonesSaved.set(true);
          setTimeout(() => this.notifyPhonesSaved.set(false), 3000);
        }
        this.isSavingNotifyPhones.set(false);
      },
      error: () => {
        this.isSavingNotifyPhones.set(false);
      },
    });
  }

  // ==================== Menu Media ====================

  loadMenuMedia() {
    this.menuMediaService.getMedia().subscribe({
      next: (res) => {
        if (res.success && res.data) this.menuMedia.set(res.data);
      },
    });
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.uploadFile(file);
    input.value = '';
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    this.isDragging.set(true);
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.isDragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) this.uploadFile(file);
  }

  private uploadFile(file: File) {
    this.mediaError.set(null);
    this.isUploadingMedia.set(true);
    this.menuMediaService.uploadMedia(file).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.menuMedia.update((list) => [...list, res.data!]);
        }
        this.isUploadingMedia.set(false);
      },
      error: (err) => {
        this.mediaError.set(err.error?.error?.message || 'Yukleme basarisiz');
        this.isUploadingMedia.set(false);
      },
    });
  }

  async deleteMedia(mediaId: string): Promise<void> {
    const ok = await this.dialog.confirm(
      'Bu dosyayı silmek istediğinize emin misiniz?',
      { title: 'Dosyayı sil', confirmText: 'Sil', variant: 'danger' },
    );
    if (!ok) return;

    this.menuMediaService.deleteMedia(mediaId).subscribe({
      next: () => {
        this.menuMedia.update((list) => list.filter((m) => m.id !== mediaId));
      },
      error: (err) => {
        this.mediaError.set(err.error?.error?.message || 'Silme başarısız');
      },
    });
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
