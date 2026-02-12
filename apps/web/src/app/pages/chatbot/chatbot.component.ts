import { Component, inject, signal, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../services/auth.service';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

@Component({
  selector: 'app-chatbot',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="chatbot-container">
      <div class="chat-header">
        <h2>🤖 AI Chatbot Test</h2>
        <p class="subtitle">Menü siparişlerinizi test edin</p>
      </div>

      <div class="chat-messages" #messagesContainer>
        @for (msg of messages(); track $index) {
          <div class="message" [class.user]="msg.role === 'user'" [class.assistant]="msg.role === 'assistant'" [class.system]="msg.role === 'system'">
            <div class="message-avatar">
              @if (msg.role === 'user') {
                👤
              } @else if (msg.role === 'assistant') {
                🤖
              } @else {
                ⚙️
              }
            </div>
            <div class="message-content">
              <p>{{ msg.content }}</p>
              <span class="timestamp">{{ msg.timestamp | date:'HH:mm' }}</span>
            </div>
          </div>
        }
        @if (isLoading()) {
          <div class="message assistant">
            <div class="message-avatar">🤖</div>
            <div class="message-content">
              <div class="typing-indicator">
                <span></span><span></span><span></span>
              </div>
            </div>
          </div>
        }
      </div>

      <div class="chat-input-area">
        <div class="quick-actions">
          <button class="quick-btn" (click)="sendQuickMessage('Menüyü göster')">📋 Menü</button>
          <button class="quick-btn" (click)="sendQuickMessage('1 adet Adana Kebap istiyorum')">🍖 Kebap</button>
          <button class="quick-btn" (click)="sendQuickMessage('2 lahmacun ve 1 ayran')">🌮 Lahmacun</button>
          <button class="quick-btn" (click)="sendQuickMessage('Siparişimi onayla')">✅ Onayla</button>
        </div>
        <form (ngSubmit)="sendMessage()" class="input-form">
          <input
            type="text"
            [(ngModel)]="userInput"
            name="userInput"
            placeholder="Siparişinizi yazın... (örn: 2 adet döner istiyorum)"
            [disabled]="isLoading()"
            autocomplete="off"
          />
          <button type="submit" [disabled]="isLoading() || !userInput.trim()">
            @if (isLoading()) {
              ⏳
            } @else {
              📤
            }
          </button>
        </form>
      </div>

      <div class="info-panel">
        <h4>📝 Test Senaryoları</h4>
        <ul>
          <li>✅ "1 adet Adana Kebap istiyorum"</li>
          <li>✅ "2 lahmacun yanında ayran olsun"</li>
          <li>✅ "Menüde ne var?"</li>
          <li>✅ "Siparişimi iptal et"</li>
          <li>✅ "Fiyatları göster"</li>
        </ul>
      </div>
    </div>
  `,
  styles: [`
    .chatbot-container {
      display: flex;
      flex-direction: column;
      height: 100%;
      max-width: 800px;
      margin: 0 auto;
      padding: var(--spacing-lg);
      gap: var(--spacing-md);
    }

    .chat-header {
      text-align: center;
      padding: var(--spacing-md);
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: var(--radius-lg);
      color: white;
    }

    .chat-header h2 {
      margin: 0;
      font-size: 1.8rem;
    }

    .chat-header .subtitle {
      margin: var(--spacing-xs) 0 0;
      opacity: 0.9;
      font-size: 0.95rem;
    }

    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: var(--spacing-md);
      background: var(--color-bg-secondary);
      border-radius: var(--radius-lg);
      display: flex;
      flex-direction: column;
      gap: var(--spacing-md);
      min-height: 300px;
      max-height: 450px;
    }

    .message {
      display: flex;
      gap: var(--spacing-sm);
      max-width: 85%;
      animation: slideIn 0.3s ease;
    }

    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .message.user {
      align-self: flex-end;
      flex-direction: row-reverse;
    }

    .message.assistant {
      align-self: flex-start;
    }

    .message.system {
      align-self: center;
      max-width: 100%;
    }

    .message-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.2rem;
      background: var(--color-bg-tertiary);
      flex-shrink: 0;
    }

    .message.user .message-avatar {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }

    .message.assistant .message-avatar {
      background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
    }

    .message-content {
      padding: var(--spacing-sm) var(--spacing-md);
      border-radius: var(--radius-md);
      background: var(--color-bg-tertiary);
    }

    .message.user .message-content {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }

    .message.assistant .message-content {
      background: var(--color-bg-elevated);
      border: 1px solid var(--color-border);
    }

    .message.system .message-content {
      background: rgba(255, 193, 7, 0.15);
      border: 1px solid rgba(255, 193, 7, 0.3);
      color: var(--color-text-secondary);
      font-style: italic;
      text-align: center;
    }

    .message-content p {
      margin: 0;
      line-height: 1.5;
      white-space: pre-wrap;
    }

    .message-content .timestamp {
      display: block;
      font-size: 0.7rem;
      opacity: 0.6;
      margin-top: var(--spacing-xs);
    }

    .typing-indicator {
      display: flex;
      gap: 4px;
      padding: var(--spacing-xs) 0;
    }

    .typing-indicator span {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--color-text-muted);
      animation: bounce 1.4s infinite ease-in-out;
    }

    .typing-indicator span:nth-child(1) { animation-delay: -0.32s; }
    .typing-indicator span:nth-child(2) { animation-delay: -0.16s; }

    @keyframes bounce {
      0%, 80%, 100% { transform: scale(0); }
      40% { transform: scale(1); }
    }

    .chat-input-area {
      background: var(--color-bg-secondary);
      border-radius: var(--radius-lg);
      padding: var(--spacing-md);
    }

    .quick-actions {
      display: flex;
      gap: var(--spacing-sm);
      margin-bottom: var(--spacing-sm);
      flex-wrap: wrap;
    }

    .quick-btn {
      padding: var(--spacing-xs) var(--spacing-sm);
      border-radius: var(--radius-md);
      border: 1px solid var(--color-border);
      background: var(--color-bg-tertiary);
      color: var(--color-text-primary);
      cursor: pointer;
      font-size: 0.85rem;
      transition: all 0.2s;
    }

    .quick-btn:hover {
      background: var(--color-accent-primary);
      border-color: var(--color-accent-primary);
      color: white;
    }

    .input-form {
      display: flex;
      gap: var(--spacing-sm);
    }

    .input-form input {
      flex: 1;
      padding: var(--spacing-md);
      border-radius: var(--radius-md);
      border: 1px solid var(--color-border);
      background: var(--color-bg-tertiary);
      color: var(--color-text-primary);
      font-size: 1rem;
    }

    .input-form input:focus {
      outline: none;
      border-color: var(--color-accent-primary);
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.2);
    }

    .input-form button {
      padding: var(--spacing-md) var(--spacing-lg);
      border-radius: var(--radius-md);
      border: none;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      font-size: 1.2rem;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .input-form button:hover:not(:disabled) {
      transform: scale(1.05);
      box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
    }

    .input-form button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .info-panel {
      background: var(--color-bg-secondary);
      border-radius: var(--radius-lg);
      padding: var(--spacing-md);
      border: 1px dashed var(--color-border);
    }

    .info-panel h4 {
      margin: 0 0 var(--spacing-sm);
      color: var(--color-text-primary);
    }

    .info-panel ul {
      margin: 0;
      padding-left: var(--spacing-lg);
      color: var(--color-text-secondary);
      font-size: 0.9rem;
    }

    .info-panel li {
      margin-bottom: var(--spacing-xs);
    }
  `]
})
export class ChatbotComponent {
  @ViewChild('messagesContainer') messagesContainer!: ElementRef;

  private http = inject(HttpClient);
  private authService = inject(AuthService);

  messages = signal<ChatMessage[]>([
    {
      role: 'system',
      content: '🎉 Hoş geldiniz! Ben sipariş asistanınızım. Menüden sipariş vermek için yazmanız yeterli.',
      timestamp: new Date()
    }
  ]);

  isLoading = signal(false);
  userInput = '';

  sendQuickMessage(text: string): void {
    this.userInput = text;
    this.sendMessage();
  }

  sendMessage(): void {
    const text = this.userInput.trim();
    if (!text || this.isLoading()) return;

    // Add user message
    this.messages.update(msgs => [...msgs, {
      role: 'user',
      content: text,
      timestamp: new Date()
    }]);

    this.userInput = '';
    this.isLoading.set(true);
    this.scrollToBottom();

    // Call the chatbot API
    this.http.post<{success: boolean; data: {reply: string; order?: unknown}}>(`${environment.apiBaseUrl}/chatbot/message`, 
      { message: text },
      { headers: this.authService.getAuthHeaders() }
    ).subscribe({
      next: (response) => {
        if (response?.success && response.data) {
          this.messages.update(msgs => [...msgs, {
            role: 'assistant',
            content: response.data.reply,
            timestamp: new Date()
          }]);
        }
        this.isLoading.set(false);
        this.scrollToBottom();
      },
      error: (error: unknown) => {
        console.error('Chatbot error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen hata';
        this.messages.update(msgs => [...msgs, {
          role: 'assistant',
          content: `❌ Hata oluştu: ${errorMessage}\n\nAPI bağlantısını kontrol edin.`,
          timestamp: new Date()
        }]);
        this.isLoading.set(false);
        this.scrollToBottom();
      }
    });
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      if (this.messagesContainer) {
        const el = this.messagesContainer.nativeElement;
        el.scrollTop = el.scrollHeight;
      }
    }, 100);
  }
}

