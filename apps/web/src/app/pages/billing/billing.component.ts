import { Component, OnInit, OnDestroy, inject, signal, computed, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  BillingService,
  PlanDefinition,
  BillingOverviewDto,
  SubscriptionPlan,
  BillingCycle,
} from '../../services/billing.service';
import { ThemeService } from '../../services/theme.service';
import { AuthService } from '../../services/auth.service';
import { IconComponent } from '../../shared/icon.component';
import { DialogService } from '../../shared/dialog.service';

interface ComparisonRow {
  label: string;
  values: {
    TRIAL: string | boolean;
    SILVER: string | boolean;
    GOLD: string | boolean;
    PLATINUM: string | boolean;
  };
}

@Component({
  selector: 'app-billing',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IconComponent],
  template: `
    <div class="billing-page">
      <!-- Top Navigation -->
      <nav class="top-nav">
        <a routerLink="/" class="nav-back">
          <app-icon name="arrow-left" [size]="16"/>
          <span>Panele Dön</span>
        </a>
        <div class="nav-brand">
          <span style="font-family: var(--font-display, inherit); font-weight:800; letter-spacing:-0.03em;">OtOrder</span>
          <span style="display:inline-flex; align-items:center; height:20px; padding:0 7px; border-radius:6px; background:#bb1e10; color:#fff; font-family: var(--font-display, inherit); font-size:11px; font-weight:800; letter-spacing:0.07em;">AI</span>
        </div>
        <div class="nav-right">
          <button class="icon-btn" (click)="themeService.toggleTheme()" [attr.aria-label]="'Tema'">
            @if (themeService.isDark()) {
              <app-icon name="sun" [size]="16"/>
            } @else {
              <app-icon name="moon" [size]="16"/>
            }
          </button>
          @if (authService.user(); as user) {
            <div class="avatar">{{ user.name.charAt(0) }}</div>
          }
        </div>
      </nav>

      <!-- Expiry Warning Banner -->
      @if (overview()?.subscription?.status === 'EXPIRED' || overview()?.subscription?.status === 'UNPAID') {
        <div class="expiry-banner">
          <app-icon name="alert-triangle" [size]="18"/>
          <div class="expiry-text">
            <strong>Aboneliğinizin süresi doldu!</strong>
            Hesabınız askıya alınmıştır. Hizmetlere erişmek için lütfen ödemenizi yapın.
          </div>
          <button class="btn btn-primary btn-sm" (click)="selectPlan(getCurrentPlanDef()!)">
            Şimdi Öde
          </button>
        </div>
      }
      @if (overview()?.subscription?.status === 'ACTIVE' && getDaysRemaining() !== null && getDaysRemaining()! <= 3) {
        <div class="expiry-banner warn">
          <app-icon name="clock" [size]="18"/>
          <div class="expiry-text">
            <strong>Aboneliğiniz {{ getDaysRemaining() }} gün sonra sona erecek.</strong>
            Kesintisiz hizmet için lütfen ödemenizi zamanında yapın.
          </div>
          <button class="btn btn-primary btn-sm" (click)="selectPlan(getCurrentPlanDef()!)">
            Yenile
          </button>
        </div>
      }

      <!-- Hero -->
      <section class="hero">
        <span class="eyebrow">Fiyatlandırma</span>
        <h1>İşletmeniz için doğru planı seçin</h1>
        <p class="lede">
          İşletmenize en uygun planı seçin. İstediğiniz zaman yükseltin veya iptal edin.
        </p>

        <!-- Billing cycle toggle -->
        <div class="cycle-toggle" role="tablist" aria-label="Faturalama dönemi">
          <button
            role="tab"
            [attr.aria-selected]="selectedCycle() === 'MONTHLY'"
            [class.active]="selectedCycle() === 'MONTHLY'"
            (click)="selectedCycle.set('MONTHLY')"
          >
            Aylık
          </button>
          <button
            role="tab"
            [attr.aria-selected]="selectedCycle() === 'ANNUAL'"
            [class.active]="selectedCycle() === 'ANNUAL'"
            (click)="selectedCycle.set('ANNUAL')"
          >
            Yıllık
            <span class="save-chip">İndirimli</span>
          </button>
        </div>
      </section>

      @if (loading()) {
        <div class="loading">
          <div class="spinner"></div>
          <p>Planlar yükleniyor…</p>
        </div>
      } @else {
        <!-- Plans -->
        <section class="plans">
          @for (plan of plans(); track plan.key) {
            <article
              class="plan-card"
              [class.popular]="plan.popular"
              [class.current]="plan.key === currentPlanKey()"
            >
              @if (plan.popular) {
                <div class="badge-popular">En popüler</div>
              }
              @if (plan.key === currentPlanKey()) {
                <div class="badge-current">Mevcut plan</div>
              }

              <header class="plan-head">
                <h3>{{ plan.name }}</h3>
                <p>{{ plan.description }}</p>
              </header>

              <div class="plan-price">
                @if (plan.isFree) {
                  <div class="amount-row">
                    <span class="amount">Ücretsiz</span>
                  </div>
                  <span class="period">14 gün deneme</span>
                } @else {
                  @if (selectedCycle() === 'ANNUAL') {
                    <div class="amount-row">
                      <span class="currency">₺</span>
                      <span class="amount">{{ annualMonthly(plan).toLocaleString('tr-TR') }}</span>
                      <span class="per">/ay</span>
                    </div>
                    <span class="period">Yıllık ₺{{ plan.annualPrice.toLocaleString('tr-TR') }} peşin</span>
                  } @else {
                    <div class="amount-row">
                      <span class="currency">₺</span>
                      <span class="amount">{{ plan.monthlyPrice.toLocaleString('tr-TR') }}</span>
                      <span class="per">/ay</span>
                    </div>
                    <span class="period">Aylık faturalanır</span>
                  }
                }
              </div>

              <ul class="plan-features">
                <li>
                  <app-icon name="check" [size]="14"/>
                  <span>{{ limitText(plan.features.monthlyOrderLimit) }} sipariş/ay</span>
                </li>
                <li>
                  <app-icon name="check" [size]="14"/>
                  <span>{{ limitText(plan.features.monthlyMessageLimit) }} mesaj/ay</span>
                </li>
                <li>
                  <app-icon name="check" [size]="14"/>
                  <span>{{ limitText(plan.features.maxStores) }} şube</span>
                </li>
                <li [class.off]="!plan.features.whatsappIntegration">
                  <app-icon [name]="plan.features.whatsappIntegration ? 'check' : 'x'" [size]="14"/>
                  <span>WhatsApp entegrasyonu</span>
                </li>
                <li [class.off]="!plan.features.analytics">
                  <app-icon [name]="plan.features.analytics ? 'check' : 'x'" [size]="14"/>
                  <span>Gelişmiş analitik</span>
                </li>
                <li [class.off]="!plan.features.prioritySupport">
                  <app-icon [name]="plan.features.prioritySupport ? 'check' : 'x'" [size]="14"/>
                  <span>Öncelikli destek</span>
                </li>
              </ul>

              <div class="plan-cta">
                @if (plan.key === currentPlanKey()) {
                  <button class="btn btn-ghost" disabled>
                    <app-icon name="check" [size]="14"/>
                    Mevcut planınız
                  </button>
                } @else {
                  <button class="btn btn-primary" (click)="selectPlan(plan)">
                    @if (planRank(plan.key) > planRank(currentPlanKey() || 'TRIAL')) {
                      Yükselt
                    } @else {
                      Planı seç
                    }
                  </button>
                }
              </div>
            </article>
          }
        </section>

        <!-- Add-ons -->
        <section class="addons">
          <header class="section-head">
            <h2>Ek Hizmetler</h2>
            <p>Planınıza ekleyebileceğiniz opsiyonel hizmetler</p>
          </header>
          <div class="addons-grid">
            <!-- POS Integration -->
            <div class="addon-card pos-addon">
              <div class="addon-icon">
                <app-icon name="package" [size]="24"/>
              </div>
              <div class="addon-info">
                <h3>POS Entegrasyonu (HighFive)</h3>
                <p>Menü otomatik senkron, siparişler direkt POS'a iletilir. Ayarlar'dan yapılandırılır.</p>
              </div>
              <div class="addon-price">
                <span class="addon-amount">₺1.000</span>
                <span class="addon-period">/ay</span>
              </div>
            </div>

            <!-- Extra Order Packs -->
            <div class="addon-card">
              <div class="addon-icon">
                <app-icon name="shopping-cart" [size]="24"/>
              </div>
              <div class="addon-info">
                <h3>Ekstra Sipariş Paketleri</h3>
                <p>Aylık limitiniz dolduğunda ek sipariş hakkı satın alın.</p>
                <div class="extra-packs">
                  <span class="pack">500 sipariş — ₺750</span>
                  <span class="pack">1.000 sipariş — ₺1.300</span>
                  <span class="pack">2.000 sipariş — ₺2.200</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- Current usage -->
        @if (overview()?.subscription) {
          <section class="usage">
            <header class="section-head">
              <h2>Mevcut kullanımınız</h2>
              <p>Bu ay kullandığınız kaynaklar</p>
            </header>
            <div class="usage-grid">
              <div class="usage-card">
                <div class="usage-top">
                  <app-icon name="package" [size]="16"/>
                  <span>Sipariş</span>
                </div>
                <div class="usage-bar">
                  <div
                    class="usage-fill"
                    [style.width.%]="overview()!.usage.orders.percentage"
                    [class.warn]="overview()!.usage.orders.percentage > 80"
                  ></div>
                </div>
                <div class="usage-text">
                  {{ overview()!.usage.orders.used }} /
                  {{ overview()!.usage.orders.limit === -1 ? '∞' : overview()!.usage.orders.limit }}
                </div>
              </div>

              <div class="usage-card">
                <div class="usage-top">
                  <app-icon name="message-square" [size]="16"/>
                  <span>Mesaj</span>
                </div>
                <div class="usage-bar">
                  <div
                    class="usage-fill"
                    [style.width.%]="overview()!.usage.messages.percentage"
                    [class.warn]="overview()!.usage.messages.percentage > 80"
                  ></div>
                </div>
                <div class="usage-text">
                  {{ overview()!.usage.messages.used }} /
                  {{ overview()!.usage.messages.limit === -1 ? '∞' : overview()!.usage.messages.limit }}
                </div>
              </div>

              <div class="usage-card">
                <div class="usage-top">
                  <app-icon name="store" [size]="16"/>
                  <span>Şube</span>
                </div>
                <div class="usage-text big">
                  {{ overview()!.usage.stores.used }}
                  <span>/ {{ overview()!.usage.stores.limit === -1 ? '∞' : overview()!.usage.stores.limit }}</span>
                </div>
              </div>
            </div>
          </section>
        }

        <!-- Subscription Status & Payment History -->
        @if (overview()?.subscription) {
          <section class="payments-section">
            <header class="section-head">
              <h2>Abonelik ve Ödemeler</h2>
              <p>Mevcut aboneliğiniz ve fatura geçmişiniz</p>
            </header>

            <!-- Subscription status banner -->
            <div class="sub-status-card" [class.expired]="overview()!.subscription.status === 'EXPIRED'" [class.active]="overview()!.subscription.status === 'ACTIVE'" [class.unpaid]="overview()!.subscription.status === 'UNPAID'">
              <div class="sub-status-left">
                <div class="sub-plan-name">
                  <app-icon name="zap" [size]="18"/>
                  {{ getPlanDisplayName(overview()!.subscription.plan) }} Plan
                </div>
                <div class="sub-status-badge" [attr.data-status]="overview()!.subscription.status">
                  {{ getStatusText(overview()!.subscription.status) }}
                </div>
              </div>
              <div class="sub-status-right">
                @if (overview()!.subscription.status === 'ACTIVE' && overview()!.subscription.currentPeriodEnd) {
                  <div class="sub-period">
                    <span class="sub-period-label">Dönem sonu:</span>
                    <span class="sub-period-date">{{ overview()!.subscription.currentPeriodEnd | date:'dd MMM yyyy' }}</span>
                  </div>
                  @if (getDaysRemaining() !== null && getDaysRemaining()! <= 7) {
                    <div class="sub-warning">
                      <app-icon name="alert-triangle" [size]="14"/>
                      {{ getDaysRemaining() }} gün kaldı — ödemenizi yapın
                    </div>
                  }
                }
                @if (overview()!.subscription.status === 'EXPIRED' || overview()!.subscription.status === 'UNPAID') {
                  <button class="btn btn-primary btn-renew" (click)="selectPlan(getCurrentPlanDef()!)">
                    <app-icon name="credit-card" [size]="14"/>
                    Şimdi Öde ve Yenile
                  </button>
                }
              </div>
            </div>

            <!-- Transaction history -->
            @if (overview()!.recentTransactions.length > 0) {
              <div class="tx-table-wrap">
                <table class="tx-table">
                  <thead>
                    <tr>
                      <th>Tarih</th>
                      <th>Açıklama</th>
                      <th>Tutar</th>
                      <th>Durum</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (tx of overview()!.recentTransactions; track tx.id) {
                      <tr>
                        <td>{{ tx.createdAt | date:'dd.MM.yyyy HH:mm' }}</td>
                        <td>{{ getTxDescription(tx) }}</td>
                        <td class="tx-amount">{{ tx.amount | number:'1.2-2' }} {{ tx.currency }}</td>
                        <td>
                          <span class="tx-status" [attr.data-status]="tx.status">
                            {{ getTxStatusText(tx.status) }}
                          </span>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <div class="tx-empty">
                <app-icon name="file-text" [size]="24"/>
                <p>Henüz ödeme geçmişi yok</p>
              </div>
            }
          </section>
        }

        <!-- Comparison table -->
        <section class="compare">
          <header class="section-head">
            <h2>Plan karşılaştırması</h2>
            <p>Tüm özellikleri yan yana inceleyin</p>
          </header>

          <div class="compare-wrapper">
            <table class="compare-table">
              <thead>
                <tr>
                  <th class="feat-col">Özellik</th>
                  <th>Gümüş</th>
                  <th class="col-popular">Gold</th>
                  <th>Platinyum</th>
                </tr>
              </thead>
              <tbody>
                @for (row of comparisonRows; track row.label) {
                  <tr>
                    <td class="feat-col">{{ row.label }}</td>
                    <td>
                      @if (isBool(row.values.SILVER)) {
                        <app-icon [name]="row.values.SILVER ? 'check' : 'x'" [size]="16"/>
                      } @else {
                        {{ row.values.SILVER }}
                      }
                    </td>
                    <td class="col-popular">
                      @if (isBool(row.values.GOLD)) {
                        <app-icon [name]="row.values.GOLD ? 'check' : 'x'" [size]="16"/>
                      } @else {
                        {{ row.values.GOLD }}
                      }
                    </td>
                    <td>
                      @if (isBool(row.values.PLATINUM)) {
                        <app-icon [name]="row.values.PLATINUM ? 'check' : 'x'" [size]="16"/>
                      } @else {
                        {{ row.values.PLATINUM }}
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        <!-- FAQ -->
        <section class="faq">
          <header class="section-head">
            <h2>Sıkça sorulan sorular</h2>
          </header>
          <div class="faq-grid">
            <div class="faq-item">
              <h4>POS entegrasyonu nedir?</h4>
              <p>Aylık ₺1.000 ek ücretle HighFive POS sisteminizle entegrasyon sağlanır. Menü otomatik senkronlanır, siparişler POS'a iletilir.</p>
            </div>
            <div class="faq-item">
              <h4>Planımı istediğim zaman değiştirebilir miyim?</h4>
              <p>Evet, dilediğiniz zaman yükseltebilir veya düşürebilirsiniz. Fark, bir sonraki fatura döneminize yansıtılır.</p>
            </div>
            <div class="faq-item">
              <h4>İptal politikanız nedir?</h4>
              <p>İstediğiniz zaman iptal edebilirsiniz. Mevcut fatura döneminiz sonuna kadar hizmet almaya devam edersiniz.</p>
            </div>
            <div class="faq-item">
              <h4>Hangi ödeme yöntemleri kabul ediliyor?</h4>
              <p>Türkiye'de geçerli tüm kredi ve banka kartları. Tüm ödemeler iyzico altyapısı üzerinden güvenli şekilde işlenir.</p>
            </div>
          </div>
        </section>
      }

      <!-- Subscribe Modal -->
      @if (showSubscribeModal && selectedPlanData()) {
        <div class="modal-overlay" (click)="closeSubscribeModal()">
          <div class="modal" [class.wide]="modalStep() === 'threeds'" (click)="$event.stopPropagation()">
            <button class="modal-close" (click)="closeSubscribeModal()" aria-label="Kapat">
              <app-icon name="x" [size]="16"/>
            </button>

            <header class="modal-head">
              <h2>{{ selectedPlanData()!.name }} planına geçiş</h2>
              <div class="modal-price">
                @if (selectedCycle() === 'ANNUAL') {
                  ₺{{ selectedPlanData()!.annualPrice.toLocaleString('tr-TR') }}
                  <span>/ yıl</span>
                } @else {
                  ₺{{ selectedPlanData()!.monthlyPrice.toLocaleString('tr-TR') }}
                  <span>/ ay</span>
                }
              </div>
            </header>

            <!-- Step indicators -->
            @if (modalStep() !== 'threeds') {
              <div class="step-indicators">
                <div class="step-dot" [class.active]="modalStep() === 'buyer'" [class.done]="modalStep() === 'card'">1</div>
                <div class="step-line" [class.done]="modalStep() === 'card'"></div>
                <div class="step-dot" [class.active]="modalStep() === 'card'">2</div>
              </div>
            }

            <!-- Step 1: Buyer info -->
            @if (modalStep() === 'buyer') {
              <form (ngSubmit)="goToCardStep()" class="modal-form">
                <div class="form-group-title">
                  <app-icon name="user" [size]="14"/>
                  <span>Fatura bilgileri</span>
                </div>
                <div class="form-row-2">
                  <div class="form-group">
                    <label>Ad</label>
                    <input type="text" [(ngModel)]="buyerForm.name" name="name" required>
                  </div>
                  <div class="form-group">
                    <label>Soyad</label>
                    <input type="text" [(ngModel)]="buyerForm.surname" name="surname" required>
                  </div>
                </div>
                <div class="form-group">
                  <label>E-posta</label>
                  <input type="email" [(ngModel)]="buyerForm.email" name="email" required>
                </div>
                <div class="form-row-2">
                  <div class="form-group">
                    <label>Telefon</label>
                    <input type="text" [(ngModel)]="buyerForm.gsmNumber" name="gsmNumber" required placeholder="+905xxxxxxxxx">
                  </div>
                  <div class="form-group">
                    <label>TC Kimlik No</label>
                    <input type="text" [(ngModel)]="buyerForm.identityNumber" name="identityNumber" required placeholder="11111111111" maxlength="11">
                  </div>
                </div>
                <div class="form-group">
                  <label>Adres</label>
                  <input type="text" [(ngModel)]="buyerForm.address" name="address" required>
                </div>
                <div class="form-row-2">
                  <div class="form-group">
                    <label>Şehir</label>
                    <input type="text" [(ngModel)]="buyerForm.city" name="city" required>
                  </div>
                  <div class="form-group">
                    <label>Posta kodu</label>
                    <input type="text" [(ngModel)]="buyerForm.zipCode" name="zipCode" required>
                  </div>
                </div>
                <div class="form-actions">
                  <button type="button" class="btn btn-ghost" (click)="closeSubscribeModal()">İptal</button>
                  <button type="submit" class="btn btn-primary">
                    Ödemeye geç
                    <app-icon name="chevron-right" [size]="14"/>
                  </button>
                </div>
              </form>
            }

            <!-- Step 2: iyzico hosted recurring subscription form (card + 3DS, inline) -->
            @if (modalStep() === 'card') {
              <div class="iyzico-checkout">
                @if (subscribeError()) {
                  <div class="form-error">
                    <app-icon name="alert-triangle" [size]="14"/>
                    {{ subscribeError() }}
                  </div>
                }
                <div id="iyzipay-checkout-form" class="responsive" style="min-height:220px;"></div>
                <div class="form-actions">
                  <button type="button" class="btn btn-ghost" (click)="modalStep.set('buyer')">
                    <app-icon name="chevron-left" [size]="14"/> Geri
                  </button>
                </div>
              </div>
            }
          </div>
        </div>
      }

      <!-- Footer -->
      <footer class="billing-footer">
        <div class="footer-inner">
          <div class="footer-brand">
            <span style="font-family: var(--font-display, inherit); font-weight:800; letter-spacing:-0.03em;">OtOrder</span>
            <span style="display:inline-flex; align-items:center; height:18px; padding:0 6px; border-radius:5px; background:#bb1e10; color:#fff; font-family: var(--font-display, inherit); font-size:10px; font-weight:800; letter-spacing:0.07em;">AI</span>
          </div>
          <div class="footer-links">
            <a href="#">Gizlilik</a>
            <a href="#">Şartlar</a>
            <a href="#">İletişim</a>
          </div>
          <div class="footer-secure">
            <app-icon name="lock" [size]="12"/>
            <span>iyzico ile güvenli ödeme</span>
          </div>
        </div>
      </footer>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }

    .billing-page {
      min-height: 100vh;
      background: var(--color-bg-primary);
      color: var(--color-text-primary);
    }

    /* ========== Top nav ========== */
    .top-nav {
      position: sticky;
      top: 0;
      z-index: 50;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 32px;
      background: color-mix(in srgb, var(--color-bg-primary) 92%, transparent);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--color-border);
    }

    .nav-back {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--color-text-secondary);
      text-decoration: none;
      font-size: 0.875rem;
      transition: color 0.15s;
    }
    .nav-back:hover { color: var(--color-text-primary); }

    .nav-brand {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
      font-size: 1rem;
      color: var(--color-text-primary);
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
      background: var(--color-bg-elevated);
      color: var(--color-text-primary);
    }

    .avatar {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: var(--color-accent-primary, #1B5583);
      color: white;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 0.875rem;
    }

    /* ========== Hero ========== */
    .hero {
      max-width: 720px;
      margin: 0 auto;
      padding: 72px 24px 40px;
      text-align: center;
    }

    .eyebrow {
      display: inline-block;
      padding: 6px 14px;
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--color-accent-primary, #1B5583);
      background: color-mix(in srgb, var(--color-accent-primary, #1B5583) 10%, transparent);
      border-radius: 100px;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      margin-bottom: 20px;
    }

    .hero h1 {
      font-size: clamp(2rem, 5vw, 3rem);
      font-weight: 800;
      line-height: 1.15;
      letter-spacing: -0.02em;
      margin: 0 0 16px;
    }

    .lede {
      font-size: 1.05rem;
      line-height: 1.6;
      color: var(--color-text-secondary);
      margin: 0 auto 32px;
      max-width: 520px;
    }

    /* ========== Cycle toggle ========== */
    .cycle-toggle {
      display: inline-flex;
      padding: 4px;
      background: var(--color-bg-secondary);
      border: 1px solid var(--color-border);
      border-radius: 12px;
    }

    .cycle-toggle button {
      padding: 10px 22px;
      background: transparent;
      border: none;
      border-radius: 9px;
      color: var(--color-text-secondary);
      font-size: 0.9rem;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s;
    }

    .cycle-toggle button:hover:not(.active) { color: var(--color-text-primary); }

    .cycle-toggle button.active {
      background: var(--color-bg-primary);
      color: var(--color-text-primary);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08), 0 0 0 1px var(--color-border);
    }

    .save-chip {
      background: #10b981;
      color: white;
      padding: 2px 8px;
      border-radius: 100px;
      font-size: 0.7rem;
      font-weight: 600;
    }

    /* ========== Loading ========== */
    .loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 80px 20px;
      color: var(--color-text-secondary);
    }
    .spinner {
      width: 36px;
      height: 36px;
      border: 3px solid var(--color-border);
      border-top-color: var(--color-accent-primary, #1B5583);
      border-radius: 50%;
      animation: spin 0.9s linear infinite;
      margin-bottom: 16px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ========== Plans ========== */
    .plans {
      max-width: 1120px;
      margin: 0 auto;
      padding: 16px 24px 80px;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 20px;
    }

    .plan-card {
      position: relative;
      background: var(--color-bg-elevated);
      border: 1px solid var(--color-border);
      border-radius: 16px;
      padding: 28px 24px;
      display: flex;
      flex-direction: column;
      transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
    }

    .plan-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.06);
    }

    .plan-card.popular {
      border-color: var(--color-accent-primary, #1B5583);
      box-shadow: 0 0 0 1px var(--color-accent-primary, #1B5583);
    }

    .plan-card.current {
      border-color: #10b981;
      box-shadow: 0 0 0 1px #10b981;
    }

    .badge-popular,
    .badge-current {
      position: absolute;
      top: -11px;
      left: 50%;
      transform: translateX(-50%);
      padding: 4px 12px;
      border-radius: 100px;
      font-size: 0.72rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }
    .badge-popular {
      background: var(--color-accent-primary, #1B5583);
      color: white;
    }
    .badge-current {
      background: #10b981;
      color: white;
    }

    .plan-head h3 {
      font-size: 1.15rem;
      font-weight: 700;
      margin: 0 0 4px;
    }
    .plan-head p {
      font-size: 0.85rem;
      color: var(--color-text-muted);
      margin: 0 0 20px;
    }

    .plan-price {
      padding: 18px 0;
      border-top: 1px solid var(--color-border);
      border-bottom: 1px solid var(--color-border);
      margin-bottom: 20px;
    }

    .amount-row {
      display: flex;
      align-items: baseline;
      gap: 4px;
    }

    .currency {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--color-text-secondary);
    }

    .amount {
      font-size: 2.5rem;
      font-weight: 800;
      line-height: 1;
      letter-spacing: -0.02em;
    }

    .per {
      font-size: 0.9rem;
      color: var(--color-text-muted);
    }

    .period {
      display: block;
      margin-top: 6px;
      font-size: 0.8rem;
      color: var(--color-text-muted);
    }

    .try-equiv {
      display: block;
      margin-top: 4px;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--color-accent-primary);
    }

    .modal-try-price {
      font-size: 0.85rem;
      color: var(--color-accent-primary);
      font-weight: 600;
      margin-top: 4px;
    }

    .step-indicators {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0;
      margin: 16px 0;
    }
    .step-dot {
      width: 28px; height: 28px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 0.75rem; font-weight: 700;
      background: var(--color-bg-tertiary); color: var(--color-text-muted);
      border: 2px solid var(--color-border);
    }
    .step-dot.active { background: var(--color-accent-primary); color: #fff; border-color: var(--color-accent-primary); }
    .step-dot.done { background: #10b981; color: #fff; border-color: #10b981; }
    .step-line { width: 40px; height: 2px; background: var(--color-border); }
    .step-line.done { background: #10b981; }

    .form-row-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }

    .modal.wide { max-width: 560px; }

    .threeds-container { width: 100%; min-height: 400px; }
    .threeds-iframe { width: 100%; min-height: 400px; border: none; border-radius: 8px; }

    /* Expiry Banner */
    .expiry-banner {
      display: flex; align-items: center; gap: 12px; padding: 14px 24px;
      background: #ef4444; color: white; border-radius: 12px;
      margin: 16px 32px 0; font-size: 0.9rem;
    }
    .expiry-banner.warn { background: #f59e0b; }
    .expiry-text { flex: 1; }
    .expiry-text strong { display: block; margin-bottom: 2px; }
    .btn-sm { padding: 8px 16px; font-size: 0.8rem; white-space: nowrap; }

    /* Payments Section */
    .payments-section { max-width: 900px; margin: 0 auto; padding: 0 32px; }

    .sub-status-card {
      display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px;
      padding: 20px 24px; border-radius: 12px; margin-bottom: 24px;
      border: 1px solid var(--color-border); background: var(--color-bg-secondary);
    }
    .sub-status-card.active { border-left: 4px solid #10b981; }
    .sub-status-card.expired { border-left: 4px solid #ef4444; background: rgba(239,68,68,0.05); }
    .sub-status-card.unpaid { border-left: 4px solid #f59e0b; background: rgba(245,158,11,0.05); }
    .sub-status-left { display: flex; align-items: center; gap: 12px; }
    .sub-plan-name { font-size: 1.1rem; font-weight: 700; display: flex; align-items: center; gap: 8px; }
    .sub-status-badge { padding: 4px 12px; border-radius: 100px; font-size: 0.75rem; font-weight: 600; }
    [data-status="ACTIVE"] { background: rgba(16,185,129,0.15); color: #059669; }
    [data-status="EXPIRED"] { background: rgba(239,68,68,0.15); color: #dc2626; }
    [data-status="UNPAID"] { background: rgba(245,158,11,0.15); color: #d97706; }
    [data-status="CANCELLED"] { background: rgba(107,114,128,0.15); color: #6b7280; }
    .sub-status-right { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
    .sub-period { font-size: 0.85rem; color: var(--color-text-secondary); }
    .sub-period-label { margin-right: 4px; }
    .sub-period-date { font-weight: 600; color: var(--color-text-primary); }
    .sub-warning { display: flex; align-items: center; gap: 6px; font-size: 0.8rem; color: #f59e0b; font-weight: 600; }
    .btn-renew { display: flex; align-items: center; gap: 6px; }

    /* Transaction Table */
    .tx-table-wrap { overflow-x: auto; border-radius: 12px; border: 1px solid var(--color-border); }
    .tx-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    .tx-table th { padding: 12px 16px; text-align: left; font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-muted); background: var(--color-bg-tertiary); border-bottom: 1px solid var(--color-border); }
    .tx-table td { padding: 12px 16px; border-bottom: 1px solid var(--color-border); }
    .tx-table tr:last-child td { border-bottom: none; }
    .tx-amount { font-weight: 600; font-family: var(--font-mono); }
    .tx-status { padding: 3px 10px; border-radius: 100px; font-size: 0.72rem; font-weight: 600; }
    .tx-status[data-status="SUCCESS"] { background: rgba(16,185,129,0.15); color: #059669; }
    .tx-status[data-status="FAILED"] { background: rgba(239,68,68,0.15); color: #dc2626; }
    .tx-status[data-status="PENDING"] { background: rgba(245,158,11,0.15); color: #d97706; }
    .tx-status[data-status="REFUNDED"] { background: rgba(107,114,128,0.15); color: #6b7280; }
    .tx-empty { text-align: center; padding: 32px; color: var(--color-text-muted); display: flex; flex-direction: column; align-items: center; gap: 8px; }

    .plan-features {
      list-style: none;
      padding: 0;
      margin: 0 0 24px;
      flex: 1;
    }

    .plan-features li {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 0;
      font-size: 0.88rem;
      color: var(--color-text-secondary);
    }
    .plan-features li app-icon { color: #10b981; flex-shrink: 0; }
    .plan-features li.off { color: var(--color-text-muted); opacity: 0.55; }
    .plan-features li.off app-icon { color: var(--color-text-muted); }

    .plan-cta .btn { width: 100%; }

    /* ========== Buttons ========== */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px 20px;
      border: 1px solid transparent;
      border-radius: 10px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
      font-family: inherit;
    }
    .btn:disabled { cursor: not-allowed; opacity: 0.7; }

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
    .btn-ghost:hover:not(:disabled) { background: var(--color-bg-tertiary); }

    /* ========== Section headers ========== */
    .section-head {
      max-width: 720px;
      margin: 0 auto 32px;
      text-align: center;
    }
    .section-head h2 {
      font-size: 1.75rem;
      font-weight: 800;
      letter-spacing: -0.01em;
      margin: 0 0 8px;
    }
    .section-head p {
      color: var(--color-text-secondary);
      font-size: 0.95rem;
      margin: 0;
    }

    /* ========== Usage ========== */
    .usage {
      max-width: 1120px;
      margin: 0 auto;
      padding: 40px 24px 60px;
    }

    .usage-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
    }

    .usage-card {
      background: var(--color-bg-elevated);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      padding: 20px;
    }

    .usage-top {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--color-text-secondary);
      font-size: 0.85rem;
      font-weight: 500;
      margin-bottom: 14px;
    }

    .usage-bar {
      height: 6px;
      background: var(--color-bg-tertiary);
      border-radius: 100px;
      overflow: hidden;
      margin-bottom: 10px;
    }
    .usage-fill {
      height: 100%;
      background: var(--color-accent-primary, #1B5583);
      border-radius: 100px;
      transition: width 0.4s ease;
    }
    .usage-fill.warn { background: #f59e0b; }

    .usage-text {
      font-size: 0.85rem;
      color: var(--color-text-muted);
      font-variant-numeric: tabular-nums;
    }
    .usage-text.big {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--color-text-primary);
    }
    .usage-text.big span {
      font-size: 0.9rem;
      font-weight: 400;
      color: var(--color-text-muted);
      margin-left: 4px;
    }

    /* ========== Comparison table ========== */
    .compare {
      max-width: 1120px;
      margin: 0 auto;
      padding: 40px 24px 60px;
    }

    .compare-wrapper {
      background: var(--color-bg-elevated);
      border: 1px solid var(--color-border);
      border-radius: 16px;
      overflow: hidden;
    }

    .compare-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }

    .compare-table th,
    .compare-table td {
      padding: 14px 20px;
      text-align: center;
      border-bottom: 1px solid var(--color-border);
    }

    .compare-table th {
      background: var(--color-bg-secondary);
      font-size: 0.8rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: var(--color-text-secondary);
    }

    .compare-table tbody tr:last-child td { border-bottom: none; }

    .compare-table .feat-col {
      text-align: left;
      color: var(--color-text-primary);
      font-weight: 500;
    }

    .compare-table .col-popular {
      background: color-mix(in srgb, var(--color-accent-primary, #1B5583) 6%, transparent);
    }
    .compare-table th.col-popular { color: var(--color-accent-primary, #1B5583); }

    .compare-table app-icon { color: #10b981; }
    .compare-table td app-icon[name="x"] { color: var(--color-text-muted); opacity: 0.5; }

    /* ========== Add-ons ========== */
    .addons {
      max-width: 1120px;
      margin: 0 auto;
      padding: 40px 24px 60px;
    }

    .addons-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
      gap: 16px;
    }

    .addon-card {
      background: var(--color-bg-elevated);
      border: 1px solid var(--color-border);
      border-radius: 14px;
      padding: 24px;
      display: flex;
      gap: 16px;
      align-items: flex-start;
      transition: border-color 0.2s;
    }
    .addon-card:hover {
      border-color: var(--color-accent-primary, #1B5583);
    }

    .addon-icon {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      background: color-mix(in srgb, var(--color-accent-primary, #1B5583) 10%, transparent);
      color: var(--color-accent-primary, #1B5583);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .addon-info {
      flex: 1;
    }
    .addon-info h3 {
      font-size: 1rem;
      font-weight: 700;
      margin: 0 0 6px;
    }
    .addon-info p {
      font-size: 0.85rem;
      color: var(--color-text-secondary);
      line-height: 1.5;
      margin: 0 0 10px;
    }

    .addon-price {
      text-align: right;
      flex-shrink: 0;
    }
    .addon-amount {
      font-size: 1.5rem;
      font-weight: 800;
      color: var(--color-text-primary);
    }
    .addon-period {
      font-size: 0.85rem;
      color: var(--color-text-muted);
    }

    .extra-packs {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .pack {
      display: inline-block;
      padding: 4px 10px;
      background: var(--color-bg-secondary);
      border: 1px solid var(--color-border);
      border-radius: 6px;
      font-size: 0.78rem;
      font-weight: 500;
      color: var(--color-text-primary);
    }

    /* ========== FAQ ========== */
    .faq {
      max-width: 960px;
      margin: 0 auto;
      padding: 40px 24px 80px;
    }

    .faq-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
    }

    .faq-item {
      padding: 20px 24px;
      background: var(--color-bg-elevated);
      border: 1px solid var(--color-border);
      border-radius: 12px;
    }
    .faq-item h4 {
      font-size: 0.95rem;
      font-weight: 600;
      margin: 0 0 6px;
    }
    .faq-item p {
      font-size: 0.88rem;
      line-height: 1.55;
      color: var(--color-text-secondary);
      margin: 0;
    }

    /* ========== Modal ========== */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(6px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      z-index: 100;
      animation: fade-in 0.2s ease;
    }
    @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }

    .modal {
      position: relative;
      background: var(--color-bg-elevated);
      border: 1px solid var(--color-border);
      border-radius: 16px;
      max-width: 520px;
      width: 100%;
      max-height: 90vh;
      overflow-y: auto;
      padding: 32px;
      animation: slide-up 0.25s ease;
    }
    @keyframes slide-up {
      from { opacity: 0; transform: translateY(16px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .modal-close {
      position: absolute;
      top: 16px;
      right: 16px;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: var(--color-bg-secondary);
      border: 1px solid var(--color-border);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--color-text-secondary);
    }
    .modal-close:hover { background: var(--color-bg-tertiary); }

    .modal-head {
      margin-bottom: 24px;
      padding-right: 40px;
    }
    .modal-head h2 {
      font-size: 1.35rem;
      font-weight: 700;
      margin: 0 0 6px;
    }
    .modal-price {
      font-size: 1.1rem;
      color: var(--color-accent-primary, #1B5583);
      font-weight: 700;
    }
    .modal-price span {
      font-weight: 400;
      color: var(--color-text-muted);
      font-size: 0.85rem;
    }

    .secure-notice {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 12px 14px;
      margin-bottom: 18px;
      background: color-mix(in srgb, #10b981 10%, transparent);
      border: 1px solid color-mix(in srgb, #10b981 30%, transparent);
      border-radius: 10px;
      color: var(--color-text-secondary);
      font-size: 0.82rem;
      line-height: 1.45;
    }
    .secure-notice app-icon { color: #10b981; flex-shrink: 0; margin-top: 2px; }

    .modal-form { display: flex; flex-direction: column; gap: 14px; }

    .form-group-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--color-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.03em;
      margin-top: 8px;
      padding-top: 14px;
      border-top: 1px solid var(--color-border);
    }
    .form-group-title:first-child {
      padding-top: 0;
      border-top: none;
      margin-top: 0;
    }

    .form-group { display: flex; flex-direction: column; gap: 6px; }
    .form-group label {
      font-size: 0.78rem;
      font-weight: 500;
      color: var(--color-text-secondary);
    }
    .form-group input {
      padding: 10px 14px;
      background: var(--color-bg-secondary);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      color: var(--color-text-primary);
      font-size: 0.9rem;
      font-family: inherit;
      transition: border-color 0.15s;
    }
    .form-group input:focus {
      outline: none;
      border-color: var(--color-accent-primary, #1B5583);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent-primary, #1B5583) 15%, transparent);
    }

    .form-row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .form-row-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }

    .form-error {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: 8px;
      color: #ef4444;
      font-size: 0.85rem;
    }

    .form-actions {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
      margin-top: 8px;
    }
    .form-actions .btn { flex: 1; }

    .btn-spin {
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255, 255, 255, 0.4);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    /* ========== Footer ========== */
    .billing-footer {
      padding: 32px 24px;
      border-top: 1px solid var(--color-border);
      background: var(--color-bg-secondary);
    }
    .footer-inner {
      max-width: 1120px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 16px;
    }
    .footer-brand {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
      color: var(--color-text-primary);
    }
    .footer-brand app-icon { color: var(--color-accent-primary, #1B5583); }
    .footer-links { display: inline-flex; gap: 24px; }
    .footer-links a {
      color: var(--color-text-muted);
      text-decoration: none;
      font-size: 0.85rem;
      transition: color 0.15s;
    }
    .footer-links a:hover { color: var(--color-text-primary); }
    .footer-secure {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--color-text-muted);
      font-size: 0.8rem;
    }

    /* ========== Responsive ========== */
    @media (max-width: 768px) {
      .top-nav { padding: 14px 20px; }
      .nav-brand { display: none; }
      .hero { padding: 48px 20px 32px; }
      .plans { padding: 16px 16px 56px; gap: 16px; }
      .plan-card { padding: 24px 20px; }
      .compare { padding: 32px 16px 48px; }
      .compare-wrapper { overflow-x: auto; }
      .compare-table { min-width: 560px; }
      .faq { padding: 32px 16px 56px; }
      .form-row-2, .form-row-3 { grid-template-columns: 1fr; }
      .modal { padding: 24px 20px; }
      .footer-inner { flex-direction: column; text-align: center; }
    }
  `]
})
export class BillingComponent implements OnInit, OnDestroy {
  private billingService = inject(BillingService);
  themeService = inject(ThemeService);
  authService = inject(AuthService);
  private router = inject(Router);
  private dialog = inject(DialogService);

