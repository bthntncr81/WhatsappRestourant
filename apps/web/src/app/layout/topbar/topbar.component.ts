import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { BillingService, SubscriptionDto } from '../../services/billing.service';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <header class="topbar">
      <div class="topbar-left">
        <div class="breadcrumb">
          <span class="breadcrumb-item text-muted">Home</span>
          <span class="breadcrumb-separator text-muted">/</span>
          <span class="breadcrumb-item active">Dashboard</span>
        </div>
      </div>

      <div class="topbar-center">
        <div class="search-container">
          <span class="search-icon">⌕</span>
          <input
            type="text"
            class="search-input"
            placeholder="Search..."
          />
          <kbd class="search-shortcut">⌘K</kbd>
        </div>
      </div>

      <div class="topbar-right">
        <!-- Upgrade Button -->
        @if (subscription()) {
          <a routerLink="/billing" class="upgrade-btn" [class.trial]="subscription()!.plan === 'TRIAL'">
            @if (subscription()!.plan === 'TRIAL') {
              <span class="upgrade-icon">⚡</span>
              <span class="upgrade-text">Paketi Yükselt</span>
              @if (subscription()!.daysUntilTrialEnds) {
                <span class="trial-badge">{{ subscription()!.daysUntilTrialEnds }} gün</span>
              }
            } @else {
              <span class="plan-badge">{{ getPlanName(subscription()!.plan) }}</span>
            }
          </a>
        }

        <button class="topbar-action" title="Notifications">
          <span class="action-icon">🔔</span>
          <span class="notification-badge">3</span>
        </button>
        <button class="topbar-action theme-toggle" (click)="themeService.toggleTheme()" [title]="themeService.isDark() ? 'Light Mode' : 'Dark Mode'">
          <span class="action-icon">{{ themeService.isDark() ? '☀️' : '🌙' }}</span>
        </button>
        <button class="topbar-action" title="Help">
          <span class="action-icon">?</span>
        </button>
      </div>
    </header>
  `,
  styles: [
    `
      .topbar {
        height: var(--topbar-height);
        background: var(--color-bg-secondary);
        border-bottom: 1px solid var(--color-border);
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 var(--spacing-lg);
        gap: var(--spacing-lg);
      }

      .topbar-left,
      .topbar-right {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
      }

      .topbar-center {
        flex: 1;
        max-width: 480px;
      }

      .breadcrumb {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        font-size: 0.875rem;
      }

      .breadcrumb-item.active {
        color: var(--color-text-primary);
        font-weight: 500;
      }

      .search-container {
        position: relative;
        display: flex;
        align-items: center;
      }

      .search-icon {
        position: absolute;
        left: var(--spacing-md);
        color: var(--color-text-muted);
        font-size: 1rem;
      }

      .search-input {
        width: 100%;
        height: 40px;
        background: var(--color-bg-tertiary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        padding: 0 var(--spacing-2xl) 0 calc(var(--spacing-md) + 24px);
        color: var(--color-text-primary);
        font-size: 0.875rem;
        transition: all var(--transition-fast);

        &::placeholder {
          color: var(--color-text-muted);
        }

        &:focus {
          outline: none;
          border-color: var(--color-accent-primary);
          background: var(--color-bg-elevated);
        }
      }

      .search-shortcut {
        position: absolute;
        right: var(--spacing-md);
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        padding: 2px 6px;
        font-family: var(--font-mono);
        font-size: 0.75rem;
        color: var(--color-text-muted);
      }

      .topbar-action {
        position: relative;
        width: 36px;
        height: 36px;
        border-radius: var(--radius-md);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--color-text-secondary);
        transition: all var(--transition-fast);

        &:hover {
          background: var(--color-bg-tertiary);
          color: var(--color-text-primary);
        }
      }

      .action-icon {
        font-size: 1rem;
      }

      .notification-badge {
        position: absolute;
        top: 4px;
        right: 4px;
        min-width: 16px;
        height: 16px;
        background: var(--color-accent-danger);
        border-radius: 8px;
        font-size: 0.625rem;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 4px;
      }

      .upgrade-btn {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 16px;
        background: #1B5583;
        border-radius: 8px;
        color: white;
        font-size: 0.875rem;
        font-weight: 600;
        text-decoration: none;
        transition: all 0.2s;
        margin-right: 8px;
      }

      .upgrade-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(27, 85, 131, 0.4);
      }

      .upgrade-btn.trial {
        animation: pulse 2s infinite;
      }

      @keyframes pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(27, 85, 131, 0.4); }
        50% { box-shadow: 0 0 0 8px rgba(27, 85, 131, 0); }
      }

      .upgrade-icon {
        font-size: 1rem;
      }

      .trial-badge {
        background: rgba(255, 255, 255, 0.2);
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 0.75rem;
      }

      .plan-badge {
        background: var(--color-bg-tertiary);
        color: var(--color-text-primary);
        padding: 6px 12px;
        border-radius: 6px;
        font-size: 0.8rem;
        font-weight: 500;
      }
    `,
  ],
})
export class TopbarComponent implements OnInit {
  private billingService = inject(BillingService);
  themeService = inject(ThemeService);
  
  subscription = signal<SubscriptionDto | null>(null);

  ngOnInit(): void {
    this.loadSubscription();
  }

  loadSubscription(): void {
    this.billingService.getSubscription().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.subscription.set(res.data);
        }
      },
      error: () => {
        // Ignore errors - subscription might not exist yet
      },
    });
  }

  getPlanName(plan: string): string {
    const names: Record<string, string> = {
      TRIAL: 'Deneme',
      STARTER: 'Starter',
      PRO: 'Pro',
    };
    return names[plan] || plan;
  }
}


