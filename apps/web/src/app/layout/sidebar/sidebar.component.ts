import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';

interface NavItem {
  label: string;
  icon: string;
  path: string;
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  template: `
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="logo">
          <span class="logo-icon">◈</span>
          <span class="logo-text">Otorder</span>
        </div>
        @if (authService.tenant(); as tenant) {
          <div class="tenant-badge">
            <span class="tenant-name">{{ tenant.name }}</span>
          </div>
        }
      </div>

      <nav class="sidebar-nav">
        <ul class="nav-list">
          @for (item of navItems; track item.path) {
            <li class="nav-item">
              <a
                [routerLink]="item.path"
                routerLinkActive="active"
                [routerLinkActiveOptions]="{ exact: item.path === '/' }"
                class="nav-link"
              >
                <span class="nav-icon">{{ item.icon }}</span>
                <span class="nav-label">{{ item.label }}</span>
              </a>
            </li>
          }
        </ul>
      </nav>

      <div class="sidebar-footer">
        @if (authService.user(); as user) {
          <a routerLink="/me" class="user-info" routerLinkActive="active">
            <div class="user-avatar">{{ user.name.charAt(0).toUpperCase() }}</div>
            <div class="user-details">
              <span class="user-name">{{ user.name }}</span>
              <span class="user-role text-muted">{{ user.role }}</span>
            </div>
          </a>
        }
        <button class="logout-btn" (click)="logout()" title="Sign out">
          <span>🚪</span>
        </button>
      </div>
    </aside>
  `,
  styles: [
    `
      .sidebar {
        position: fixed;
        left: 0;
        top: 0;
        bottom: 0;
        width: var(--sidebar-width);
        background: var(--color-bg-secondary);
        border-right: 1px solid var(--color-border);
        display: flex;
        flex-direction: column;
        z-index: 100;
      }

      .sidebar-header {
        padding: var(--spacing-lg);
        border-bottom: 1px solid var(--color-border);
      }

      .logo {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-md);
      }

      .logo-icon {
        font-size: 1.75rem;
        color: var(--color-accent-primary);
      }

      .logo-text {
        font-size: 1.25rem;
        font-weight: 700;
        letter-spacing: -0.02em;
      }

      .tenant-badge {
        padding: var(--spacing-xs) var(--spacing-sm);
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-sm);
        font-size: 0.75rem;
      }

      .tenant-name {
        color: var(--color-text-secondary);
      }

      .sidebar-nav {
        flex: 1;
        padding: var(--spacing-md);
        overflow-y: auto;
      }

      .nav-list {
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }

      .nav-link {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        padding: var(--spacing-sm) var(--spacing-md);
        border-radius: var(--radius-md);
        color: var(--color-text-secondary);
        transition: all var(--transition-fast);
        font-weight: 500;

        &:hover {
          background: var(--color-bg-tertiary);
          color: var(--color-text-primary);
        }

        &.active {
          background: var(--color-bg-elevated);
          color: var(--color-text-primary);

          .nav-icon {
            color: var(--color-accent-primary);
          }
        }
      }

      .nav-icon {
        font-size: 1.25rem;
        width: 24px;
        text-align: center;
      }

      .nav-label {
        font-size: 0.9375rem;
      }

      .sidebar-footer {
        padding: var(--spacing-md);
        border-top: 1px solid var(--color-border);
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }

      .user-info {
        flex: 1;
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        padding: var(--spacing-sm);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: background var(--transition-fast);
        text-decoration: none;
        color: inherit;

        &:hover,
        &.active {
          background: var(--color-bg-tertiary);
        }
      }

      .user-avatar {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: var(--color-accent-primary);
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 600;
        font-size: 0.875rem;
        color: white;
      }

      .user-details {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .user-name {
        font-weight: 500;
        font-size: 0.875rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .user-role {
        font-size: 0.75rem;
        text-transform: capitalize;
      }

      .logout-btn {
        width: 36px;
        height: 36px;
        border-radius: var(--radius-md);
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: 1px solid var(--color-border);
        cursor: pointer;
        transition: all var(--transition-fast);
        font-size: 1rem;

        &:hover {
          background: rgba(239, 68, 68, 0.1);
          border-color: rgba(239, 68, 68, 0.3);
        }
      }
    `,
  ],
})
export class SidebarComponent {
  authService = inject(AuthService);

  navItems: NavItem[] = [
    { label: 'Dashboard', icon: '◉', path: '/' },
    { label: 'Chatbot', icon: '🤖', path: '/chatbot' },
    { label: 'Inbox', icon: '💬', path: '/inbox' },
    { label: 'Siparişler', icon: '📦', path: '/orders' },
    { label: 'Menü', icon: '🍽', path: '/menu' },
    { label: 'Şubeler', icon: '🏪', path: '/stores' },
    { label: 'Yazdırma', icon: '🖨️', path: '/print-jobs' },
    { label: 'Anketler', icon: '📊', path: '/surveys' },
    { label: 'Musteriler', icon: '👥', path: '/customers' },
    { label: 'Kampanyalar', icon: '📢', path: '/campaigns' },
    { label: 'Ayarlar', icon: '⚙', path: '/settings' },
  ];

  logout(): void {
    this.authService.logout();
  }
}
