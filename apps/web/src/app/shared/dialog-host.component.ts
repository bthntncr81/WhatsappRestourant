import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogService, DialogState, ToastState } from './dialog.service';
import { IconComponent } from './icon.component';

@Component({
  selector: 'app-dialog-host',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <!-- Dialogs -->
    @for (dialog of dialogService.dialogs(); track dialog.id) {
      <div class="dialog-overlay" (click)="onOverlayClick(dialog)">
        <div
          class="dialog"
          [class]="'variant-' + (dialog.variant || 'info')"
          role="dialog"
          aria-modal="true"
          (click)="$event.stopPropagation()"
        >
          <div class="dialog-head">
            <div class="dialog-icon">
              <app-icon [name]="iconFor(dialog)" [size]="22"/>
            </div>
            <div class="dialog-text">
              @if (dialog.title) {
                <h3>{{ dialog.title }}</h3>
              } @else {
                <h3>{{ defaultTitleFor(dialog) }}</h3>
              }
              <p>{{ dialog.message }}</p>
            </div>
          </div>

          <div class="dialog-actions">
            @if (dialog.type === 'confirm') {
              <button type="button" class="btn btn-ghost" (click)="resolve(dialog, false)">
                {{ dialog.cancelText }}
              </button>
            }
            <button
              type="button"
              class="btn"
              [class.btn-danger]="dialog.variant === 'danger'"
              [class.btn-primary]="dialog.variant !== 'danger'"
              (click)="resolve(dialog, true)"
              autofocus
            >
              {{ dialog.confirmText }}
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Toasts -->
    @if (dialogService.toasts().length > 0) {
      <div class="toast-stack" aria-live="polite">
        @for (toast of dialogService.toasts(); track toast.id) {
          <div class="toast" [class]="'toast-' + toast.type">
            <div class="toast-icon">
              <app-icon [name]="iconForToast(toast)" [size]="16"/>
            </div>
            <div class="toast-message">{{ toast.message }}</div>
            <button type="button" class="toast-close" (click)="dialogService.dismissToast(toast.id)" aria-label="Kapat">
              <app-icon name="x" [size]="14"/>
            </button>
          </div>
        }
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }

      /* ===== Dialogs ===== */
      .dialog-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.55);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        z-index: 10000;
        animation: fade-in 0.18s ease;
      }

      @keyframes fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      .dialog {
        background: var(--color-bg-elevated, #fff);
        border: 1px solid var(--color-border, #e5e7eb);
        border-radius: 16px;
        max-width: 460px;
        width: 100%;
        padding: 24px 24px 20px;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.35);
        animation: dialog-in 0.22s cubic-bezier(0.4, 0, 0.2, 1);
      }

      @keyframes dialog-in {
        from {
          opacity: 0;
          transform: translateY(16px) scale(0.96);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      .dialog-head {
        display: flex;
        gap: 14px;
        align-items: flex-start;
        margin-bottom: 24px;
      }

      .dialog-icon {
        flex-shrink: 0;
        width: 42px;
        height: 42px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .variant-info .dialog-icon {
        background: color-mix(in srgb, var(--color-accent-primary, #1B5583) 12%, transparent);
        color: var(--color-accent-primary, #1B5583);
      }
      .variant-success .dialog-icon {
        background: rgba(16, 185, 129, 0.12);
        color: #10b981;
      }
      .variant-warning .dialog-icon {
        background: rgba(245, 158, 11, 0.12);
        color: #f59e0b;
      }
      .variant-danger .dialog-icon {
        background: rgba(239, 68, 68, 0.12);
        color: #ef4444;
      }

      .dialog-text {
        flex: 1;
        min-width: 0;
      }

      .dialog-text h3 {
        font-size: 1.05rem;
        font-weight: 700;
        margin: 0 0 6px;
        color: var(--color-text-primary, #111827);
      }

      .dialog-text p {
        font-size: 0.9rem;
        line-height: 1.55;
        margin: 0;
        color: var(--color-text-secondary, #4b5563);
        white-space: pre-line;
      }

      .dialog-actions {
        display: flex;
        gap: 10px;
        justify-content: flex-end;
      }

      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 10px 20px;
        border-radius: 10px;
        border: 1px solid transparent;
        font-size: 0.9rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s;
        font-family: inherit;
        min-width: 90px;
      }

      .btn-primary {
        background: var(--color-accent-primary, #1B5583);
        color: white;
      }
      .btn-primary:hover {
        background: var(--color-accent-primary-hover, #154269);
        transform: translateY(-1px);
      }

      .btn-danger {
        background: #ef4444;
        color: white;
      }
      .btn-danger:hover {
        background: #dc2626;
        transform: translateY(-1px);
      }

      .btn-ghost {
        background: var(--color-bg-secondary, #f3f4f6);
        color: var(--color-text-primary, #111827);
        border-color: var(--color-border, #e5e7eb);
      }
      .btn-ghost:hover {
        background: var(--color-bg-tertiary, #e5e7eb);
      }

      /* ===== Toasts ===== */
      .toast-stack {
        position: fixed;
        top: 20px;
        right: 20px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        z-index: 9999;
        pointer-events: none;
        max-width: calc(100vw - 40px);
      }

      .toast {
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        background: var(--color-bg-elevated, #fff);
        border: 1px solid var(--color-border, #e5e7eb);
        border-left: 4px solid;
        border-radius: 10px;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15);
        min-width: 280px;
        max-width: 420px;
        animation: toast-in 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      }

      @keyframes toast-in {
        from {
          opacity: 0;
          transform: translateX(24px);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }

      .toast-success { border-left-color: #10b981; }
      .toast-success .toast-icon { color: #10b981; }
      .toast-error { border-left-color: #ef4444; }
      .toast-error .toast-icon { color: #ef4444; }
      .toast-warning { border-left-color: #f59e0b; }
      .toast-warning .toast-icon { color: #f59e0b; }
      .toast-info { border-left-color: var(--color-accent-primary, #1B5583); }
      .toast-info .toast-icon { color: var(--color-accent-primary, #1B5583); }

      .toast-icon {
        display: flex;
        align-items: center;
        flex-shrink: 0;
      }

      .toast-message {
        flex: 1;
        font-size: 0.88rem;
        line-height: 1.4;
        color: var(--color-text-primary, #111827);
        word-wrap: break-word;
      }

      .toast-close {
        flex-shrink: 0;
        width: 22px;
        height: 22px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: none;
        background: transparent;
        color: var(--color-text-muted, #6b7280);
        cursor: pointer;
        border-radius: 4px;
        transition: background 0.15s;
      }
      .toast-close:hover {
        background: var(--color-bg-tertiary, #e5e7eb);
        color: var(--color-text-primary, #111827);
      }

      @media (max-width: 520px) {
        .toast-stack {
          top: 12px;
          right: 12px;
          left: 12px;
        }
        .toast {
          min-width: 0;
        }
        .dialog {
          padding: 20px 18px 16px;
        }
      }
    `,
  ],
})
export class DialogHostComponent {
  dialogService = inject(DialogService);

  resolve(dialog: DialogState, result: boolean): void {
    this.dialogService.resolveDialog(dialog.id, result);
  }

  onOverlayClick(dialog: DialogState): void {
    // alerts can be dismissed with overlay click; confirms require explicit choice
    if (dialog.type === 'alert') {
      this.resolve(dialog, true);
    }
  }

  iconFor(dialog: DialogState): string {
    switch (dialog.variant) {
      case 'success':
        return 'check';
      case 'warning':
        return 'alert-triangle';
      case 'danger':
        return 'alert-triangle';
      default:
        return 'info';
    }
  }

  defaultTitleFor(dialog: DialogState): string {
    if (dialog.type === 'confirm') {
      switch (dialog.variant) {
        case 'danger':
          return 'Onaylıyor musunuz?';
        case 'warning':
          return 'Dikkat';
        default:
          return 'Onay';
      }
    }
    switch (dialog.variant) {
      case 'success':
        return 'Başarılı';
      case 'warning':
        return 'Uyarı';
      case 'danger':
        return 'Hata';
      default:
        return 'Bilgi';
    }
  }

  iconForToast(toast: ToastState): string {
    switch (toast.type) {
      case 'success':
        return 'check';
      case 'error':
        return 'alert-triangle';
      case 'warning':
        return 'alert-triangle';
      default:
        return 'info';
    }
  }
}
