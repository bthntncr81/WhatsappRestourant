import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService, MeResponse } from '../../services/auth.service';

@Component({
  selector: 'app-me',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="me-page">
      <div class="me-header">
        <h1 class="me-title">My Profile</h1>
        <p class="me-subtitle text-secondary">View your account and workspace information</p>
      </div>

      @if (loading()) {
        <div class="loading-state">
          <div class="loader"></div>
          <span class="text-muted">Loading profile...</span>
        </div>
      } @else if (error()) {
        <div class="error-state">
          <span class="error-icon">⚠</span>
          <span class="error-message">{{ error() }}</span>
          <button class="retry-btn" (click)="loadProfile()">Retry</button>
        </div>
      } @else if (profile()) {
        <div class="profile-grid">
          <!-- User Card -->
          <div class="profile-card">
            <div class="card-header">
              <span class="card-icon">👤</span>
              <h2 class="card-title">User Information</h2>
            </div>
            <div class="card-content">
              <div class="info-row">
                <span class="info-label">Name</span>
                <span class="info-value">{{ profile()!.user.name }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Email</span>
                <span class="info-value font-mono">{{ profile()!.user.email }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">User ID</span>
                <span class="info-value font-mono text-muted">{{ profile()!.user.id }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Role</span>
                <span class="role-badge" [attr.data-role]="profile()!.user.role">
                  {{ profile()!.user.role }}
                </span>
              </div>
            </div>
          </div>

          <!-- Tenant Card -->
          <div class="profile-card">
            <div class="card-header">
              <span class="card-icon">🏢</span>
              <h2 class="card-title">Current Workspace</h2>
            </div>
            <div class="card-content">
              <div class="info-row">
                <span class="info-label">Name</span>
                <span class="info-value">{{ profile()!.tenant.name }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Slug</span>
                <span class="info-value font-mono">{{ profile()!.tenant.slug }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Tenant ID</span>
                <span class="info-value font-mono text-muted">{{ profile()!.tenant.id }}</span>
              </div>
            </div>
          </div>

          <!-- Memberships Card -->
          <div class="profile-card full-width">
            <div class="card-header">
              <span class="card-icon">🔗</span>
              <h2 class="card-title">All Workspaces</h2>
            </div>
            <div class="card-content">
              @if (profile()!.memberships.length === 0) {
                <p class="text-muted">No workspace memberships found.</p>
              } @else {
                <div class="memberships-list">
                  @for (membership of profile()!.memberships; track membership.id) {
                    <div
                      class="membership-item"
                      [class.current]="membership.tenantId === profile()!.tenant.id"
                    >
                      <div class="membership-info">
                        <span class="membership-name">{{ membership.tenantName }}</span>
                        <span class="membership-slug font-mono text-muted">{{
                          membership.tenantSlug
                        }}</span>
                      </div>
                      <span class="role-badge small" [attr.data-role]="membership.role">
                        {{ membership.role }}
                      </span>
                    </div>
                  }
                </div>
              }
            </div>
          </div>
        </div>

        <div class="actions">
          <button class="btn-danger" (click)="logout()">
            <span>🚪</span> Sign out
          </button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .me-page {
        max-width: 900px;
        margin: 0 auto;
        animation: fadeIn 0.3s ease;
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: translateY(8px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .me-header {
        margin-bottom: var(--spacing-xl);
      }

      .me-title {
        font-size: 2rem;
        font-weight: 700;
        letter-spacing: -0.02em;
        margin-bottom: var(--spacing-xs);
      }

      .loading-state {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        padding: var(--spacing-2xl);
        justify-content: center;
      }

      .loader {
        width: 24px;
        height: 24px;
        border: 2px solid var(--color-border);
        border-top-color: var(--color-accent-primary);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      .error-state {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        padding: var(--spacing-lg);
        background: rgba(239, 68, 68, 0.1);
        border-radius: var(--radius-lg);
      }

      .error-icon {
        font-size: 1.5rem;
      }

      .error-message {
        flex: 1;
        color: var(--color-accent-danger);
      }

      .retry-btn {
        padding: var(--spacing-sm) var(--spacing-md);
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        color: var(--color-text-primary);
        cursor: pointer;
        transition: all var(--transition-fast);

        &:hover {
          background: var(--color-bg-tertiary);
        }
      }

      .profile-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: var(--spacing-lg);
      }

      .profile-card {
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        overflow: hidden;

        &.full-width {
          grid-column: 1 / -1;
        }
      }

      .card-header {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        padding: var(--spacing-lg);
        border-bottom: 1px solid var(--color-border);
        background: var(--color-bg-tertiary);
      }

      .card-icon {
        font-size: 1.25rem;
      }

      .card-title {
        font-size: 1rem;
        font-weight: 600;
      }

      .card-content {
        padding: var(--spacing-lg);
      }

      .info-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--spacing-sm) 0;
        border-bottom: 1px solid var(--color-border);

        &:last-child {
          border-bottom: none;
        }
      }

      .info-label {
        font-size: 0.875rem;
        color: var(--color-text-secondary);
      }

      .info-value {
        font-size: 0.875rem;
        font-weight: 500;
      }

      .role-badge {
        padding: var(--spacing-xs) var(--spacing-sm);
        border-radius: var(--radius-sm);
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.02em;

        &[data-role='OWNER'] {
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
          color: white;
        }

        &[data-role='ADMIN'] {
          background: rgba(99, 102, 241, 0.15);
          color: var(--color-accent-primary);
        }

        &[data-role='AGENT'] {
          background: rgba(20, 184, 166, 0.15);
          color: var(--color-accent-secondary);
        }

        &[data-role='STAFF'] {
          background: var(--color-bg-elevated);
          color: var(--color-text-secondary);
        }

        &.small {
          font-size: 0.625rem;
          padding: 2px 6px;
        }
      }

      .memberships-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }

      .membership-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--spacing-md);
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
        border: 1px solid transparent;
        transition: all var(--transition-fast);

        &.current {
          border-color: var(--color-accent-primary);
          background: rgba(99, 102, 241, 0.05);
        }

        &:hover {
          border-color: var(--color-border-hover);
        }
      }

      .membership-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .membership-name {
        font-weight: 500;
        font-size: 0.9375rem;
      }

      .membership-slug {
        font-size: 0.75rem;
      }

      .actions {
        margin-top: var(--spacing-xl);
        padding-top: var(--spacing-lg);
        border-top: 1px solid var(--color-border);
        display: flex;
        justify-content: flex-end;
      }

      .btn-danger {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-lg);
        background: rgba(239, 68, 68, 0.1);
        border: 1px solid rgba(239, 68, 68, 0.3);
        border-radius: var(--radius-md);
        color: var(--color-accent-danger);
        font-weight: 500;
        cursor: pointer;
        transition: all var(--transition-fast);

        &:hover {
          background: rgba(239, 68, 68, 0.2);
        }
      }

      @media (max-width: 768px) {
        .profile-grid {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class MeComponent implements OnInit {
  private authService = inject(AuthService);

  loading = signal(true);
  error = signal<string | null>(null);
  profile = signal<MeResponse | null>(null);

  ngOnInit(): void {
    this.loadProfile();
  }

  loadProfile(): void {
    this.loading.set(true);
    this.error.set(null);

    this.authService.getMe().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.profile.set(response.data);
        } else {
          this.error.set(response.error?.message || 'Failed to load profile');
        }
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err.error?.error?.message || 'Failed to load profile');
        this.loading.set(false);
      },
    });
  }

  logout(): void {
    this.authService.logout();
  }
}


