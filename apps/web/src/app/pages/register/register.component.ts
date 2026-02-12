import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="auth-container">
      <div class="auth-card">
        <div class="auth-header">
          <div class="logo">
            <span class="logo-icon">◈</span>
            <span class="logo-text">WhatRes</span>
          </div>
          <h1 class="auth-title">Create your workspace</h1>
          <p class="auth-subtitle text-muted">Get started with a free account</p>
        </div>

        <form class="auth-form" (ngSubmit)="onSubmit()">
          @if (error()) {
            <div class="error-alert">
              <span class="error-icon">⚠</span>
              <span>{{ error() }}</span>
            </div>
          }

          <div class="form-row">
            <div class="form-group">
              <label for="name" class="form-label">Your name</label>
              <input
                type="text"
                id="name"
                class="form-input"
                [(ngModel)]="name"
                name="name"
                placeholder="John Doe"
                required
                [disabled]="loading()"
              />
            </div>
          </div>

          <div class="form-group">
            <label for="email" class="form-label">Email</label>
            <input
              type="email"
              id="email"
              class="form-input"
              [(ngModel)]="email"
              name="email"
              placeholder="you@example.com"
              required
              [disabled]="loading()"
            />
          </div>

          <div class="form-group">
            <label for="password" class="form-label">Password</label>
            <input
              type="password"
              id="password"
              class="form-input"
              [(ngModel)]="password"
              name="password"
              placeholder="Min. 8 characters"
              required
              minlength="8"
              [disabled]="loading()"
            />
          </div>

          <div class="form-divider">
            <span class="divider-text text-muted">Workspace details</span>
          </div>

          <div class="form-group">
            <label for="tenantName" class="form-label">Workspace name</label>
            <input
              type="text"
              id="tenantName"
              class="form-input"
              [(ngModel)]="tenantName"
              name="tenantName"
              placeholder="My Company"
              required
              [disabled]="loading()"
            />
          </div>

          <div class="form-group">
            <label for="tenantSlug" class="form-label">Workspace URL</label>
            <div class="input-with-prefix">
              <span class="input-prefix text-muted">whatres.app/</span>
              <input
                type="text"
                id="tenantSlug"
                class="form-input slug-input"
                [(ngModel)]="tenantSlug"
                name="tenantSlug"
                placeholder="my-company"
                required
                pattern="[a-z0-9-]+"
                [disabled]="loading()"
              />
            </div>
            <span class="form-hint text-muted">Lowercase letters, numbers, and hyphens only</span>
          </div>

          <button type="submit" class="btn-primary" [disabled]="loading()">
            @if (loading()) {
              <span class="spinner"></span>
              Creating workspace...
            } @else {
              Create workspace
            }
          </button>
        </form>

        <div class="auth-footer">
          <p class="text-muted">
            Already have an account?
            <a routerLink="/login" class="auth-link">Sign in</a>
          </p>
        </div>
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
          rgba(99, 102, 241, 0.15),
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
        font-size: 2rem;
        background: var(--gradient-primary);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
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
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
        }

        &:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      }

      .input-with-prefix {
        display: flex;
        align-items: center;
        background: var(--color-bg-tertiary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        overflow: hidden;

        &:focus-within {
          border-color: var(--color-accent-primary);
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
        }
      }

      .input-prefix {
        padding: 0 0 0 var(--spacing-md);
        font-size: 0.875rem;
        white-space: nowrap;
      }

      .slug-input {
        border: none;
        background: transparent;
        padding-left: var(--spacing-xs);

        &:focus {
          box-shadow: none;
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
        background: var(--gradient-primary);
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
    `,
  ],
})
export class RegisterComponent {
  private authService = inject(AuthService);
  private router = inject(Router);

  name = '';
  email = '';
  password = '';
  tenantName = '';
  tenantSlug = '';
  loading = signal(false);
  error = signal<string | null>(null);

  onSubmit(): void {
    if (!this.name || !this.email || !this.password || !this.tenantName || !this.tenantSlug) {
      this.error.set('Please fill in all fields');
      return;
    }

    if (this.password.length < 8) {
      this.error.set('Password must be at least 8 characters');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    this.authService
      .register({
        name: this.name,
        email: this.email,
        password: this.password,
        tenantName: this.tenantName,
        tenantSlug: this.tenantSlug.toLowerCase(),
      })
      .subscribe({
        next: (response) => {
          if (response.success) {
            // Redirect to billing/plans page after registration
            this.router.navigate(['/billing']);
          } else {
            this.error.set(response.error?.message || 'Registration failed');
          }
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(err.error?.error?.message || 'Registration failed. Please try again.');
          this.loading.set(false);
        },
      });
  }
}


