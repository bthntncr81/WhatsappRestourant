import { Component, inject, signal, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../services/auth.service';

interface ChatButton {
  id: string;
  title: string;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  buttons?: ChatButton[];
}

@Component({
  selector: 'app-chatbot',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="chatbot-container">
      <div class="chat-header">
        <div class="header-row">
          <div>
            <h2>🤖 AI Chatbot Test</h2>
            <p class="subtitle">Menü siparişlerinizi test edin</p>
          </div>
          <button class="reset-btn" (click)="resetSession()" [disabled]="isLoading()" title="Sohbeti sıfırla">🔄 Sıfırla</button>
        </div>
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
              @if (msg.buttons && msg.buttons.length > 0) {
                <div class="inline-buttons">
                  @for (btn of msg.buttons; track btn.id) {
                    <button class="inline-btn" (click)="sendQuickMessage(btn.title)" [disabled]="isLoading()">{{ btn.title }}</button>
                  }
                </div>
              }
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
          <button class="quick-btn" (click)="sendQuickMessage('evet')">✅ Onayla</button>
          <button class="quick-btn location-btn" (click)="sendLocation()" [disabled]="isLoading()">📍 Konum</button>
          <button class="quick-btn cash-btn" (click)="sendQuickMessage('nakit')">💵 Nakit</button>
          <button class="quick-btn card-btn" (click)="sendQuickMessage('kart')">💳 Kart</button>
          <button class="quick-btn pay-sim-btn" (click)="simulatePayment()" [disabled]="isLoading()">✅ Ödeme Simüle</button>
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
          <li>✅ "bir döner bir ayran bir kola istiyorum"</li>
          <li>✅ "bir de ayran ekle" — mevcut siparişe ekle</li>
          <li>✅ "kolayı çıkar" — üründen sil</li>
          <li>✅ "evet" — siparişi onayla</li>
          <li>✅ 📍 Konum Gönder — teslimat adresi için</li>
          <li>✅ "nakit" veya "kart" — ödeme yöntemi</li>
          <li>✅ Ödeme Simüle — iyzico callback simülasyonu</li>
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

    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
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

    .reset-btn {
      padding: 8px 16px;
      border-radius: var(--radius-md);
      border: 2px solid rgba(255,255,255,0.5);
      background: rgba(255,255,255,0.15);
      color: white;
      cursor: pointer;
      font-size: 0.9rem;
      font-weight: 600;
      transition: all 0.2s;
    }

    .reset-btn:hover:not(:disabled) {
      background: rgba(255,255,255,0.3);
      border-color: white;
    }

    .reset-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
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

    .inline-buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid rgba(0,0,0,0.08);
    }

    .inline-btn {
      padding: 8px 16px;
      border-radius: 20px;
      border: 2px solid #667eea;
      background: transparent;
      color: #667eea;
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 600;
      transition: all 0.2s;
    }

    .inline-btn:hover:not(:disabled) {
      background: #667eea;
      color: white;
      transform: scale(1.05);
    }

    .inline-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
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

    .quick-btn:hover:not(:disabled) {
      background: var(--color-accent-primary);
      border-color: var(--color-accent-primary);
      color: white;
    }

    .quick-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .quick-btn.location-btn {
      background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
      color: white;
      border-color: #11998e;
    }

    .quick-btn.location-btn:hover:not(:disabled) {
      background: linear-gradient(135deg, #0d7a71 0%, #2bc968 100%);
      border-color: #0d7a71;
    }

    .quick-btn.cash-btn {
      background: #2d8a4e;
      color: white;
      border-color: #2d8a4e;
    }

    .quick-btn.card-btn {
      background: #5469d4;
      color: white;
      border-color: #5469d4;
    }

    .quick-btn.pay-sim-btn {
      background: #e6a817;
      color: white;
      border-color: #e6a817;
    }

    .quick-btn.pay-sim-btn:hover:not(:disabled) {
      background: #c99115;
      border-color: #c99115;
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

  // Taksim civarı test koordinatları (Merkez Şube'ye yakın)
  private testLocations = [
    { lat: 41.0370, lng: 28.9850, name: 'Taksim Meydanı' },
    { lat: 41.0082, lng: 28.9784, name: 'Sultanahmet' },
    { lat: 41.0422, lng: 29.0090, name: 'Beşiktaş' },
    { lat: 40.9923, lng: 29.0244, name: 'Kadıköy' },
  ];

  sendQuickMessage(text: string): void {
    this.userInput = text;
    this.sendMessage();
  }

  sendLocation(): void {
    if (this.isLoading()) return;

    // Rastgele test konumu seç
    const loc = this.testLocations[Math.floor(Math.random() * this.testLocations.length)];

    // Kullanıcı mesajı olarak göster
    this.messages.update(msgs => [...msgs, {
      role: 'user',
      content: `📍 Konum: ${loc.name} (${loc.lat}, ${loc.lng})`,
      timestamp: new Date()
    }]);

    this.isLoading.set(true);
    this.scrollToBottom();

    this.http.post<{success: boolean; data: {reply: string; buttons?: ChatButton[]}}>(
      `${environment.apiBaseUrl}/chatbot/location`,
      { latitude: loc.lat, longitude: loc.lng },
      { headers: this.authService.getAuthHeaders() }
    ).subscribe({
      next: (response) => {
        if (response?.success && response.data) {
          this.messages.update(msgs => [...msgs, {
            role: 'assistant',
            content: response.data.reply,
            timestamp: new Date(),
            buttons: response.data.buttons,
          }]);
        }
        this.isLoading.set(false);
        this.scrollToBottom();
      },
      error: (error: unknown) => {
        console.error('Location error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Konum gönderilemedi';
        this.messages.update(msgs => [...msgs, {
          role: 'assistant',
          content: `❌ Hata: ${errorMessage}`,
          timestamp: new Date()
        }]);
        this.isLoading.set(false);
        this.scrollToBottom();
      }
    });
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
    this.http.post<{success: boolean; data: {reply: string; buttons?: ChatButton[]; order?: unknown}}>(`${environment.apiBaseUrl}/chatbot/message`,
      { message: text },
      { headers: this.authService.getAuthHeaders() }
    ).subscribe({
      next: (response) => {
        if (response?.success && response.data) {
          this.messages.update(msgs => [...msgs, {
            role: 'assistant',
            content: response.data.reply,
            timestamp: new Date(),
            buttons: response.data.buttons,
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

  simulatePayment(): void {
    if (this.isLoading()) return;

    this.messages.update(msgs => [...msgs, {
      role: 'user',
      content: '💳 Ödeme simülasyonu (sandbox callback)',
      timestamp: new Date()
    }]);

    this.isLoading.set(true);
    this.scrollToBottom();

    this.http.post<{success: boolean; data: {reply: string; buttons?: ChatButton[]}}>(
      `${environment.apiBaseUrl}/chatbot/simulate-payment`,
      { success: true },
      { headers: this.authService.getAuthHeaders() }
    ).subscribe({
      next: (response) => {
        if (response?.success && response.data) {
          this.messages.update(msgs => [...msgs, {
            role: 'assistant',
            content: response.data.reply,
            timestamp: new Date(),
            buttons: response.data.buttons,
          }]);
        }
        this.isLoading.set(false);
        this.scrollToBottom();
      },
      error: (error: unknown) => {
        console.error('Payment simulation error:', error);
        this.messages.update(msgs => [...msgs, {
          role: 'assistant',
          content: '❌ Ödeme simülasyonu başarısız.',
          timestamp: new Date()
        }]);
        this.isLoading.set(false);
        this.scrollToBottom();
      }
    });
  }

  resetSession(): void {
    if (this.isLoading()) return;

    this.isLoading.set(true);

    this.http.delete<{success: boolean}>(
      `${environment.apiBaseUrl}/chatbot/history`,
      { headers: this.authService.getAuthHeaders() }
    ).subscribe({
      next: () => {
        this.messages.set([{
          role: 'system',
          content: '🔄 Sohbet sıfırlandı! Yeni sipariş vermek için yazabilirsiniz.',
          timestamp: new Date()
        }]);
        this.userInput = '';
        this.isLoading.set(false);
      },
      error: () => {
        this.messages.set([{
          role: 'system',
          content: '🔄 Sohbet sıfırlandı!',
          timestamp: new Date()
        }]);
        this.userInput = '';
        this.isLoading.set(false);
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

