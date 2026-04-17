import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  private audio: HTMLAudioElement | null = null;
  private audioUnlocked = false;
  private repeatTimer: ReturnType<typeof setInterval> | null = null;

  soundEnabled = signal(this.loadSoundPref());

  toggleSound(): void {
    const next = !this.soundEnabled();
    this.soundEnabled.set(next);
    localStorage.setItem('whatres_sound_enabled', JSON.stringify(next));

    if (next) {
      this.unlockAudio();
    } else {
      this.stopRepeating();
    }
  }

  unlockAudio(): void {
    if (this.audioUnlocked) return;
    try {
      this.audio = new Audio('notification.wav');
      this.audio.volume = 1.0;
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

    // Play immediately
    await this.playOnce();

    // Repeat 3 times with 2 second intervals
    this.stopRepeating();
    let count = 0;
    this.repeatTimer = setInterval(async () => {
      count++;
      if (count >= 3) {
        this.stopRepeating();
        return;
      }
      await this.playOnce();
    }, 2000);
  }

  private stopRepeating(): void {
    if (this.repeatTimer) {
      clearInterval(this.repeatTimer);
      this.repeatTimer = null;
    }
  }

  private async playOnce(): Promise<void> {
    try {
      if (!this.audio) {
        this.audio = new Audio('notification.wav');
        this.audio.volume = 1.0;
      }
      this.audio.currentTime = 0;
      this.audio.volume = 1.0;
      await this.audio.play();
    } catch {
      try {
        this.audio = new Audio('notification.wav');
        this.audio.volume = 1.0;
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