  loading = signal(true);
  overview = signal<BillingOverviewDto | null>(null);
  plans = signal<PlanDefinition[]>([]);
  selectedCycle = signal<BillingCycle>('MONTHLY');
  selectedPlanData = signal<PlanDefinition | null>(null);

  showSubscribeModal = false;
  subscribing = signal(false);
  subscribeError = signal<string | null>(null);
  modalStep = signal<'buyer' | 'card' | 'threeds'>('buyer');


  currentPlanKey = computed(() => this.overview()?.subscription?.plan ?? null);

  private messageHandler?: (event: MessageEvent) => void;

  buyerForm = {
    email: '',
    name: '',
    surname: '',
    gsmNumber: '',
    identityNumber: '',
    city: 'Istanbul',
    country: 'Turkey',
    address: '',
    zipCode: '',
  };

  readonly comparisonRows: ComparisonRow[] = [
    {
      label: 'Aylık sipariş limiti',
      values: { TRIAL: '50', SILVER: '1.000', GOLD: '2.000', PLATINUM: '6.000' },
    },
    {
      label: 'Aylık mesaj limiti',
      values: { TRIAL: '200', SILVER: '4.000', GOLD: '8.000', PLATINUM: '24.000' },
    },
    {
      label: 'Şube sayısı',
      values: { TRIAL: '1', SILVER: '1', GOLD: '1', PLATINUM: '3' },
    },
    {
      label: 'WhatsApp entegrasyonu',
      values: { TRIAL: true, SILVER: true, GOLD: true, PLATINUM: true },
    },
    {
      label: 'Gelişmiş analitik',
      values: { TRIAL: false, SILVER: true, GOLD: true, PLATINUM: true },
    },
    {
      label: 'Öncelikli destek',
      values: { TRIAL: false, SILVER: false, GOLD: true, PLATINUM: true },
    },
    {
      label: 'POS entegrasyonu',
      values: { TRIAL: false, SILVER: '+₺1.000/ay', GOLD: '+₺1.000/ay', PLATINUM: '+₺1.000/ay' },
    },
    {
      label: 'Ekstra sipariş paketi',
      values: { TRIAL: false, SILVER: 'Mevcut', GOLD: 'Mevcut', PLATINUM: 'Mevcut' },
    },
  ];

