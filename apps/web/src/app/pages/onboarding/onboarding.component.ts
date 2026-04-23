import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../services/theme.service';
import { StoreService } from '../../services/store.service';
import {
  WhatsAppConfigService,
  WhatsAppConfigDto,
} from '../../services/whatsapp-config.service';
import { DialogService } from '../../shared/dialog.service';
import { IconComponent } from '../../shared/icon.component';

type StepKey = 'welcome' | 'store' | 'whatsapp' | 'menu' | 'operations' | 'done';

interface StepMeta {
  key: StepKey;
  title: string;
  description: string;
  icon: string;
}

interface WorkingHoursDay {
  open: string;
  close: string;
  closed: boolean;
}

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IconComponent],
  template: `
    <div class="onboarding-page">
      <!-- Top nav -->
      <nav class="top-nav">
        <div class="nav-brand">
          <img src="/logo.jpeg" alt="Superpersonel" style="height:28px; border-radius:6px;"/>
          <span>Superpersonel</span>
        </div>
        <div class="nav-right">
          <button class="icon-btn" (click)="themeService.toggleTheme()" aria-label="Tema">
            @if (themeService.isDark()) {
              <app-icon name="sun" [size]="16"/>
            } @else {
              <app-icon name="moon" [size]="16"/>
            }
          </button>
          <button class="skip-btn" (click)="skipOnboarding()">
            Atla ve panele git
          </button>
        </div>
      </nav>

      <!-- Progress bar -->
      <div class="progress-wrap">
        <div class="progress-steps">
          @for (step of steps; track step.key; let i = $index) {
            <div
              class="progress-step"
              [class.active]="currentIndex() === i"
              [class.done]="currentIndex() > i"
              [class.clickable]="currentIndex() > i"
              (click)="jumpToStep(i)"
            >
              <div class="step-dot">
                @if (currentIndex() > i) {
                  <app-icon name="check" [size]="14"/>
                } @else {
                  <span>{{ i + 1 }}</span>
                }
              </div>
              <div class="step-label">{{ step.title }}</div>
            </div>
          }
        </div>
      </div>

      <!-- Step content -->
      <main class="content">
        <div class="step-card">
          <!-- Step header -->
          <header class="step-header">
            <div class="step-icon">
              <app-icon [name]="currentStepMeta().icon" [size]="32"/>
            </div>
            <h1>{{ currentStepMeta().title }}</h1>
            <p>{{ currentStepMeta().description }}</p>
          </header>

          <!-- Step body -->
          @switch (currentStep()) {
            @case ('welcome') {
              <div class="welcome-body">
                <div class="welcome-stats">
                  <div class="stat">
                    <div class="stat-icon"><app-icon name="package" [size]="20"/></div>
                    <div class="stat-text">
                      <strong>WhatsApp üzerinden sipariş</strong>
                      <span>Müşterileriniz direkt WhatsApp'tan sipariş verir, siz panelden yönetirsiniz.</span>
                    </div>
                  </div>
                  <div class="stat">
                    <div class="stat-icon"><app-icon name="store" [size]="20"/></div>
                    <div class="stat-text">
                      <strong>Çoklu şube yönetimi</strong>
                      <span>Birden fazla şubeniz olsa bile tek panelden tüm siparişleri takip edin.</span>
                    </div>
                  </div>
                  <div class="stat">
                    <div class="stat-icon"><app-icon name="credit-card" [size]="20"/></div>
                    <div class="stat-text">
                      <strong>Güvenli ödeme</strong>
                      <span>iyzico altyapısı üzerinden kart bilgisi size hiç uğramadan ödeme alın.</span>
                    </div>
                  </div>
                </div>
                <p class="welcome-footer">
                  Kuruluma başlamak için 5 dakikanızı ayırmanız yeterli.
                  Her adımı atlayabilir, sonra Ayarlar'dan tamamlayabilirsiniz.
                </p>
              </div>
            }

            @case ('store') {
              <form class="form" (ngSubmit)="saveStore()">
                <div class="form-row">
                  <label>
                    <span>Şube adı <em>*</em></span>
                    <input
                      type="text"
                      [(ngModel)]="storeForm.name"
                      name="storeName"
                      placeholder="Merkez Şube"
                      required
                    />
                  </label>
                </div>
                <div class="form-row">
                  <label>
                    <span>Adres</span>
                    <input
                      type="text"
                      [(ngModel)]="storeForm.address"
                      name="storeAddress"
                      placeholder="Bağdat Cad. No:42, Kadıköy/İstanbul"
                    />
                  </label>
                </div>
                <div class="form-row-2">
                  <label>
                    <span>Telefon</span>
                    <input
                      type="tel"
                      [(ngModel)]="storeForm.phone"
                      name="storePhone"
                      placeholder="+90 212 555 55 55"
                    />
                  </label>
                  <label>
                    <span>Enlem / Boylam <em class="help">(opsiyonel)</em></span>
                    <div class="latlng">
                      <input
                        type="number"
                        step="any"
                        [(ngModel)]="storeForm.lat"
                        name="storeLat"
                        placeholder="41.0082"
                      />
                      <input
                        type="number"
                        step="any"
                        [(ngModel)]="storeForm.lng"
                        name="storeLng"
                        placeholder="28.9784"
                      />
                    </div>
                  </label>
                </div>
                @if (existingStore()) {
                  <div class="info-banner success">
                    <app-icon name="check" [size]="14"/>
                    <span>Şubeniz zaten kayıtlı: <strong>{{ existingStore()!.name }}</strong>. Güncellemek için formu doldurun.</span>
                  </div>
                }
              </form>
            }

            @case ('whatsapp') {
              <div class="whatsapp-body">
                @if (whatsappConfig()) {
                  <div class="info-banner success">
                    <app-icon name="check" [size]="14"/>
                    <span>WhatsApp bağlantısı zaten yapılandırılmış. Güncellemek için alanları değiştirin.</span>
                  </div>
                }

                <div class="webhook-box">
                  <div class="webhook-field">
                    <label>Webhook URL</label>
                    <div class="copy-row">
                      <input type="text" [value]="webhookUrl()" readonly/>
                      <button type="button" class="btn btn-ghost" (click)="copy(webhookUrl(), 'webhook')">
                        @if (copied() === 'webhook') {
                          <app-icon name="check" [size]="14"/>
                          Kopyalandı
                        } @else {
                          <app-icon name="file-text" [size]="14"/>
                          Kopyala
                        }
                      </button>
                    </div>
                  </div>
                  <div class="webhook-field">
                    <label>Doğrulama Token</label>
                    <div class="copy-row">
                      <input type="text" [value]="verifyToken()" readonly/>
                      <button type="button" class="btn btn-ghost" (click)="copy(verifyToken(), 'token')">
                        @if (copied() === 'token') {
                          <app-icon name="check" [size]="14"/>
                          Kopyalandı
                        } @else {
                          <app-icon name="file-text" [size]="14"/>
                          Kopyala
                        }
                      </button>
                    </div>
                  </div>
                  <p class="webhook-help">
                    Bu değerleri Meta Business Suite → WhatsApp → Yapılandırma → Webhook'lar alanına yapıştırın.
                  </p>
                </div>

                <form class="form" (ngSubmit)="saveWhatsApp()">
                  <div class="form-row-2">
                    <label>
                      <span>Phone Number ID <em>*</em></span>
                      <input
                        type="text"
                        [(ngModel)]="whatsappForm.phoneNumberId"
                        name="waPhoneNumberId"
                        placeholder="123456789012345"
                        required
                      />
                    </label>
                    <label>
                      <span>WABA ID <em>*</em></span>
                      <input
                        type="text"
                        [(ngModel)]="whatsappForm.wabaId"
                        name="waWabaId"
                        placeholder="123456789012345"
                        required
                      />
                    </label>
                  </div>
                  <div class="form-row">
                    <label>
                      <span>Access Token <em>*</em></span>
                      <input
                        type="password"
                        [(ngModel)]="whatsappForm.accessToken"
                        name="waAccessToken"
                        placeholder="EAAxxxxxxxxxxxxx"
                        autocomplete="off"
                        required
                      />
                    </label>
                  </div>
                  <div class="form-row">
                    <label>
                      <span>App Secret <em>*</em></span>
                      <input
                        type="password"
                        [(ngModel)]="whatsappForm.appSecret"
                        name="waAppSecret"
                        autocomplete="off"
                        required
                      />
                    </label>
                  </div>
                </form>
              </div>
            }

            @case ('menu') {
              <div class="menu-body">
                <p class="menu-intro">
                  Menünüzü 3 farklı yolla ekleyebilirsiniz. En kolayı POS entegrasyonudur — menü otomatik senkronlanır.
                </p>
                <div class="choice-grid">
                  <a class="choice-card" routerLink="/settings" (click)="markStepDone('menu')">
                    <div class="choice-icon primary"><app-icon name="package" [size]="24"/></div>
                    <h3>POS Entegrasyonu</h3>
                    <p>POS sisteminizdeki menüyü otomatik olarak çekin. Değişiklikler anında yansır.</p>
                    <span class="choice-link">Ayarlara git <app-icon name="arrow-right" [size]="12"/></span>
                  </a>
                  <a class="choice-card" routerLink="/menu" (click)="markStepDone('menu')">
                    <div class="choice-icon"><app-icon name="file-text" [size]="24"/></div>
                    <h3>Manuel Giriş</h3>
                    <p>Menü ürünlerini ve fiyatlarını kendiniz ekleyin. Kategoriler ve seçenekler destekli.</p>
                    <span class="choice-link">Menü sayfasına git <app-icon name="arrow-right" [size]="12"/></span>
                  </a>
                  <button class="choice-card" (click)="next()">
                    <div class="choice-icon"><app-icon name="corner-down-left" [size]="24"/></div>
                    <h3>Daha Sonra</h3>
                    <p>Menüyü şimdi ayarlamak istemiyorsanız sonraki adıma geçin. İstediğiniz zaman ekleyebilirsiniz.</p>
                    <span class="choice-link">Sonraki adım <app-icon name="arrow-right" [size]="12"/></span>
                  </button>
                </div>
              </div>
            }

            @case ('operations') {
              <div class="operations-body">
                <section class="op-section">
                  <h3>Çalışma Saatleri</h3>
                  <p class="op-help">Müşterileriniz kapalı saatlerde sipariş veremez.</p>
                  <div class="hours-grid">
                    @for (day of workingDays; track day.key) {
                      <div class="hour-row">
                        <label class="day-label">{{ day.label }}</label>
                        <label class="open-toggle">
                          <input
                            type="checkbox"
                            [checked]="!workingHours[day.key].closed"
                            (change)="toggleDayClosed(day.key)"
                          />
                          <span>Açık</span>
                        </label>
                        @if (!workingHours[day.key].closed) {
                          <input
                            type="time"
                            [(ngModel)]="workingHours[day.key].open"
                            [ngModelOptions]="{ standalone: true }"
                          />
                          <span class="hour-sep">–</span>
                          <input
                            type="time"
                            [(ngModel)]="workingHours[day.key].close"
                            [ngModelOptions]="{ standalone: true }"
                          />
                        }
                      </div>
                    }
                  </div>
                </section>

                <section class="op-section">
                  <h3>Sipariş Bildirim Telefonları</h3>
                  <p class="op-help">
                    Yeni bir sipariş geldiğinde WhatsApp üzerinden anında bildirim almak istediğiniz
                    telefon numaralarını ekleyin. Birden fazla numara ekleyebilirsiniz.
                  </p>
                  <div class="phones-list">
                    @for (phone of notifyPhones(); track $index) {
                      <div class="phone-chip">
                        <app-icon name="message-square" [size]="12"/>
                        <span>{{ phone }}</span>
                        <button type="button" (click)="removePhone($index)">
                          <app-icon name="x" [size]="12"/>
                        </button>
                      </div>
                    }
                    <div class="phone-add">
                      <input
                        type="tel"
                        [(ngModel)]="newPhone"
                        [ngModelOptions]="{ standalone: true }"
                        placeholder="+90 5XX XXX XX XX"
                        (keyup.enter)="addPhone()"
                      />
                      <button type="button" class="btn btn-ghost" (click)="addPhone()">
                        Ekle
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            }

            @case ('done') {
              <div class="done-body">
                <div class="done-icon">
                  <app-icon name="party-popper" [size]="48"/>
                </div>
                <h2>Kurulum tamamlandı!</h2>
                <p>
                  Artık siparişleri kabul etmeye hazırsınız. Panele giderek ilk siparişinizi bekleyebilir,
                  ayarlardan değişiklik yapabilirsiniz.
                </p>

                <div class="checklist">
                  <div class="check-item" [class.checked]="completedSteps().has('store')">
                    <app-icon [name]="completedSteps().has('store') ? 'check' : 'x'" [size]="14"/>
                    <span>Şube bilgileri</span>
                  </div>
                  <div class="check-item" [class.checked]="completedSteps().has('whatsapp')">
                    <app-icon [name]="completedSteps().has('whatsapp') ? 'check' : 'x'" [size]="14"/>
                    <span>WhatsApp entegrasyonu</span>
                  </div>
                  <div class="check-item" [class.checked]="completedSteps().has('menu')">
                    <app-icon [name]="completedSteps().has('menu') ? 'check' : 'x'" [size]="14"/>
                    <span>Menü ayarı</span>
                  </div>
                  <div class="check-item" [class.checked]="completedSteps().has('operations')">
                    <app-icon [name]="completedSteps().has('operations') ? 'check' : 'x'" [size]="14"/>
                    <span>Çalışma saatleri ve bildirim telefonları</span>
                  </div>
                </div>
              </div>
            }
          }

          @if (stepError()) {
            <div class="info-banner error">
              <app-icon name="alert-triangle" [size]="14"/>
              <span>{{ stepError() }}</span>
            </div>
          }

          <!-- Footer nav -->
          <footer class="step-footer">
            @if (currentIndex() > 0 && currentStep() !== 'done') {
              <button type="button" class="btn btn-ghost" (click)="back()">
                <app-icon name="arrow-left" [size]="14"/>
                Geri
              </button>
            } @else {
              <div></div>
            }

            @if (currentStep() === 'welcome') {
              <button type="button" class="btn btn-primary" (click)="next()">
                Başlayalım
                <app-icon name="arrow-right" [size]="14"/>
              </button>
            } @else if (currentStep() === 'store') {
              <div class="right-group">
                <button type="button" class="btn btn-ghost" (click)="next()">Atla</button>
                <button type="button" class="btn btn-primary" (click)="saveStore()" [disabled]="saving()">
                  @if (saving()) {
                    <span class="btn-spin"></span>
                    Kaydediliyor…
                  } @else {
                    Kaydet ve devam et
                    <app-icon name="arrow-right" [size]="14"/>
                  }
                </button>
              </div>
            } @else if (currentStep() === 'whatsapp') {
              <div class="right-group">
                <button type="button" class="btn btn-ghost" (click)="next()">Atla</button>
                <button type="button" class="btn btn-primary" (click)="saveWhatsApp()" [disabled]="saving()">
                  @if (saving()) {
                    <span class="btn-spin"></span>
                    Kaydediliyor…
                  } @else {
                    Kaydet ve devam et
                    <app-icon name="arrow-right" [size]="14"/>
                  }
                </button>
              </div>
            } @else if (currentStep() === 'operations') {
              <div class="right-group">
                <button type="button" class="btn btn-ghost" (click)="next()">Atla</button>
                <button type="button" class="btn btn-primary" (click)="saveOperations()" [disabled]="saving()">
                  @if (saving()) {
                    <span class="btn-spin"></span>
                    Kaydediliyor…
                  } @else {
                    Kaydet ve devam et
                    <app-icon name="arrow-right" [size]="14"/>
                  }
                </button>
              </div>
            } @else if (currentStep() === 'done') {
              <button type="button" class="btn btn-primary big" (click)="finish()">
                <app-icon name="rocket" [size]="14"/>
                Panele git
              </button>
            }
          </footer>
        </div>
      </main>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100vh;
      }

      .onboarding-page {
        min-height: 100vh;
        background: var(--color-bg-primary);
        color: var(--color-text-primary);
        display: flex;
        flex-direction: column;
      }

      /* ========== Nav ========== */
      .top-nav {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 32px;
        border-bottom: 1px solid var(--color-border);
        background: color-mix(in srgb, var(--color-bg-primary) 92%, transparent);
        backdrop-filter: blur(12px);
      }

      .nav-brand {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-weight: 700;
        font-size: 1rem;
      }
      .nav-brand app-icon { color: var(--color-accent-primary, #1B5583); }

      .nav-right {
        display: inline-flex;
        align-items: center;
        gap: 10px;
      }

      .icon-btn {
        width: 36px;
        height: 36px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: 10px;
        color: var(--color-text-secondary);
        cursor: pointer;
        transition: all 0.15s;
      }
      .icon-btn:hover {
        background: var(--color-bg-tertiary);
        color: var(--color-text-primary);
      }

      .skip-btn {
        padding: 8px 16px;
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: 10px;
        color: var(--color-text-secondary);
        font-size: 0.85rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
      }
      .skip-btn:hover {
        background: var(--color-bg-secondary);
        color: var(--color-text-primary);
      }

      /* ========== Progress ========== */
      .progress-wrap {
        padding: 28px 20px 0;
      }
      .progress-steps {
        max-width: 960px;
        margin: 0 auto;
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        position: relative;
        padding: 0 20px;
      }

      .progress-steps::before {
        content: '';
        position: absolute;
        top: 17px;
        left: 50px;
        right: 50px;
        height: 2px;
        background: var(--color-border);
        z-index: 0;
      }

      .progress-step {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        position: relative;
        z-index: 1;
        min-width: 80px;
      }

      .progress-step.clickable { cursor: pointer; }

      .step-dot {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: var(--color-bg-elevated);
        border: 2px solid var(--color-border);
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 600;
        font-size: 0.85rem;
        color: var(--color-text-muted);
        transition: all 0.2s;
      }

      .progress-step.active .step-dot {
        background: var(--color-accent-primary, #1B5583);
        border-color: var(--color-accent-primary, #1B5583);
        color: white;
        box-shadow: 0 0 0 6px color-mix(in srgb, var(--color-accent-primary, #1B5583) 12%, transparent);
      }

      .progress-step.done .step-dot {
        background: #10b981;
        border-color: #10b981;
        color: white;
      }

      .step-label {
        font-size: 0.78rem;
        color: var(--color-text-muted);
        text-align: center;
        max-width: 100px;
      }

      .progress-step.active .step-label { color: var(--color-text-primary); font-weight: 600; }
      .progress-step.done .step-label { color: var(--color-text-secondary); }

      /* ========== Content ========== */
      .content {
        flex: 1;
        display: flex;
        justify-content: center;
        padding: 48px 24px 80px;
      }

      .step-card {
        width: 100%;
        max-width: 720px;
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        border-radius: 20px;
        padding: 40px 44px 32px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.05);
      }

      /* ========== Step header ========== */
      .step-header {
        text-align: center;
        margin-bottom: 32px;
      }
      .step-icon {
        width: 64px;
        height: 64px;
        margin: 0 auto 16px;
        border-radius: 16px;
        background: color-mix(in srgb, var(--color-accent-primary, #1B5583) 10%, transparent);
        color: var(--color-accent-primary, #1B5583);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .step-header h1 {
        font-size: 1.75rem;
        font-weight: 800;
        letter-spacing: -0.02em;
        margin: 0 0 8px;
      }
      .step-header p {
        font-size: 0.95rem;
        color: var(--color-text-secondary);
        margin: 0;
        max-width: 520px;
        margin: 0 auto;
        line-height: 1.55;
      }

      /* ========== Welcome ========== */
      .welcome-body { padding: 8px 0; }
      .welcome-stats {
        display: flex;
        flex-direction: column;
        gap: 18px;
        margin-bottom: 24px;
      }
      .stat {
        display: flex;
        gap: 14px;
        align-items: flex-start;
        padding: 16px 18px;
        background: var(--color-bg-secondary);
        border-radius: 12px;
        border: 1px solid var(--color-border);
      }
      .stat-icon {
        width: 40px;
        height: 40px;
        border-radius: 10px;
        background: color-mix(in srgb, var(--color-accent-primary, #1B5583) 12%, transparent);
        color: var(--color-accent-primary, #1B5583);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .stat-text {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .stat-text strong {
        font-size: 0.95rem;
        font-weight: 600;
      }
      .stat-text span {
        font-size: 0.85rem;
        color: var(--color-text-secondary);
        line-height: 1.5;
      }
      .welcome-footer {
        text-align: center;
        font-size: 0.85rem;
        color: var(--color-text-muted);
        line-height: 1.55;
        margin: 0;
      }

      /* ========== Form ========== */
      .form { display: flex; flex-direction: column; gap: 16px; }

      .form-row { display: flex; flex-direction: column; }
      .form-row-2 {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px;
      }

      .form label {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .form label > span {
        font-size: 0.82rem;
        font-weight: 500;
        color: var(--color-text-secondary);
      }
      .form label em {
        font-style: normal;
        color: #ef4444;
        margin-left: 2px;
      }
      .form label em.help {
        color: var(--color-text-muted);
        font-size: 0.78rem;
      }

      .form input {
        padding: 11px 14px;
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: 10px;
        color: var(--color-text-primary);
        font-size: 0.9rem;
        font-family: inherit;
        transition: border-color 0.15s, box-shadow 0.15s;
      }
      .form input:focus {
        outline: none;
        border-color: var(--color-accent-primary, #1B5583);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent-primary, #1B5583) 15%, transparent);
      }
      .latlng {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      /* ========== WhatsApp ========== */
      .whatsapp-body { display: flex; flex-direction: column; gap: 20px; }

      .webhook-box {
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: 12px;
        padding: 18px 20px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .webhook-field label {
        display: block;
        font-size: 0.78rem;
        font-weight: 600;
        color: var(--color-text-secondary);
        margin-bottom: 6px;
      }
      .copy-row {
        display: flex;
        gap: 8px;
      }
      .copy-row input {
        flex: 1;
        padding: 9px 12px;
        background: var(--color-bg-primary);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        color: var(--color-text-primary);
        font-size: 0.82rem;
        font-family: var(--font-mono, monospace);
      }
      .webhook-help {
        margin: 0;
        font-size: 0.78rem;
        color: var(--color-text-muted);
        line-height: 1.5;
      }

      /* ========== Menu step ========== */
      .menu-body { display: flex; flex-direction: column; gap: 20px; }
      .menu-intro {
        margin: 0;
        text-align: center;
        color: var(--color-text-secondary);
        font-size: 0.92rem;
      }
      .choice-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 14px;
      }
      .choice-card {
        display: block;
        text-align: left;
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: 14px;
        padding: 20px 18px;
        cursor: pointer;
        transition: all 0.2s;
        text-decoration: none;
        color: var(--color-text-primary);
        font-family: inherit;
      }
      .choice-card:hover {
        transform: translateY(-2px);
        border-color: var(--color-accent-primary, #1B5583);
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.07);
      }
      .choice-icon {
        width: 42px;
        height: 42px;
        border-radius: 10px;
        background: var(--color-bg-tertiary);
        color: var(--color-text-secondary);
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 12px;
      }
      .choice-icon.primary {
        background: color-mix(in srgb, var(--color-accent-primary, #1B5583) 12%, transparent);
        color: var(--color-accent-primary, #1B5583);
      }
      .choice-card h3 {
        font-size: 1rem;
        font-weight: 600;
        margin: 0 0 6px;
      }
      .choice-card p {
        font-size: 0.82rem;
        color: var(--color-text-secondary);
        line-height: 1.5;
        margin: 0 0 12px;
      }
      .choice-link {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 0.82rem;
        font-weight: 600;
        color: var(--color-accent-primary, #1B5583);
      }

      /* ========== Operations ========== */
      .operations-body { display: flex; flex-direction: column; gap: 28px; }
      .op-section h3 {
        font-size: 1rem;
        font-weight: 600;
        margin: 0 0 6px;
      }
      .op-help {
        font-size: 0.82rem;
        color: var(--color-text-muted);
        margin: 0 0 14px;
        line-height: 1.5;
      }

      .hours-grid { display: flex; flex-direction: column; gap: 10px; }
      .hour-row {
        display: grid;
        grid-template-columns: 80px 90px 1fr auto 1fr;
        align-items: center;
        gap: 10px;
        padding: 8px 12px;
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: 10px;
      }
      .day-label {
        font-size: 0.82rem;
        font-weight: 500;
      }
      .open-toggle {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 0.78rem;
        color: var(--color-text-secondary);
        cursor: pointer;
      }
      .hour-row input[type='time'] {
        padding: 6px 10px;
        background: var(--color-bg-primary);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        color: var(--color-text-primary);
        font-size: 0.82rem;
        font-family: var(--font-mono, monospace);
      }
      .hour-sep { color: var(--color-text-muted); text-align: center; }

      .phones-list { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .phone-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: 20px;
        font-size: 0.82rem;
        color: var(--color-text-primary);
      }
      .phone-chip button {
        background: transparent;
        border: none;
        color: var(--color-text-muted);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        padding: 2px;
        border-radius: 4px;
      }
      .phone-chip button:hover {
        color: #ef4444;
      }
      .phone-add {
        display: inline-flex;
        gap: 8px;
        flex: 1;
        min-width: 240px;
      }
      .phone-add input {
        flex: 1;
        padding: 8px 12px;
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: 20px;
        color: var(--color-text-primary);
        font-size: 0.82rem;
      }

      /* ========== Done ========== */
      .done-body {
        text-align: center;
        padding: 16px 0;
      }
      .done-icon {
        display: inline-flex;
        width: 96px;
        height: 96px;
        border-radius: 50%;
        background: color-mix(in srgb, #10b981 12%, transparent);
        color: #10b981;
        align-items: center;
        justify-content: center;
        margin-bottom: 20px;
      }
      .done-body h2 {
        font-size: 1.5rem;
        font-weight: 800;
        margin: 0 0 10px;
      }
      .done-body > p {
        font-size: 0.95rem;
        color: var(--color-text-secondary);
        max-width: 440px;
        margin: 0 auto 28px;
        line-height: 1.55;
      }
      .checklist {
        max-width: 360px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: 10px;
        text-align: left;
      }
      .check-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: 10px;
        font-size: 0.88rem;
        color: var(--color-text-muted);
      }
      .check-item app-icon { color: var(--color-text-muted); }
      .check-item.checked { color: var(--color-text-primary); }
      .check-item.checked app-icon { color: #10b981; }

      /* ========== Info banner ========== */
      .info-banner {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 12px 14px;
        border-radius: 10px;
        font-size: 0.85rem;
        line-height: 1.45;
        margin-top: 16px;
      }
      .info-banner.success {
        background: color-mix(in srgb, #10b981 10%, transparent);
        border: 1px solid color-mix(in srgb, #10b981 30%, transparent);
        color: var(--color-text-secondary);
      }
      .info-banner.success app-icon { color: #10b981; }
      .info-banner.error {
        background: rgba(239, 68, 68, 0.1);
        border: 1px solid rgba(239, 68, 68, 0.3);
        color: #ef4444;
      }

      /* ========== Step footer ========== */
      .step-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        margin-top: 32px;
        padding-top: 20px;
        border-top: 1px solid var(--color-border);
      }
      .right-group {
        display: inline-flex;
        gap: 10px;
      }

      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 11px 22px;
        border: 1px solid transparent;
        border-radius: 10px;
        font-size: 0.9rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s;
        font-family: inherit;
      }
      .btn:disabled {
        cursor: not-allowed;
        opacity: 0.65;
      }
      .btn.big { padding: 13px 28px; font-size: 0.95rem; }

      .btn-primary {
        background: var(--color-accent-primary, #1B5583);
        color: white;
      }
      .btn-primary:hover:not(:disabled) {
        background: var(--color-accent-primary-hover, #154269);
        transform: translateY(-1px);
      }
      .btn-ghost {
        background: var(--color-bg-secondary);
        color: var(--color-text-primary);
        border-color: var(--color-border);
      }
      .btn-ghost:hover:not(:disabled) {
        background: var(--color-bg-tertiary);
      }

      .btn-spin {
        width: 14px;
        height: 14px;
        border: 2px solid rgba(255, 255, 255, 0.4);
        border-top-color: white;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      /* ========== Responsive ========== */
      @media (max-width: 768px) {
        .top-nav { padding: 14px 18px; }
        .progress-wrap { padding: 20px 12px 0; overflow-x: auto; }
        .progress-steps { padding: 0 12px; min-width: 560px; }
        .content { padding: 28px 12px 56px; }
        .step-card { padding: 28px 20px 24px; border-radius: 16px; }
        .step-header h1 { font-size: 1.4rem; }
        .form-row-2 { grid-template-columns: 1fr; }
        .choice-grid { grid-template-columns: 1fr; }
        .hour-row {
          grid-template-columns: 1fr;
          gap: 8px;
        }
        .hour-sep { display: none; }
        .step-footer { flex-direction: column-reverse; align-items: stretch; }
        .step-footer .btn,
        .step-footer .right-group,
        .step-footer .right-group .btn { width: 100%; }
      }
    `,
  ],
})
export class OnboardingComponent implements OnInit {
  private http = inject(HttpClient);
  private router = inject(Router);
  private authService = inject(AuthService);
  private storeService = inject(StoreService);
  private waConfigService = inject(WhatsAppConfigService);
  private dialog = inject(DialogService);
  themeService = inject(ThemeService);

