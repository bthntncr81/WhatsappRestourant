import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../services/auth.service';
import { IconComponent } from '../../shared/icon.component';
import { DialogService } from '../../shared/dialog.service';

interface FeedbackMessage {
  id: string;
  direction: 'IN' | 'OUT';
  kind: string;
  text: string | null;
  rating: number | null;
  ratingNote: string | null;
  createdAt: string;
}

interface FeedbackConversation {
  id: string;
  customerPhone: string;
  customerName: string | null;
  messages: FeedbackMessage[];
}

@Component({
  selector: 'app-ai-feedback',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div class="feedback-page">
      <header class="fb-header">
        <h1>AI Feedback Panel</h1>
        <div class="fb-controls">
          <input type="date" [(ngModel)]="selectedDate" (change)="loadConversations()" class="date-input"/>
          <button class="btn-primary" (click)="loadDailyPrompt()">Günlük Prompt Oluştur</button>
        </div>
      </header>

      @if (loading()) {
        <div class="loading">Yükleniyor...</div>
      }

      @if (dailyPrompt()) {
        <div class="prompt-box">
          <div class="prompt-header">
            <h2>Günlük AI İyileştirme Prompt'u ({{ selectedDate }})</h2>
            <button class="btn-ghost" (click)="copyPrompt()">Kopyala</button>
          </div>
          <pre class="prompt-text">{{ dailyPrompt() }}</pre>
        </div>
      }

      <div class="conversations">
        @for (conv of conversations(); track conv.id) {
          <div class="conv-card">
            <div class="conv-header">
              <span class="conv-phone">{{ conv.customerName || conv.customerPhone }}</span>
              <span class="conv-id">{{ conv.customerPhone }}</span>
            </div>
            <div class="conv-messages">
              @for (msg of conv.messages; track msg.id) {
                <div class="fb-msg" [class.out]="msg.direction === 'OUT'" [class.in]="msg.direction === 'IN'">
                  <div class="msg-bubble">
                    <span class="msg-dir">{{ msg.direction === 'IN' ? 'MÜŞTERİ' : 'BOT' }}</span>
                    <span class="msg-text">{{ msg.text || '[' + msg.kind + ']' }}</span>
                    <span class="msg-time">{{ formatTime(msg.createdAt) }}</span>
                  </div>
                  @if (msg.direction === 'OUT' && msg.kind === 'TEXT') {
                    <div class="rating-row">
                      <button
                        class="rate-btn"
                        [class.active]="msg.rating === 1"
                        [class.wrong]="msg.rating === 1"
                        (click)="rate(msg, 1)"
                        title="Yanlış"
                      >✗</button>
                      <button
                        class="rate-btn"
                        [class.active]="msg.rating === 2"
                        [class.partial]="msg.rating === 2"
                        (click)="rate(msg, 2)"
                        title="Kısmi"
                      >~</button>
                      <button
                        class="rate-btn"
                        [class.active]="msg.rating === 3"
                        [class.correct]="msg.rating === 3"
                        (click)="rate(msg, 3)"
                        title="Doğru"
                      >✓</button>
                      @if (msg.rating && msg.rating <= 2) {
                        <input
                          type="text"
                          class="note-input"
                          [value]="msg.ratingNote || ''"
                          placeholder="Neden yanlış?"
                          (blur)="saveNote(msg, $event)"
                        />
                      }
                    </div>
                  }
                </div>
              }
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .feedback-page {
      max-width: 960px;
      margin: 0 auto;
      padding: 24px;
      min-height: 100vh;
      background: var(--color-bg-primary);
      color: var(--color-text-primary);
    }
    .fb-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      flex-wrap: wrap;
      gap: 12px;
    }
    .fb-header h1 { font-size: 1.5rem; font-weight: 800; }
    .fb-controls { display: flex; gap: 10px; align-items: center; }
    .date-input {
      padding: 8px 14px;
      background: var(--color-bg-secondary);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      color: var(--color-text-primary);
      font-size: 0.9rem;
    }
    .btn-primary {
      padding: 8px 18px;
      background: var(--color-accent-primary, #1a5276);
      color: white;
      border: none;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-ghost {
      padding: 6px 14px;
      background: var(--color-bg-secondary);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      cursor: pointer;
      font-size: 0.85rem;
      color: var(--color-text-primary);
    }
    .loading { text-align: center; padding: 40px; color: var(--color-text-muted); }
    .prompt-box {
      background: var(--color-bg-elevated);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .prompt-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .prompt-header h2 { font-size: 1rem; font-weight: 700; }
    .prompt-text {
      white-space: pre-wrap;
      font-size: 0.82rem;
      line-height: 1.6;
      color: var(--color-text-secondary);
      max-height: 400px;
      overflow-y: auto;
      background: var(--color-bg-secondary);
      padding: 16px;
      border-radius: 8px;
    }
    .conv-card {
      background: var(--color-bg-elevated);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      margin-bottom: 16px;
      overflow: hidden;
    }
    .conv-header {
      padding: 12px 16px;
      background: var(--color-bg-secondary);
      border-bottom: 1px solid var(--color-border);
      display: flex;
      justify-content: space-between;
    }
    .conv-phone { font-weight: 600; font-size: 0.9rem; }
    .conv-id { font-size: 0.78rem; color: var(--color-text-muted); }
    .conv-messages { padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
    .fb-msg { display: flex; flex-direction: column; gap: 4px; }
    .fb-msg.in .msg-bubble { align-self: flex-start; background: var(--color-bg-secondary); }
    .fb-msg.out .msg-bubble { align-self: flex-end; background: var(--color-accent-primary, #1a5276); color: white; }
    .msg-bubble {
      padding: 8px 12px;
      border-radius: 10px;
      max-width: 80%;
      font-size: 0.85rem;
      line-height: 1.45;
    }
    .msg-dir { font-size: 0.68rem; font-weight: 700; opacity: 0.7; display: block; }
    .msg-text { display: block; }
    .msg-time { display: block; font-size: 0.65rem; opacity: 0.6; text-align: right; margin-top: 4px; }
    .fb-msg.out .rating-row { align-self: flex-end; }
    .rating-row {
      display: flex;
      gap: 4px;
      align-items: center;
    }
    .rate-btn {
      width: 28px;
      height: 28px;
      border-radius: 6px;
      border: 1px solid var(--color-border);
      background: var(--color-bg-secondary);
      cursor: pointer;
      font-weight: 700;
      font-size: 0.85rem;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--color-text-muted);
      transition: all 0.15s;
    }
    .rate-btn:hover { background: var(--color-bg-tertiary); }
    .rate-btn.active.wrong { background: #fee2e2; color: #ef4444; border-color: #ef4444; }
    .rate-btn.active.partial { background: #fef3c7; color: #f59e0b; border-color: #f59e0b; }
    .rate-btn.active.correct { background: #d1fae5; color: #10b981; border-color: #10b981; }
    .note-input {
      flex: 1;
      padding: 4px 10px;
      border: 1px solid var(--color-border);
      border-radius: 6px;
      font-size: 0.78rem;
      background: var(--color-bg-secondary);
      color: var(--color-text-primary);
      min-width: 150px;
    }
  `],
})
export class AiFeedbackComponent implements OnInit {
  private http = inject(HttpClient);
  private authService = inject(AuthService);
  private dialog = inject(DialogService);

  loading = signal(false);
  conversations = signal<FeedbackConversation[]>([]);
  dailyPrompt = signal<string | null>(null);
  selectedDate = new Date().toISOString().split('T')[0];

  ngOnInit(): void {
    this.loadConversations();
  }

  loadConversations(): void {
    this.loading.set(true);
    this.dailyPrompt.set(null);
    this.http
      .get<{ success: boolean; data: FeedbackConversation[] }>(
        `${environment.apiBaseUrl}/integrations/ai-feedback/conversations?date=${this.selectedDate}`,
        { headers: this.authService.getAuthHeaders() },
      )
      .subscribe({
        next: (res) => {
          if (res.success) this.conversations.set(res.data);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  rate(msg: FeedbackMessage, rating: number): void {
    this.http
      .patch<{ success: boolean }>(
        `${environment.apiBaseUrl}/integrations/ai-feedback/rate/${msg.id}`,
        { rating },
        { headers: this.authService.getAuthHeaders() },
      )
      .subscribe({
        next: () => { msg.rating = rating; },
      });
  }

  saveNote(msg: FeedbackMessage, event: Event): void {
    const note = (event.target as HTMLInputElement).value;
    this.http
      .patch<{ success: boolean }>(
        `${environment.apiBaseUrl}/integrations/ai-feedback/rate/${msg.id}`,
        { rating: msg.rating, note },
        { headers: this.authService.getAuthHeaders() },
      )
      .subscribe({
        next: () => { msg.ratingNote = note; },
      });
  }

  loadDailyPrompt(): void {
    this.http
      .get<{ success: boolean; data: { prompt: string | null; badCount?: number } }>(
        `${environment.apiBaseUrl}/integrations/ai-feedback/daily-prompt?date=${this.selectedDate}`,
        { headers: this.authService.getAuthHeaders() },
      )
      .subscribe({
        next: (res) => {
          if (res.success) {
            this.dailyPrompt.set(res.data.prompt);
            if (!res.data.prompt) this.dialog.success('Bugün kötü puanlı mesaj yok — tebrikler!');
          }
        },
      });
  }

  copyPrompt(): void {
    const prompt = this.dailyPrompt();
    if (prompt) {
      navigator.clipboard.writeText(prompt).then(() => this.dialog.success('Prompt kopyalandı'));
    }
  }

  formatTime(dateStr: string): string {
    return new Date(dateStr).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  }
}
