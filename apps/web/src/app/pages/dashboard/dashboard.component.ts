import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { IconComponent } from '../../shared/icon.component';
import { environment } from '../../../environments/environment';

interface HealthData {
  status: string;
  timestamp: string;
  uptime: number;
  version: string;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="dashboard">
      <div class="dashboard-header">
        <h1 class="dashboard-title">Dashboard</h1>
        <p class="dashboard-subtitle text-secondary">
          Welcome back! Here's what's happening.
        </p>
      </div>

      <div class="stats-grid">
        @for (stat of stats; track stat.label) {
          <div class="stat-card">
            <div class="stat-icon" [style.background]="stat.color">
              <app-icon [name]="stat.icon" [size]="22" />
            </div>
            <div class="stat-content">
              <span class="stat-value">{{ stat.value }}</span>
              <span class="stat-label text-muted">{{ stat.label }}</span>
            </div>
          </div>
        }
      </div>

      <div class="api-status-card">
        <h2 class="card-title">API Status</h2>
        @if (loading) {
          <div class="loading-state">
            <div class="loader"></div>
            <span class="text-muted">Checking API health...</span>
          </div>
        } @else if (healthData) {
          <div class="health-info">
            <div class="health-row">
              <span class="health-label">Status</span>
              <span class="health-value status-badge" [class.online]="healthData.status === 'ok'">
                {{ healthData.status === 'ok' ? 'Online' : 'Offline' }}
              </span>
            </div>
            <div class="health-row">
              <span class="health-label">Version</span>
              <span class="health-value font-mono">{{ healthData.version }}</span>
            </div>
            <div class="health-row">
              <span class="health-label">Uptime</span>
              <span class="health-value font-mono">{{ formatUptime(healthData.uptime) }}</span>
            </div>
            <div class="health-row">
              <span class="health-label">Last Check</span>
              <span class="health-value font-mono">{{ healthData.timestamp | date:'medium' }}</span>
            </div>
          </div>
        } @else if (error) {
          <div class="error-state">
            <app-icon name="alert-triangle" [size]="20" class="error-icon"/>
            <span class="error-message">{{ error }}</span>
            <button class="retry-btn" (click)="checkHealth()">Retry</button>
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .dashboard {
        max-width: 1200px;
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

      .dashboard-header {
        margin-bottom: var(--spacing-xl);
      }

      .dashboard-title {
        font-size: 2rem;
        font-weight: 700;
        letter-spacing: -0.02em;
        margin-bottom: var(--spacing-xs);
      }

      .dashboard-subtitle {
        font-size: 1rem;
      }

      .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: var(--spacing-md);
        margin-bottom: var(--spacing-xl);
      }

      .stat-card {
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        padding: var(--spacing-lg);
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        transition: all var(--transition-fast);

        &:hover {
          border-color: var(--color-border-hover);
          transform: translateY(-2px);
        }
      }

      .stat-icon {
        width: 48px;
        height: 48px;
        border-radius: var(--radius-md);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
      }

      .stat-content {
        display: flex;
        flex-direction: column;
      }

      .stat-value {
        font-size: 1.5rem;
        font-weight: 700;
        letter-spacing: -0.02em;
      }

      .stat-label {
        font-size: 0.875rem;
      }

      .api-status-card {
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        padding: var(--spacing-lg);
      }

      .card-title {
        font-size: 1.125rem;
        font-weight: 600;
        margin-bottom: var(--spacing-lg);
      }

      .loading-state {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        padding: var(--spacing-md);
      }

      .loader {
        width: 20px;
        height: 20px;
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

      .health-info {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
      }

      .health-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--spacing-sm) 0;
        border-bottom: 1px solid var(--color-border);

        &:last-child {
          border-bottom: none;
        }
      }

      .health-label {
        color: var(--color-text-secondary);
        font-size: 0.875rem;
      }

      .health-value {
        font-size: 0.875rem;
      }

      .status-badge {
        padding: var(--spacing-xs) var(--spacing-sm);
        border-radius: var(--radius-sm);
        background: var(--color-accent-danger);
        color: white;
        font-weight: 500;
        font-size: 0.75rem;
        text-transform: uppercase;

        &.online {
          background: var(--color-accent-success);
        }
      }

      .error-state {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        padding: var(--spacing-md);
        background: rgba(239, 68, 68, 0.1);
        border-radius: var(--radius-md);
      }

      .error-icon {
        font-size: 1.25rem;
        color: var(--color-accent-danger);
      }

      .error-message {
        flex: 1;
        color: var(--color-accent-danger);
      }

      .retry-btn {
        padding: var(--spacing-xs) var(--spacing-md);
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-primary);
        font-size: 0.875rem;
        transition: all var(--transition-fast);

        &:hover {
          background: var(--color-bg-tertiary);
        }
      }
    `,
  ],
})
export class DashboardComponent implements OnInit {
  private http = inject(HttpClient);

  loading = true;
  healthData: HealthData | null = null;
  error: string | null = null;

  stats = [
    { label: 'Total Users', value: '1,234', icon: 'users', color: 'var(--color-accent-primary)' },
    { label: 'Active Projects', value: '56', icon: 'folder', color: '#14b8a6' },
    { label: 'Tasks Completed', value: '892', icon: 'check', color: '#22c55e' },
    { label: 'Pending Issues', value: '23', icon: 'alert-triangle', color: '#f59e0b' },
  ];

  ngOnInit(): void {
    this.checkHealth();
  }

  checkHealth(): void {
    this.loading = true;
    this.error = null;

    this.http.get<ApiResponse<HealthData>>(`${environment.apiBaseUrl}/health`).subscribe({
      next: (response) => {
        this.healthData = response.data ?? null;
        this.loading = false;
      },
      error: (err) => {
        this.error = err.message || 'Failed to connect to API';
        this.loading = false;
      },
    });
  }

  formatUptime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours}h ${minutes}m ${secs}s`;
  }
}