  readonly steps: StepMeta[] = [
    {
      key: 'welcome',
      title: 'Hoş geldiniz',
      description: 'Birkaç basit adımda işletmenizi Superpersonel\'a bağlayacağız.',
      icon: 'hexagon',
    },
    {
      key: 'store',
      title: 'İşletme bilgileri',
      description: 'İlk şubenizi ekleyelim. Sonradan daha fazla şube ekleyebilirsiniz.',
      icon: 'store',
    },
    {
      key: 'whatsapp',
      title: 'WhatsApp entegrasyonu',
      description: 'Meta Cloud API anahtarlarınızı girin ve webhook\'u yapılandırın.',
      icon: 'message-square',
    },
    {
      key: 'menu',
      title: 'Menünüz',
      description: 'Menünüzü ekleyin — POS\'tan otomatik çekin ya da manuel girin.',
      icon: 'file-text',
    },
    {
      key: 'operations',
      title: 'Operasyon ayarları',
      description: 'Çalışma saatlerinizi ve sipariş bildirim numaralarını ekleyin.',
      icon: 'bell',
    },
    {
      key: 'done',
      title: 'Tamamlandı',
      description: 'Hepsi bu kadar! Panele gidip siparişleri kabul etmeye başlayabilirsiniz.',
      icon: 'check-circle',
    },
  ];