  ngOnInit(): void {
    this.loadData();
    this.checkRedirectStatus();

    // Listen for postMessage from the iyzico checkout popup (via our /callback)
    this.messageHandler = (event: MessageEvent) => {
      const data = event.data as { type?: string; success?: boolean; message?: string } | null;
      if (!data) return;
      if (data.type !== 'WHATRES_BILLING_RESULT' && data.type !== 'WHATRES_3DS_RESULT') return;

      this.subscribing.set(false);
      if (data.success) {
        this.closeSubscribeModal();
        this.loadData();
        this.dialog.success(data.message || 'Aboneliğiniz başarıyla aktifleştirildi!');
      } else {
        this.modalStep.set('card');
        this.subscribeError.set(data.message || 'Ödeme tamamlanamadı');
      }
    };
    window.addEventListener('message', this.messageHandler);
  }

  /**
   * After iyzico's hosted subscription form completes, the browser is full-page
   * redirected to /api/billing/callback, which redirects back to
   * /billing?status=success|failed. Surface that result here.
   */
  private checkRedirectStatus(): void {
    try {
      const status = new URLSearchParams(window.location.search).get('status');
      if (status === 'success') {
        this.dialog.success('Aboneliğiniz başarıyla aktifleştirildi!');
        this.loadData();
      } else if (status === 'failed') {
        this.dialog.error('Ödeme tamamlanamadı. Lütfen tekrar deneyin.');
      }
      if (status) {
        window.history.replaceState({}, '', window.location.pathname);
      }
    } catch {
      // ignore malformed query strings
    }
  }

