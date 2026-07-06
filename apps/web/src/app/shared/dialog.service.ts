import { Injectable, signal } from '@angular/core';

export type DialogVariant = 'info' | 'success' | 'warning' | 'danger';
export type ToastType = 'success' | 'info' | 'warning' | 'error';

export interface DialogConfig {
  title?: string;
  message: string;
  variant?: DialogVariant;
  confirmText?: string;
  cancelText?: string;
  /** 'large' renders a bigger, more prominent modal (e.g. account suspended). */
  size?: 'normal' | 'large';
  /** When false, the alert cannot be dismissed by clicking the overlay. */
  dismissible?: boolean;
  /** When set, a second dialog with the same key is suppressed while one is open. */
  dedupeKey?: string;
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
  /** Keys of dialogs opened via alertOnce() that are still showing. */
  private readonly activeKeys = new Set<string>();

  readonly dialogs = signal<DialogState[]>([]);
  readonly toasts = signal<ToastState[]>([]);

  /**
   * Show an alert that can only be open once at a time for a given `key`.
   * Repeated calls while one is already showing are ignored. Used by the
   * subscription gate so a flurry of 403s doesn't stack identical modals.
   */
  alertOnce(key: string, message: string, config: Partial<DialogConfig> = {}): Promise<void> {
    if (this.activeKeys.has(key)) return Promise.resolve();
    this.activeKeys.add(key);
    return this.alert(message, config).finally(() => this.activeKeys.delete(key));
  }

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
        size: config.size ?? 'normal',
        dismissible: config.dismissible ?? true,
        resolve: () => resolve(),
      };
      this.dialogs.update((list) => [...list, dialog]);
    });
  }

  confirm(message: string, config: Partial<DialogConfig> = {}): Promise<boolean> {
    // Dedupe: if a confirm with the same key is already open, don't stack another.
    if (config.dedupeKey) {
      if (this.activeKeys.has(config.dedupeKey)) return Promise.resolve(false);
      this.activeKeys.add(config.dedupeKey);
    }
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
        size: config.size ?? 'normal',
        dismissible: config.dismissible ?? true,
        resolve: (result: boolean) => {
          if (config.dedupeKey) this.activeKeys.delete(config.dedupeKey);
          resolve(result);
        },
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