  readonly workingDays = [
    { key: 'mon' as const, label: 'Pzt' },
    { key: 'tue' as const, label: 'Sal' },
    { key: 'wed' as const, label: 'Çar' },
    { key: 'thu' as const, label: 'Per' },
    { key: 'fri' as const, label: 'Cum' },
    { key: 'sat' as const, label: 'Cmt' },
    { key: 'sun' as const, label: 'Paz' },
  ];

  currentStep = signal<StepKey>('welcome');
  currentIndex = computed(() => this.steps.findIndex((s) => s.key === this.currentStep()));
  currentStepMeta = computed(() => this.steps[this.currentIndex()]);

  completedSteps = signal<Set<StepKey>>(new Set());
  stepError = signal<string | null>(null);
  saving = signal(false);
  copied = signal<string | null>(null);

  existingStore = signal<{ id: string; name: string } | null>(null);
  whatsappConfig = signal<WhatsAppConfigDto | null>(null);
  notifyPhones = signal<string[]>([]);

  storeForm = {
    name: '',
    address: '',
    phone: '',
    lat: 41.0082,
    lng: 28.9784,
  };

  whatsappForm = {
    phoneNumberId: '',
    wabaId: '',
    accessToken: '',
    appSecret: '',
  };

  workingHours: Record<string, WorkingHoursDay> = {
    mon: { open: '10:00', close: '22:00', closed: false },
    tue: { open: '10:00', close: '22:00', closed: false },
    wed: { open: '10:00', close: '22:00', closed: false },
    thu: { open: '10:00', close: '22:00', closed: false },
    fri: { open: '10:00', close: '23:00', closed: false },
    sat: { open: '10:00', close: '23:00', closed: false },
    sun: { open: '11:00', close: '22:00', closed: false },
  };

