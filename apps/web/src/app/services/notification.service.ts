import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  private audio: HTMLAudioElement | null = null;
  private audioUnlocked = false;

  soundEnabled = signal(this.loadSoundPref());

  toggleSound(): void {
    const next = !this.soundEnabled();
    this.soundEnabled.set(next);
    localStorage.setItem('whatres_sound_enabled', JSON.stringify(next));

    if (next) {
      this.unlockAudio();
    }
  }

  unlockAudio(): void {
    if (this.audioUnlocked) return;
    try {
      this.audio = new Audio('notification.wav');
      this.audio.volume = 0.6;
      const p = this.audio.play();
      if (p) {
        p.then(() => {
          this.audio!.pause();
          this.audio!.currentTime = 0;
          this.audioUnlocked = true;
        }).catch(() => { /* autoplay blocked */ });
      }
    } catch { /* ignore */ }
  }

  async playOrderNotification(): Promise<void> {
    if (!this.soundEnabled()) return;

    try {
      if (!this.audio) {
        this.audio = new Audio('notification.wav');
        this.audio.volume = 0.6;
      }
      this.audio.currentTime = 0;
      await this.audio.play();
    } catch {
      // Fallback: try creating new Audio instance
      try {
        this.audio = new Audio('notification.wav');
        this.audio.volume = 0.6;
        await this.audio.play();
      } catch { /* silent fail */ }
    }
  }

  private loadSoundPref(): boolean {
    try {
      const val = localStorage.getItem('whatres_sound_enabled');
      return val === null ? true : JSON.parse(val);
    } catch {
      return true;
    }
  }
}
