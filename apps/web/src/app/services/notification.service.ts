import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  private audioCtx: AudioContext | null = null;

  soundEnabled = signal(this.loadSoundPref());

  toggleSound(): void {
    const next = !this.soundEnabled();
    this.soundEnabled.set(next);
    localStorage.setItem('whatres_sound_enabled', JSON.stringify(next));
  }

  async playOrderNotification(): Promise<void> {
    if (!this.soundEnabled()) return;

    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
    }

    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    const ctx = this.audioCtx;
    const now = ctx.currentTime;

    // 3-beep ringing pattern
    for (let i = 0; i < 3; i++) {
      const start = now + i * 0.25;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.3, start);
      gain.gain.exponentialRampToValueAtTime(0.01, start + 0.15);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      osc.stop(start + 0.15);
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