  newPhone = '';

  webhookUrl = computed(() => {
    const tenantId = this.authService.tenant()?.id || '';
    return `${window.location.origin}/api/whatsapp/webhook/${tenantId}`;
  });

  verifyToken = computed(() => this.whatsappConfig()?.webhookVerifyToken || 'whatres-verify-token');

  ngOnInit(): void {
    this.loadExistingData();
  }

  private loadExistingData(): void {
    this.storeService.getStores().subscribe({
      next: (res) => {
        if (res.success && res.data && res.data.length > 0) {
          const first = res.data[0];
          this.existingStore.set({ id: first.id, name: first.name });
          this.storeForm.name = first.name;
          this.storeForm.address = first.address || '';
          this.storeForm.phone = first.phone || '';
          this.storeForm.lat = first.lat;
          this.storeForm.lng = first.lng;
          this.completedSteps.update((s) => new Set(s).add('store'));
        }
      },
    });

    this.waConfigService.getConfig().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.whatsappConfig.set(res.data);
          this.whatsappForm.phoneNumberId = res.data.phoneNumberId;
          this.whatsappForm.wabaId = res.data.wabaId;
          this.completedSteps.update((s) => new Set(s).add('whatsapp'));
        }
      },
    });

    this.http
      .get<{ success: boolean; data: { phones: string[] } }>(
        `${environment.apiBaseUrl}/integrations/order-notify-phones`,
        { headers: this.authService.getAuthHeaders() },
      )
      .subscribe({
        next: (res) => {
          if (res.success) this.notifyPhones.set(res.data.phones || []);
        },
      });

    this.http
      .get<{ success: boolean; data: { workingHours: Record<string, WorkingHoursDay> | null } }>(
        `${environment.apiBaseUrl}/integrations/working-hours`,
        { headers: this.authService.getAuthHeaders() },
      )
      .subscribe({
        next: (res) => {
          if (res.success && res.data.workingHours) {
            this.workingHours = { ...this.workingHours, ...res.data.workingHours };
          }
        },
      });
  }

  next(): void {
    this.stepError.set(null);
    const i = this.currentIndex();
    if (i < this.steps.length - 1) {
      this.currentStep.set(this.steps[i + 1].key);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  back(): void {
    this.stepError.set(null);
    const i = this.currentIndex();
    if (i > 0) {
      this.currentStep.set(this.steps[i - 1].key);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  jumpToStep(index: number): void {
    if (index < this.currentIndex()) {
      this.stepError.set(null);
      this.currentStep.set(this.steps[index].key);
    }
  }

  markStepDone(step: StepKey): void {
    this.completedSteps.update((s) => new Set(s).add(step));
  }

  saveStore(): void {
    if (!this.storeForm.name.trim()) {
      this.stepError.set('Şube adı boş olamaz');
      return;
    }
    this.saving.set(true);
    this.stepError.set(null);

    const existing = this.existingStore();
    const op = existing
      ? this.storeService.updateStore(existing.id, {
          name: this.storeForm.name,
          address: this.storeForm.address || undefined,
          phone: this.storeForm.phone || undefined,
          lat: this.storeForm.lat,
          lng: this.storeForm.lng,
        })
      : this.storeService.createStore({
          name: this.storeForm.name,
          address: this.storeForm.address || undefined,
          phone: this.storeForm.phone || undefined,
          lat: this.storeForm.lat,
          lng: this.storeForm.lng,
        });

    op.subscribe({
      next: (res) => {
        this.saving.set(false);
        if (res.success) {
          this.markStepDone('store');
          this.dialog.success('Şube bilgileri kaydedildi');
          this.next();
        } else {
          this.stepError.set(res.error?.message || 'Şube kaydedilemedi');
        }
      },
      error: (err) => {
        this.saving.set(false);
        this.stepError.set(err.error?.error?.message || 'Şube kaydedilemedi');
      },
    });
  }

  saveWhatsApp(): void {
    const { phoneNumberId, wabaId, accessToken, appSecret } = this.whatsappForm;
    if (!phoneNumberId || !wabaId || !accessToken || !appSecret) {
      this.stepError.set('Tüm WhatsApp alanları zorunludur');
      return;
    }
    this.saving.set(true);
    this.stepError.set(null);

    this.waConfigService
      .saveConfig({ phoneNumberId, wabaId, accessToken, appSecret })
      .subscribe({
        next: (res) => {
          this.saving.set(false);
          if (res.success) {
            this.whatsappConfig.set(res.data || null);
            this.markStepDone('whatsapp');
            this.dialog.success('WhatsApp yapılandırması kaydedildi');
            this.next();
          } else {
            this.stepError.set(res.error?.message || 'Kaydedilemedi');
          }
        },
        error: (err) => {
          this.saving.set(false);
          this.stepError.set(err.error?.error?.message || 'Kaydedilemedi');
        },
      });
  }

  toggleDayClosed(dayKey: string): void {
    this.workingHours[dayKey].closed = !this.workingHours[dayKey].closed;
  }

  addPhone(): void {
    const phone = this.newPhone.trim();
    if (!phone) return;
    // Simple normalisation — backend will re-normalise
    const cleaned = phone.replace(/[^\d+]/g, '');
    if (cleaned.length < 10) {
      this.stepError.set('Geçersiz telefon numarası');
      return;
    }
    this.notifyPhones.update((list) => [...list, cleaned]);
    this.newPhone = '';
  }

  removePhone(index: number): void {
    this.notifyPhones.update((list) => list.filter((_, i) => i !== index));
  }

  saveOperations(): void {
    this.saving.set(true);
    this.stepError.set(null);
    const headers = this.authService.getAuthHeaders();

    const hoursReq = this.http.put(
      `${environment.apiBaseUrl}/integrations/working-hours`,
      { workingHours: this.workingHours },
      { headers },
    );
    const phonesReq = this.http.put(
      `${environment.apiBaseUrl}/integrations/order-notify-phones`,
      { phones: this.notifyPhones() },
      { headers },
    );

    let done = 0;
    const onDone = (ok: boolean, err?: string) => {
      done++;
      if (!ok && !this.stepError()) this.stepError.set(err || 'Kaydedilemedi');
      if (done === 2) {
        this.saving.set(false);
        if (!this.stepError()) {
          this.markStepDone('operations');
          this.dialog.success('Operasyon ayarları kaydedildi');
          this.next();
        }
      }
    };

    hoursReq.subscribe({
      next: () => onDone(true),
      error: (err) => onDone(false, err.error?.error?.message),
    });
    phonesReq.subscribe({
      next: () => onDone(true),
      error: (err) => onDone(false, err.error?.error?.message),
    });
  }

  copy(value: string, key: string): void {
    navigator.clipboard.writeText(value).then(() => {
      this.copied.set(key);
      setTimeout(() => this.copied.set(null), 2000);
    });
  }

  skipOnboarding(): void {
    this.markCompleteInStorage();
    this.router.navigate(['/']);
  }

  finish(): void {
    this.markCompleteInStorage();
    this.router.navigate(['/']);
  }

  private markCompleteInStorage(): void {
    const tenantId = this.authService.tenant()?.id;
    if (tenantId) {
      try {
        localStorage.setItem(`whatres_onboarding_done_${tenantId}`, '1');
      } catch {
        /* ignore storage failures */
      }
    }
  }
}