  ngOnDestroy(): void {
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
    }
  }

  loadData(): void {
    this.loading.set(true);

    // Hidden ₺1 test plan is only shown when the page is opened with ?test=1.
    const includeTest = new URLSearchParams(window.location.search).get('test') === '1';
    this.billingService.getPlans(includeTest).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.plans.set(res.data.plans);
        }
      },
    });

    this.billingService.getBillingOverview().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.overview.set(res.data);
        }
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  /** Yıllık planın aylık karşılığı (gösterim için): annualPrice / 12, yuvarlanmış. */
  annualMonthly(plan: PlanDefinition): number {
    return Math.round(plan.annualPrice / 12);
  }

  getDaysRemaining(): number | null {
    const sub = this.overview()?.subscription;
    if (!sub?.currentPeriodEnd) return null;
    const end = new Date(sub.currentPeriodEnd).getTime();
    const days = Math.ceil((end - Date.now()) / 86400000);
    return days > 0 ? days : 0;
  }

  getPlanDisplayName(plan: string): string {
    const map: Record<string, string> = { TRIAL: 'Deneme', SILVER: 'Gümüş', GOLD: 'Altın', PLATINUM: 'Platin', STARTER: 'Starter', PRO: 'Pro' };
    return map[plan] || plan;
  }

  getStatusText(status: string): string {
    const map: Record<string, string> = { ACTIVE: 'Aktif', EXPIRED: 'Süresi Dolmuş', CANCELLED: 'İptal', UNPAID: 'Ödenmemiş', PENDING: 'Beklemede' };
    return map[status] || status;
  }

  getTxDescription(tx: any): string {
    const plan = tx.plan ? this.getPlanDisplayName(tx.plan) : '';
    const cycle = tx.billingCycle === 'MONTHLY' ? 'Aylık' : tx.billingCycle === 'ANNUAL' ? 'Yıllık' : '';
    const type: Record<string, string> = {
      SUBSCRIPTION_PAYMENT: `${plan} ${cycle} Abonelik`,
      SUBSCRIPTION_RENEWAL: `${plan} Yenileme`,
      SUBSCRIPTION_UPGRADE: `${plan} Yükseltme`,
      REFUND: 'İade',
    };
    return type[tx.type] || tx.type;
  }

  getTxStatusText(status: string): string {
    const map: Record<string, string> = { PENDING: 'Beklemede', SUCCESS: 'Başarılı', FAILED: 'Başarısız', REFUNDED: 'İade Edildi' };
    return map[status] || status;
  }

  getCurrentPlanDef(): PlanDefinition | null {
    const plan = this.overview()?.subscription?.plan;
    if (!plan) return this.plans().find(p => p.key === 'SILVER') || null;
    return this.plans().find(p => p.key === plan) || this.plans().find(p => p.key === 'SILVER') || null;
  }

  limitText(n: number): string {
    if (n === -1) return 'Sınırsız';
    return n.toLocaleString('tr-TR');
  }

  planRank(plan: SubscriptionPlan | null): number {
    if (!plan) return 0;
    const order: Record<SubscriptionPlan, number> = { TRIAL: 0, TEST: 0, STARTER: 1, SILVER: 1, PRO: 2, GOLD: 2, PLATINUM: 3 };
    return order[plan];
  }

  isBool(v: string | boolean): boolean {
    return typeof v === 'boolean';
  }

  selectPlan(plan: PlanDefinition): void {
    this.openSubscribeModal(plan);
  }

  closeSubscribeModal(): void {
    this.showSubscribeModal = false;
    this.selectedPlanData.set(null);
    this.subscribeError.set(null);
  }

  goToCardStep(): void {
    if (!this.selectedPlanData()) return;
    const b = this.buyerForm;
    if (!b.name || !b.surname || !b.email || !b.gsmNumber || !b.identityNumber || !b.city || !b.address) {
      this.subscribeError.set('Lütfen tüm zorunlu alanları doldurun.');
      return;
    }
    if (b.identityNumber.length !== 11) {
      this.subscribeError.set('TC Kimlik numarası 11 haneli olmalıdır.');
      return;
    }
    this.subscribeError.set(null);
    this.subscribing.set(true);

    this.billingService
      .getCheckoutForm({
        planKey: this.selectedPlanData()!.key,
        billingCycle: this.selectedCycle(),
        buyer: this.buyerForm,
      })
      .subscribe({
        next: (res) => {
          this.subscribing.set(false);
          if (res.success && res.data?.checkoutFormContent) {
            this.modalStep.set('card');
            setTimeout(() => this.injectCheckoutForm(res.data!.checkoutFormContent), 50);
          } else {
            this.subscribeError.set((res as any).error?.message || 'Ödeme formu oluşturulamadı.');
          }
        },
        error: (err) => {
          this.subscribing.set(false);
          this.subscribeError.set(err.error?.error?.message || 'Ödeme başlatılamadı.');
        },
      });
  }

  private injectCheckoutForm(content: string): void {
    const container = document.getElementById('iyzipay-checkout-form');
    if (!container) return;
    container.innerHTML = '';
    const temp = document.createElement('div');
    temp.innerHTML = content;
    Array.from(temp.childNodes).forEach((node) => {
      if ((node as HTMLElement).tagName !== 'SCRIPT') container.appendChild(node);
    });
    Array.from(temp.querySelectorAll('script')).forEach((old) => {
      const sc = document.createElement('script');
      if (old.src) sc.src = old.src;
      else sc.text = old.textContent || '';
      document.body.appendChild(sc);
    });
  }

  openSubscribeModal(plan: PlanDefinition): void {
    this.selectedPlanData.set(plan);
    this.showSubscribeModal = true;
    this.modalStep.set('buyer');
    this.subscribeError.set(null);
    this.subscribing.set(false);
  }
}
