import { Component, OnInit, inject, signal, OnDestroy, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  BillingService,
  PlanDefinition,
  SubscriptionDto,
  BillingOverviewDto,
  SubscriptionPlan,
  BillingCycle,
} from '../../services/billing.service';
import { ThemeService } from '../../services/theme.service';
import { AuthService } from '../../services/auth.service';
import { IconComponent } from '../../shared/icon.component';

@Component({
  selector: 'app-billing',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IconComponent],
  template: `
    <div class="billing-standalone">
      <!-- Animated Background -->
      <div class="animated-bg">
        <div class="gradient-orb orb-1"></div>
        <div class="gradient-orb orb-2"></div>
        <div class="gradient-orb orb-3"></div>
        <div class="grid-lines"></div>
        <div class="particles" #particlesContainer></div>
      </div>

      <!-- Navigation -->
      <nav class="billing-nav">
        <a routerLink="/" class="back-link">
          <span class="back-icon"><app-icon name="arrow-left" [size]="16"/></span>
          <span>Panele Dön</span>
        </a>
        <div class="nav-brand">
          <span class="brand-icon"><app-icon name="hexagon" [size]="24"/></span>
          <span class="brand-text">Otorder</span>
        </div>
        <div class="nav-actions">
          <button class="theme-btn" (click)="themeService.toggleTheme()">
            @if (themeService.isDark()) {
              <app-icon name="sun" [size]="16"/>
            } @else {
              <app-icon name="moon" [size]="16"/>
            }
          </button>
          @if (authService.user(); as user) {
            <div class="user-avatar">{{ user.name.charAt(0) }}</div>
          }
        </div>
      </nav>

      <!-- Hero Section -->
      <header class="hero-section">
        <div class="hero-badge animate-in">
          <span class="badge-icon"><app-icon name="sparkles" [size]="14"/></span>
          <span>Abonelik Planları</span>
        </div>
        <h1 class="hero-title animate-in delay-1">
          İşletmeniz için <br/>
          <span class="gradient-text">Mükemmel Planı</span> Seçin
        </h1>
        <p class="hero-subtitle animate-in delay-2">
          Tüm planlarımız 14 günlük ücretsiz deneme ile başlar. Kredi kartı gerekmez.
        </p>
      </header>

      <!-- Billing Toggle -->
      <div class="billing-toggle-wrapper animate-in delay-3">
        <div class="billing-toggle">
          <button 
            [class.active]="selectedCycle() === 'MONTHLY'" 
            (click)="selectedCycle.set('MONTHLY')"
          >
            Aylık
          </button>
          <button 
            [class.active]="selectedCycle() === 'ANNUAL'" 
            (click)="selectedCycle.set('ANNUAL')"
          >
            Yıllık
            <span class="save-badge">2 Ay Bedava</span>
          </button>
          <div class="toggle-bg" [class.annual]="selectedCycle() === 'ANNUAL'"></div>
        </div>
      </div>

      @if (loading()) {
        <div class="loading-state">
          <div class="loading-spinner">
            <div class="spinner-ring"></div>
            <div class="spinner-ring"></div>
            <div class="spinner-ring"></div>
          </div>
          <p>Planlar yükleniyor...</p>
        </div>
      } @else {
        <!-- Plans Grid -->
        <div class="plans-container">
          <div class="plans-grid">
            @for (plan of plans(); track plan.key; let i = $index) {
              <div 
                class="plan-card animate-in" 
                [class.popular]="plan.popular"
                [class.current]="plan.key === overview()?.subscription?.plan"
                [style.animation-delay]="(i * 100 + 400) + 'ms'"
                (mouseenter)="onCardHover($event)"
                (mouseleave)="onCardLeave($event)"
              >
                @if (plan.popular) {
                  <div class="popular-ribbon">
                    <span><app-icon name="star" [size]="14"/> En Popüler</span>
                  </div>
                }
                
                @if (plan.key === overview()?.subscription?.plan) {
                  <div class="current-badge">Mevcut Plan</div>
                }

                <div class="plan-header">
                  <div class="plan-icon"><app-icon [name]="getPlanIcon(plan.key)" [size]="40"/></div>
                  <h3 class="plan-name">{{ plan.name }}</h3>
                  <p class="plan-description">{{ plan.description }}</p>
                </div>

                <div class="plan-pricing">
                  @if (plan.isFree) {
                    <div class="price-free">
                      <span class="price-amount">Ücretsiz</span>
                      <span class="price-period">14 gün</span>
                    </div>
                  } @else {
                    <div class="price-regular">
                      <span class="currency">₺</span>
                      <span class="price-amount">{{ selectedCycle() === 'MONTHLY' ? plan.monthlyPrice : Math.round(plan.annualPrice / 12) }}</span>
                      <span class="price-period">/ay</span>
                    </div>
                    @if (selectedCycle() === 'ANNUAL') {
                      <div class="annual-total">
                        Yıllık toplam: ₺{{ plan.annualPrice }}
                      </div>
                    }
                  }
                </div>

                <ul class="feature-list">
                  <li class="feature-item" [class.highlight]="plan.features.monthlyOrderLimit === -1">
                    <span class="feature-icon"><app-icon name="package" [size]="16"/></span>
                    <span class="feature-text">
                      {{ plan.features.monthlyOrderLimit === -1 ? 'Sınırsız' : plan.features.monthlyOrderLimit }} sipariş/ay
                    </span>
                  </li>
                  <li class="feature-item" [class.highlight]="plan.features.monthlyMessageLimit === -1">
                    <span class="feature-icon"><app-icon name="message-square" [size]="16"/></span>
                    <span class="feature-text">
                      {{ plan.features.monthlyMessageLimit === -1 ? 'Sınırsız' : plan.features.monthlyMessageLimit }} mesaj/ay
                    </span>
                  </li>
                  <li class="feature-item" [class.highlight]="plan.features.maxStores === -1">
                    <span class="feature-icon"><app-icon name="store" [size]="16"/></span>
                    <span class="feature-text">
                      {{ plan.features.maxStores === -1 ? 'Sınırsız' : plan.features.maxStores }} şube
                    </span>
                  </li>
                  <li class="feature-item" [class.highlight]="plan.features.maxUsers === -1">
                    <span class="feature-icon"><app-icon name="users" [size]="16"/></span>
                    <span class="feature-text">
                      {{ plan.features.maxUsers === -1 ? 'Sınırsız' : plan.features.maxUsers }} kullanıcı
                    </span>
                  </li>
                  <li class="feature-item" [class.available]="plan.features.whatsappIntegration">
                    <span class="feature-icon">
                      @if (plan.features.whatsappIntegration) {
                        <app-icon name="check" [size]="14"/>
                      } @else {
                        <app-icon name="x" [size]="14"/>
                      }
                    </span>
                    <span class="feature-text">WhatsApp Entegrasyonu</span>
                  </li>
                  <li class="feature-item" [class.available]="plan.features.analytics">
                    <span class="feature-icon">
                      @if (plan.features.analytics) {
                        <app-icon name="check" [size]="14"/>
                      } @else {
                        <app-icon name="x" [size]="14"/>
                      }
                    </span>
                    <span class="feature-text">Gelişmiş Analitik</span>
                  </li>
                  <li class="feature-item" [class.available]="plan.features.prioritySupport">
                    <span class="feature-icon">
                      @if (plan.features.prioritySupport) {
                        <app-icon name="check" [size]="14"/>
                      } @else {
                        <app-icon name="x" [size]="14"/>
                      }
                    </span>
                    <span class="feature-text">Öncelikli Destek</span>
                  </li>
                  <li class="feature-item" [class.available]="plan.features.apiAccess">
                    <span class="feature-icon">
                      @if (plan.features.apiAccess) {
                        <app-icon name="check" [size]="14"/>
                      } @else {
                        <app-icon name="x" [size]="14"/>
                      }
                    </span>
                    <span class="feature-text">API Erişimi</span>
                  </li>
                </ul>

                <div class="plan-action">
                  @if (plan.key === overview()?.subscription?.plan) {
                    <button class="btn-current" disabled>
                      <span class="btn-icon"><app-icon name="check" [size]="14"/></span>
                      Mevcut Planınız
                    </button>
                  } @else if (plan.isFree) {
                    <button class="btn-trial" disabled>
                      <span class="btn-icon"><app-icon name="gift" [size]="16"/></span>
                      Deneme Paketi
                    </button>
                  } @else {
                    <button class="btn-upgrade" (click)="selectPlan(plan)">
                      <span class="btn-icon"><app-icon name="rocket" [size]="16"/></span>
                      @if (getPlanOrder(plan.key) > getPlanOrder(overview()?.subscription?.plan || 'TRIAL')) {
                        Yükselt
                      } @else {
                        Seç
                      }
                      <span class="btn-arrow"><app-icon name="arrow-right" [size]="14"/></span>
                    </button>
                  }
                </div>

                <div class="card-glow"></div>
              </div>
            }
          </div>
        </div>

        <!-- Current Usage Section -->
        @if (overview()?.subscription) {
          <section class="usage-section animate-in delay-6">
            <h2 class="section-title">
              <span class="title-icon"><app-icon name="bar-chart" [size]="16"/></span>
              Mevcut Kullanımınız
            </h2>
            <div class="usage-grid">
              <div class="usage-card">
                <div class="usage-header">
                  <span class="usage-icon"><app-icon name="package" [size]="16"/></span>
                  <span class="usage-label">Siparişler</span>
                </div>
                <div class="usage-progress">
                  <div class="progress-bar">
                    <div 
                      class="progress-fill" 
                      [style.width.%]="overview()!.usage.orders.percentage"
                      [class.warning]="overview()!.usage.orders.percentage > 80"
                    ></div>
                  </div>
                  <div class="progress-text">
                    {{ overview()!.usage.orders.used }} / 
                    {{ overview()!.usage.orders.limit === -1 ? '∞' : overview()!.usage.orders.limit }}
                  </div>
                </div>
              </div>

              <div class="usage-card">
                <div class="usage-header">
                  <span class="usage-icon"><app-icon name="message-square" [size]="16"/></span>
                  <span class="usage-label">Mesajlar</span>
                </div>
                <div class="usage-progress">
                  <div class="progress-bar">
                    <div 
                      class="progress-fill" 
                      [style.width.%]="overview()!.usage.messages.percentage"
                      [class.warning]="overview()!.usage.messages.percentage > 80"
                    ></div>
                  </div>
                  <div class="progress-text">
                    {{ overview()!.usage.messages.used }} / 
                    {{ overview()!.usage.messages.limit === -1 ? '∞' : overview()!.usage.messages.limit }}
                  </div>
                </div>
              </div>

              <div class="usage-card">
                <div class="usage-header">
                  <span class="usage-icon"><app-icon name="store" [size]="16"/></span>
                  <span class="usage-label">Şubeler</span>
                </div>
                <div class="usage-stat">
                  <span class="stat-value">{{ overview()!.usage.stores.used }}</span>
                  <span class="stat-max">/ {{ overview()!.usage.stores.limit === -1 ? '∞' : overview()!.usage.stores.limit }}</span>
                </div>
              </div>

              <div class="usage-card">
                <div class="usage-header">
                  <span class="usage-icon"><app-icon name="users" [size]="16"/></span>
                  <span class="usage-label">Kullanıcılar</span>
                </div>
                <div class="usage-stat">
                  <span class="stat-value">{{ overview()!.usage.users.used }}</span>
                  <span class="stat-max">/ {{ overview()!.usage.users.limit === -1 ? '∞' : overview()!.usage.users.limit }}</span>
                </div>
              </div>
            </div>
          </section>
        }

        <!-- FAQ Section -->
        <section class="faq-section animate-in delay-7">
          <h2 class="section-title">
            <span class="title-icon"><app-icon name="help-circle" [size]="16"/></span>
            Sıkça Sorulan Sorular
          </h2>
          <div class="faq-grid">
            <div class="faq-item">
              <h4>Deneme süresi nasıl çalışır?</h4>
              <p>14 gün boyunca tüm Trial özellikleri ücretsiz kullanabilirsiniz. Kredi kartı bilgisi gerekmez.</p>
            </div>
            <div class="faq-item">
              <h4>Planımı istediğim zaman değiştirebilir miyim?</h4>
              <p>Evet, dilediğiniz zaman planınızı yükseltebilir veya düşürebilirsiniz.</p>
            </div>
            <div class="faq-item">
              <h4>İptal politikanız nedir?</h4>
              <p>İstediğiniz zaman iptal edebilirsiniz. Dönem sonuna kadar hizmet almaya devam edersiniz.</p>
            </div>
            <div class="faq-item">
              <h4>Ödeme yöntemleri nelerdir?</h4>
              <p>Kredi kartı ve banka kartı ile ödeme yapabilirsiniz. Tüm ödemeler güvenli şekilde iyzico ile işlenir.</p>
            </div>
          </div>
        </section>
      }

      <!-- Subscribe Modal -->
      @if (showSubscribeModal && selectedPlanData()) {
        <div class="modal-overlay" (click)="closeSubscribeModal()">
          <div class="modal-container" (click)="$event.stopPropagation()">
            <button class="modal-close" (click)="closeSubscribeModal()"><app-icon name="x" [size]="16"/></button>
            
            <div class="modal-header">
              <div class="modal-icon"><app-icon [name]="getPlanIcon(selectedPlanData()!.key)" [size]="40"/></div>
              <h2>{{ selectedPlanData()!.name }} Planı</h2>
              <div class="modal-price">
                ₺{{ selectedCycle() === 'MONTHLY' ? selectedPlanData()!.monthlyPrice : selectedPlanData()!.annualPrice }}
                <span>/{{ selectedCycle() === 'MONTHLY' ? 'ay' : 'yıl' }}</span>
              </div>
            </div>

            <form (ngSubmit)="subscribe()" class="subscribe-form">
              <div class="form-section">
                <h3><app-icon name="credit-card" [size]="16"/> Kart Bilgileri</h3>
                <div class="form-group">
                  <label>Kart Üzerindeki İsim</label>
                  <input type="text" [(ngModel)]="cardForm.cardHolderName" name="cardHolderName" required placeholder="Ad Soyad">
                </div>
                <div class="form-group">
                  <label>Kart Numarası</label>
                  <input type="text" [(ngModel)]="cardForm.cardNumber" name="cardNumber" required placeholder="5528 7900 0000 0008" maxlength="19">
                </div>
                <div class="form-row-3">
                  <div class="form-group">
                    <label>Ay</label>
                    <input type="text" [(ngModel)]="cardForm.expireMonth" name="expireMonth" required placeholder="12" maxlength="2">
                  </div>
                  <div class="form-group">
                    <label>Yıl</label>
                    <input type="text" [(ngModel)]="cardForm.expireYear" name="expireYear" required placeholder="2030" maxlength="4">
                  </div>
                  <div class="form-group">
                    <label>CVC</label>
                    <input type="text" [(ngModel)]="cardForm.cvc" name="cvc" required placeholder="123" maxlength="4">
                  </div>
                </div>
              </div>

              <div class="form-section">
                <h3><app-icon name="user" [size]="16"/> Fatura Bilgileri</h3>
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
                    <label>Posta Kodu</label>
                    <input type="text" [(ngModel)]="buyerForm.zipCode" name="zipCode" required>
                  </div>
                </div>
              </div>

              @if (subscribeError()) {
                <div class="error-alert">
                  <span class="error-icon"><app-icon name="alert-triangle" [size]="16"/></span>
                  {{ subscribeError() }}
                </div>
              }

              <div class="form-actions">
                <button type="button" class="btn-cancel" (click)="closeSubscribeModal()">İptal</button>
                <button type="submit" class="btn-submit" [disabled]="subscribing()">
                  @if (subscribing()) {
                    <span class="btn-spinner"></span>
                    İşleniyor...
                  } @else {
                    <app-icon name="credit-card" [size]="16"/> Ödeme Yap
                  }
                </button>
              </div>
            </form>
          </div>
        </div>
      }

      <!-- Footer -->
      <footer class="billing-footer">
        <div class="footer-content">
          <div class="footer-brand">
            <span class="brand-icon"><app-icon name="hexagon" [size]="24"/></span>
            <span>Otorder</span>
          </div>
          <div class="footer-links">
            <a href="#">Gizlilik Politikası</a>
            <a href="#">Kullanım Şartları</a>
            <a href="#">İletişim</a>
          </div>
          <div class="footer-secure">
            <span class="secure-icon"><app-icon name="lock" [size]="14"/></span>
            <span>Güvenli Ödeme - iyzico</span>
          </div>
        </div>
      </footer>
    </div>
  `,
  styles: [`
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');

    :host {
      display: block;
    }

    .billing-standalone {
      min-height: 100vh;
      font-family: 'Inter', sans-serif;
      background: var(--color-bg-primary);
      color: var(--color-text-primary);
      position: relative;
      overflow-x: hidden;
    }

    /* Animated Background */
    .animated-bg {
      position: fixed;
      inset: 0;
      overflow: hidden;
      pointer-events: none;
      z-index: 0;
    }

    .gradient-orb {
      position: absolute;
      border-radius: 50%;
      filter: blur(80px);
      opacity: 0.5;
      animation: float 20s ease-in-out infinite;
    }

    .orb-1 {
      width: 600px;
      height: 600px;
      background: radial-gradient(circle, #1B5583 0%, transparent 70%);
      top: -200px;
      left: -100px;
      animation-delay: 0s;
    }

    .orb-2 {
      width: 500px;
      height: 500px;
      background: radial-gradient(circle, #1B5583 0%, transparent 70%);
      top: 50%;
      right: -150px;
      animation-delay: -7s;
    }

    .orb-3 {
      width: 400px;
      height: 400px;
      background: radial-gradient(circle, #06b6d4 0%, transparent 70%);
      bottom: -100px;
      left: 30%;
      animation-delay: -14s;
    }

    @keyframes float {
      0%, 100% { transform: translate(0, 0) scale(1); }
      25% { transform: translate(50px, -50px) scale(1.1); }
      50% { transform: translate(-30px, 30px) scale(0.9); }
      75% { transform: translate(-50px, -30px) scale(1.05); }
    }

    .grid-lines {
      position: absolute;
      inset: 0;
      background-image:
        linear-gradient(var(--color-border) 1px, transparent 1px),
        linear-gradient(90deg, var(--color-border) 1px, transparent 1px);
      background-size: 60px 60px;
    }

    /* Navigation */
    .billing-nav {
      position: sticky;
      top: 0;
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px 40px;
      background: color-mix(in srgb, var(--color-bg-primary) 85%, transparent);
      backdrop-filter: blur(20px);
      border-bottom: 1px solid var(--color-border);
    }

    .back-link {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--color-text-secondary);
      text-decoration: none;
      font-size: 0.9rem;
      transition: all 0.3s;
    }

    .back-link:hover {
      color: var(--color-text-primary);
      transform: translateX(-4px);
    }

    .nav-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 700;
      font-size: 1.25rem;
    }

    .brand-icon {
      display: flex;
      align-items: center;
      color: #1B5583;
    }

    .nav-actions {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .theme-btn {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: var(--color-bg-tertiary);
      border: 1px solid var(--color-border);
      cursor: pointer;
      transition: all 0.3s;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .theme-btn:hover {
      background: var(--color-bg-elevated);
      transform: rotate(20deg);
    }

    .user-avatar {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: #1B5583;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 1rem;
    }

    /* Hero Section */
    .hero-section {
      position: relative;
      z-index: 1;
      text-align: center;
      padding: 80px 20px 40px;
      max-width: 800px;
      margin: 0 auto;
    }

    .hero-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 20px;
      background: rgba(27, 85, 131, 0.12);
      border: 1px solid rgba(27, 85, 131, 0.3);
      border-radius: 100px;
      font-size: 0.9rem;
      color: var(--color-accent-primary-hover);
      margin-bottom: 24px;
    }

    .hero-title {
      font-size: clamp(2.5rem, 6vw, 4rem);
      font-weight: 800;
      line-height: 1.1;
      margin-bottom: 20px;
      letter-spacing: -0.02em;
    }

    .gradient-text {
      color: #1B5583;
    }

    .hero-subtitle {
      font-size: 1.2rem;
      color: var(--color-text-secondary);
      max-width: 500px;
      margin: 0 auto;
    }

    /* Billing Toggle */
    .billing-toggle-wrapper {
      display: flex;
      justify-content: center;
      margin-bottom: 60px;
      position: relative;
      z-index: 1;
    }

    .billing-toggle {
      position: relative;
      display: flex;
      padding: 6px;
      background: var(--color-bg-secondary);
      border: 1px solid var(--color-border);
      border-radius: 16px;
    }

    .billing-toggle button {
      position: relative;
      z-index: 2;
      padding: 14px 32px;
      background: transparent;
      border: none;
      color: var(--color-text-secondary);
      font-size: 1rem;
      font-weight: 500;
      cursor: pointer;
      transition: color 0.3s;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .billing-toggle button.active {
      color: white;
    }

    .toggle-bg {
      position: absolute;
      top: 6px;
      left: 6px;
      width: calc(50% - 6px);
      height: calc(100% - 12px);
      background: #1B5583;
      border-radius: 12px;
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 4px 20px rgba(27, 85, 131, 0.4);
    }

    .toggle-bg.annual {
      transform: translateX(100%);
    }

    .save-badge {
      background: #10b981;
      color: white;
      padding: 4px 10px;
      border-radius: 100px;
      font-size: 0.75rem;
      font-weight: 600;
    }

    /* Loading State */
    .loading-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 100px 20px;
      position: relative;
      z-index: 1;
    }

    .loading-spinner {
      position: relative;
      width: 60px;
      height: 60px;
      margin-bottom: 20px;
    }

    .spinner-ring {
      position: absolute;
      inset: 0;
      border: 3px solid transparent;
      border-top-color: #1B5583;
      border-radius: 50%;
      animation: spin 1.2s linear infinite;
    }

    .spinner-ring:nth-child(2) {
      inset: 6px;
      border-top-color: #1B5583;
      animation-delay: -0.4s;
    }

    .spinner-ring:nth-child(3) {
      inset: 12px;
      border-top-color: #06b6d4;
      animation-delay: -0.8s;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Plans Container */
    .plans-container {
      position: relative;
      z-index: 1;
      max-width: 1400px;
      margin: 0 auto;
      padding: 0 20px;
    }

    .plans-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 24px;
      margin-bottom: 80px;
    }

    /* Plan Card */
    .plan-card {
      position: relative;
      background: var(--color-bg-elevated);
      border: 1px solid var(--color-border);
      border-radius: 24px;
      padding: 32px;
      transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
      overflow: hidden;
    }

    .plan-card:hover {
      transform: translateY(-8px);
      border-color: rgba(27, 85, 131, 0.3);
      box-shadow: 0 20px 60px rgba(27, 85, 131, 0.15);
    }

    .plan-card.popular {
      border: 2px solid #1B5583;
      background: rgba(27, 85, 131, 0.05);
    }

    .plan-card.enterprise {
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.1), rgba(251, 191, 36, 0.05));
      border-color: rgba(245, 158, 11, 0.3);
    }

    .card-glow {
      position: absolute;
      inset: 0;
      opacity: 0;
      transition: opacity 0.4s;
      background: radial-gradient(circle at var(--mouse-x, 50%) var(--mouse-y, 50%), rgba(27, 85, 131, 0.15), transparent 60%);
      pointer-events: none;
    }

    .plan-card:hover .card-glow {
      opacity: 1;
    }

    .popular-ribbon {
      position: absolute;
      top: -1px;
      left: 50%;
      transform: translateX(-50%);
      background: #1B5583;
      padding: 8px 24px;
      border-radius: 0 0 16px 16px;
      font-size: 0.85rem;
      font-weight: 600;
      color: white;
      box-shadow: 0 4px 20px rgba(27, 85, 131, 0.4);
    }

    .current-badge {
      position: absolute;
      top: 16px;
      right: 16px;
      background: #10b981;
      color: white;
      padding: 6px 14px;
      border-radius: 100px;
      font-size: 0.75rem;
      font-weight: 600;
    }

    .plan-header {
      text-align: center;
      margin-bottom: 24px;
      padding-top: 20px;
    }

    .plan-icon {
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .plan-name {
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: 8px;
    }

    .plan-description {
      color: var(--color-text-muted);
      font-size: 0.9rem;
    }

    /* Pricing */
    .plan-pricing {
      text-align: center;
      margin-bottom: 28px;
      padding: 20px;
      background: var(--color-bg-tertiary);
      border-radius: 16px;
    }

    .price-regular, .price-free, .price-custom {
      display: flex;
      align-items: baseline;
      justify-content: center;
      gap: 4px;
    }

    .currency {
      font-size: 1.5rem;
      font-weight: 600;
      color: var(--color-text-muted);
    }

    .price-amount {
      font-size: 3rem;
      font-weight: 800;
      color: var(--color-text-primary);
    }

    .price-period {
      color: var(--color-text-muted);
      font-size: 1rem;
    }

    .annual-total {
      margin-top: 8px;
      font-size: 0.85rem;
      color: var(--color-text-muted);
    }

    /* Feature List */
    .feature-list {
      list-style: none;
      padding: 0;
      margin: 0 0 28px 0;
    }

    .feature-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 0;
      border-bottom: 1px solid var(--color-border);
      color: var(--color-text-secondary);
      font-size: 0.95rem;
    }

    .feature-item.highlight {
      color: #1B5583;
      font-weight: 500;
    }

    .feature-item.available {
      color: var(--color-text-primary);
    }

    .feature-item:not(.available) .feature-icon {
      opacity: 0.4;
    }

    .feature-icon {
      display: flex;
      align-items: center;
    }

    /* Plan Actions */
    .plan-action {
      position: relative;
      z-index: 2;
    }

    .plan-action button {
      width: 100%;
      padding: 16px;
      border: none;
      border-radius: 14px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      transition: all 0.3s;
    }

    .btn-upgrade {
      background: #1B5583;
      color: white;
      box-shadow: 0 4px 20px rgba(27, 85, 131, 0.3);
    }

    .btn-upgrade:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 30px rgba(27, 85, 131, 0.4);
    }

    .btn-upgrade .btn-arrow {
      transition: transform 0.3s;
    }

    .btn-upgrade:hover .btn-arrow {
      transform: translateX(4px);
    }

    .btn-current {
      background: rgba(16, 185, 129, 0.1);
      color: #10b981;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }

    .btn-contact {
      background: linear-gradient(135deg, #f59e0b, #fbbf24);
      color: #78350f;
    }

    .btn-contact:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 30px rgba(245, 158, 11, 0.3);
    }

    .btn-trial {
      background: var(--color-bg-tertiary);
      color: var(--color-text-muted);
      border: 1px solid var(--color-border);
    }

    /* Animations */
    .animate-in {
      opacity: 0;
      transform: translateY(30px);
      animation: animate-in 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards;
    }

    .delay-1 { animation-delay: 100ms; }
    .delay-2 { animation-delay: 200ms; }
    .delay-3 { animation-delay: 300ms; }
    .delay-4 { animation-delay: 400ms; }
    .delay-5 { animation-delay: 500ms; }
    .delay-6 { animation-delay: 600ms; }
    .delay-7 { animation-delay: 700ms; }

    @keyframes animate-in {
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    /* Usage Section */
    .usage-section {
      position: relative;
      z-index: 1;
      max-width: 1200px;
      margin: 0 auto 80px;
      padding: 0 20px;
    }

    .section-title {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: 32px;
    }

    .title-icon {
      display: flex;
      align-items: center;
    }

    .usage-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
    }

    .usage-card {
      background: var(--color-bg-elevated);
      border: 1px solid var(--color-border);
      border-radius: 20px;
      padding: 24px;
    }

    .usage-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
    }

    .usage-icon {
      display: flex;
      align-items: center;
    }

    .usage-label {
      font-weight: 600;
      font-size: 1.1rem;
    }

    .progress-bar {
      height: 10px;
      background: var(--color-bg-tertiary);
      border-radius: 10px;
      overflow: hidden;
      margin-bottom: 12px;
    }

    .progress-fill {
      height: 100%;
      background: #1B5583;
      border-radius: 10px;
      transition: width 0.5s ease;
    }

    .progress-fill.warning {
      background: linear-gradient(90deg, #f59e0b, #ef4444);
    }

    .progress-text {
      font-size: 0.9rem;
      color: var(--color-text-secondary);
    }

    .usage-stat {
      display: flex;
      align-items: baseline;
      gap: 4px;
    }

    .stat-value {
      font-size: 2rem;
      font-weight: 700;
    }

    .stat-max {
      color: var(--color-text-muted);
    }

    /* FAQ Section */
    .faq-section {
      position: relative;
      z-index: 1;
      max-width: 1000px;
      margin: 0 auto 80px;
      padding: 0 20px;
    }

    .faq-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 20px;
    }

    .faq-item {
      background: var(--color-bg-elevated);
      border: 1px solid var(--color-border);
      border-radius: 16px;
      padding: 24px;
    }

    .faq-item h4 {
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 12px;
    }

    .faq-item p {
      font-size: 0.9rem;
      color: var(--color-text-secondary);
      line-height: 1.6;
    }

    /* Modal */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(10px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 20px;
      animation: fade-in 0.3s ease;
    }

    @keyframes fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .modal-container {
      background: var(--color-bg-secondary);
      border: 1px solid var(--color-border-hover);
      border-radius: 24px;
      max-width: 560px;
      width: 100%;
      max-height: 90vh;
      overflow-y: auto;
      position: relative;
      animation: slide-up 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    }

    @keyframes slide-up {
      from { opacity: 0; transform: translateY(40px) scale(0.95); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .modal-close {
      position: absolute;
      top: 20px;
      right: 20px;
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: var(--color-bg-tertiary);
      border: none;
      color: var(--color-text-primary);
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .modal-close:hover {
      background: var(--color-bg-elevated);
    }

    .modal-header {
      text-align: center;
      padding: 40px 32px 24px;
      border-bottom: 1px solid var(--color-border);
    }

    .modal-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16px;
    }

    .modal-header h2 {
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: 12px;
    }

    .modal-price {
      font-size: 2rem;
      font-weight: 800;
      color: #1B5583;
    }

    .modal-price span {
      font-size: 1rem;
      font-weight: 400;
      opacity: 0.6;
    }

    /* Form Styles */
    .subscribe-form {
      padding: 32px;
    }

    .form-section {
      margin-bottom: 28px;
    }

    .form-section h3 {
      font-size: 1.1rem;
      font-weight: 600;
      margin-bottom: 20px;
    }

    .form-group {
      margin-bottom: 16px;
    }

    .form-group label {
      display: block;
      font-size: 0.85rem;
      color: var(--color-text-secondary);
      margin-bottom: 8px;
    }

    .form-group input {
      width: 100%;
      padding: 14px 16px;
      background: var(--color-bg-tertiary);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      color: var(--color-text-primary);
      font-size: 1rem;
      transition: all 0.2s;
    }

    .form-group input:focus {
      outline: none;
      border-color: #1B5583;
      box-shadow: 0 0 0 3px rgba(27, 85, 131, 0.2);
    }

    .form-group input::placeholder {
      color: var(--color-text-muted);
    }

    .form-row-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }

    .form-row-3 {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 16px;
    }

    .error-alert {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: 12px;
      color: #ef4444;
      margin-bottom: 20px;
    }

    .form-actions {
      display: flex;
      gap: 16px;
      justify-content: flex-end;
    }

    .btn-cancel, .btn-submit {
      padding: 14px 28px;
      border: none;
      border-radius: 12px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-cancel {
      background: var(--color-bg-tertiary);
      color: var(--color-text-primary);
    }

    .btn-submit {
      background: #1B5583;
      color: white;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .btn-submit:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 8px 30px rgba(27, 85, 131, 0.4);
    }

    .btn-submit:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .btn-spinner {
      width: 20px;
      height: 20px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    /* Footer */
    .billing-footer {
      position: relative;
      z-index: 1;
      border-top: 1px solid var(--color-border);
      padding: 40px 20px;
    }

    .footer-content {
      max-width: 1200px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 24px;
    }

    .footer-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 700;
    }

    .footer-links {
      display: flex;
      gap: 32px;
    }

    .footer-links a {
      color: var(--color-text-muted);
      text-decoration: none;
      font-size: 0.9rem;
      transition: color 0.2s;
    }

    .footer-links a:hover {
      color: var(--color-text-primary);
    }

    .footer-secure {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--color-text-muted);
      font-size: 0.9rem;
    }

    /* Responsive */
    @media (max-width: 768px) {
      .billing-nav {
        padding: 16px 20px;
      }

      .nav-brand {
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
      }

      .hero-section {
        padding: 60px 20px 30px;
      }

      .plans-grid {
        grid-template-columns: 1fr;
        max-width: 400px;
        margin: 0 auto 80px;
      }

      .form-row-2, .form-row-3 {
        grid-template-columns: 1fr;
      }

      .footer-content {
        flex-direction: column;
        text-align: center;
      }
    }
  `]
})
export class BillingComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('particlesContainer') particlesContainer!: ElementRef;

  private billingService = inject(BillingService);
  themeService = inject(ThemeService);
  authService = inject(AuthService);
  private router = inject(Router);

  loading = signal(true);
  overview = signal<BillingOverviewDto | null>(null);
  plans = signal<PlanDefinition[]>([]);
  selectedCycle = signal<BillingCycle>('MONTHLY');
  selectedPlanData = signal<PlanDefinition | null>(null);
  
  showSubscribeModal = false;
  subscribing = signal(false);
  subscribeError = signal<string | null>(null);

  cardForm = {
    cardHolderName: '',
    cardNumber: '',
    expireMonth: '',
    expireYear: '',
    cvc: '',
  };

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

  Math = Math;

  ngOnInit(): void {
    this.loadData();
  }

  ngAfterViewInit(): void {
    this.createParticles();
  }

  ngOnDestroy(): void {
    // Cleanup if needed
  }

  private createParticles(): void {
    if (!this.particlesContainer) return;
    
    const container = this.particlesContainer.nativeElement;
    for (let i = 0; i < 50; i++) {
      const particle = document.createElement('div');
      particle.style.cssText = `
        position: absolute;
        width: ${Math.random() * 4 + 1}px;
        height: ${Math.random() * 4 + 1}px;
        background: rgba(27, 85, 131, ${Math.random() * 0.5 + 0.1});
        border-radius: 50%;
        left: ${Math.random() * 100}%;
        top: ${Math.random() * 100}%;
        animation: particle-float ${Math.random() * 10 + 10}s ease-in-out infinite;
        animation-delay: ${Math.random() * 5}s;
      `;
      container.appendChild(particle);
    }

    // Add keyframes
    const style = document.createElement('style');
    style.textContent = `
      @keyframes particle-float {
        0%, 100% { transform: translate(0, 0) rotate(0deg); }
        25% { transform: translate(${Math.random() * 100 - 50}px, ${Math.random() * 100 - 50}px) rotate(90deg); }
        50% { transform: translate(${Math.random() * 100 - 50}px, ${Math.random() * 100 - 50}px) rotate(180deg); }
        75% { transform: translate(${Math.random() * 100 - 50}px, ${Math.random() * 100 - 50}px) rotate(270deg); }
      }
    `;
    document.head.appendChild(style);
  }

  loadData(): void {
    this.loading.set(true);

    this.billingService.getPlans().subscribe({
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

  onCardHover(event: MouseEvent): void {
    const card = event.currentTarget as HTMLElement;
    const rect = card.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    card.style.setProperty('--mouse-x', `${x}%`);
    card.style.setProperty('--mouse-y', `${y}%`);
  }

  onCardLeave(event: MouseEvent): void {
    const card = event.currentTarget as HTMLElement;
    card.style.setProperty('--mouse-x', '50%');
    card.style.setProperty('--mouse-y', '50%');
  }

  getPlanIcon(planKey: string): string {
    const icons: Record<string, string> = {
      TRIAL: 'gift',
      STARTER: 'rocket',
      PRO: 'star',
    };
    return icons[planKey] || 'package';
  }

  getPlanOrder(plan: SubscriptionPlan | undefined): number {
    if (!plan) return 0;
    const order: Record<SubscriptionPlan, number> = {
      TRIAL: 0,
      STARTER: 1,
      PRO: 2,
    };
    return order[plan];
  }

  selectPlan(plan: PlanDefinition): void {
    this.selectedPlanData.set(plan);
    this.subscribeError.set(null);
    this.showSubscribeModal = true;
  }

  closeSubscribeModal(): void {
    this.showSubscribeModal = false;
    this.selectedPlanData.set(null);
    this.subscribeError.set(null);
  }

  subscribe(): void {
    if (!this.selectedPlanData()) return;

    this.subscribing.set(true);
    this.subscribeError.set(null);

    this.billingService.subscribe({
      planKey: this.selectedPlanData()!.key,
      billingCycle: this.selectedCycle(),
      card: this.cardForm,
      buyer: this.buyerForm,
      saveCard: true,
    }).subscribe({
      next: (res) => {
        this.subscribing.set(false);
        if (res.success) {
          this.closeSubscribeModal();
          this.loadData();
          alert('Aboneliğiniz başarıyla aktifleştirildi!');
        } else {
          this.subscribeError.set(res.error?.message || 'Ödeme işlemi başarısız');
        }
      },
      error: (err) => {
        this.subscribing.set(false);
        this.subscribeError.set(err.error?.error?.message || 'Bir hata oluştu');
      },
    });
  }

  contactSales(): void {
    window.open('mailto:sales@otorder.com?subject=Enterprise Plan İletişim', '_blank');
  }
}
