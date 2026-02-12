import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule],
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

      <div class="settings-section">
        <h2 class="section-title">API Configuration</h2>
        <div class="settings-card">
          <div class="setting-item column">
            <span class="setting-label">API Base URL</span>
            <input type="text" class="setting-input" value="http://localhost:3000/api" readonly />
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .settings {
        max-width: 800px;
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

      .settings-header {
        margin-bottom: var(--spacing-xl);
      }

      .settings-title {
        font-size: 2rem;
        font-weight: 700;
        letter-spacing: -0.02em;
        margin-bottom: var(--spacing-xs);
      }

      .settings-section {
        margin-bottom: var(--spacing-xl);
      }

      .section-title {
        font-size: 1rem;
        font-weight: 600;
        color: var(--color-text-secondary);
        margin-bottom: var(--spacing-md);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .settings-card {
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        overflow: hidden;
      }

      .setting-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--spacing-lg);
        border-bottom: 1px solid var(--color-border);

        &:last-child {
          border-bottom: none;
        }

        &.column {
          flex-direction: column;
          align-items: flex-start;
          gap: var(--spacing-sm);
        }
      }

      .setting-info {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }

      .setting-label {
        font-weight: 500;
      }

      .setting-description {
        font-size: 0.875rem;
      }

      .setting-input {
        width: 100%;
        padding: var(--spacing-sm) var(--spacing-md);
        background: var(--color-bg-tertiary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        color: var(--color-text-primary);
        font-family: var(--font-mono);
        font-size: 0.875rem;

        &:focus {
          outline: none;
          border-color: var(--color-accent-primary);
        }
      }

      .toggle {
        position: relative;
        display: inline-block;
        width: 48px;
        height: 26px;
        cursor: pointer;
      }

      .toggle input {
        opacity: 0;
        width: 0;
        height: 0;
      }

      .toggle-slider {
        position: absolute;
        inset: 0;
        background: var(--color-bg-tertiary);
        border-radius: 26px;
        transition: var(--transition-fast);

        &::before {
          content: '';
          position: absolute;
          height: 20px;
          width: 20px;
          left: 3px;
          bottom: 3px;
          background: white;
          border-radius: 50%;
          transition: var(--transition-fast);
        }
      }

      .toggle input:checked + .toggle-slider {
        background: var(--color-accent-primary);
      }

      .toggle input:checked + .toggle-slider::before {
        transform: translateX(22px);
      }
    `,
  ],
})
export class SettingsComponent {}


