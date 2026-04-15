import { Injectable, signal } from '@angular/core';

export type DialogVariant = 'info' | 'success' | 'warning' | 'danger';
export type ToastType = 'success' | 'info' | 'warning' | 'error';

export interface DialogConfig {
  title?: string;
  message: string;
  variant?: DialogVariant;
  confirmText?: string;
  cancelText?: string;
}

export interface DialogState extends DialogConfig {
  id: number;
  type: 'alert' | 'confirm';
  resolve: (result: boolean) => void;
}

export interface ToastState {
  id: number;
  message: string;
  type: ToastType;
}

@Injectable({ providedIn: 'root' })
export class DialogService {
  private nextId = 1;

  readonly dialogs = signal<DialogState[]>([]);
  readonly toasts = signal<ToastState[]>([]);

  alert(message: string, config: Partial<DialogConfig> = {}): Promise<void> {
    return new Promise<void>((resolve) => {
      const id = this.nextId++;
      const dialog: DialogState = {
        id,
        type: 'alert',
        message,
        title: config.title,
        variant: config.variant ?? 'info',
        confirmText: config.confirmText ?? 'Tamam',
        resolve: () => resolve(),
      };
      this.dialogs.update((list) => [...list, dialog]);
    });
  }

  confirm(message: string, config: Partial<DialogConfig> = {}): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const id = this.nextId++;
      const dialog: DialogState = {
        id,
        type: 'confirm',
        message,
        title: config.title,
        variant: config.variant ?? 'danger',
        confirmText: config.confirmText ?? 'Evet',
        cancelText: config.cancelText ?? 'İptal',
        resolve,
      };
      this.dialogs.update((list) => [...list, dialog]);
    });
  }

  resolveDialog(id: number, result: boolean): void {
    const dialog = this.dialogs().find((d) => d.id === id);
    if (!dialog) return;
    dialog.resolve(result);
    this.dialogs.update((list) => list.filter((d) => d.id !== id));
  }

  toast(message: string, type: ToastType = 'info', durationMs = 4000): void {
    const id = this.nextId++;
    this.toasts.update((list) => [...list, { id, message, type }]);
    setTimeout(() => this.dismissToast(id), durationMs);
  }

  success(message: string, durationMs = 4000): void {
    this.toast(message, 'success', durationMs);
  }

  error(message: string, durationMs = 5000): void {
    this.toast(message, 'error', durationMs);
  }

  info(message: string, durationMs = 4000): void {
    this.toast(message, 'info', durationMs);
  }

  warning(message: string, durationMs = 4000): void {
    this.toast(message, 'warning', durationMs);
  }

  dismissToast(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }
}
