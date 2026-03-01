import { Component, OnInit, OnDestroy, inject, signal, computed, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  InboxService,
  ConversationDto,
  MessageDto,
  InboxSummaryDto,
  ConversationStatus,
  OrderIntentDto,
  ConversationAssignmentDto,
  ConversationLockDto,
  InternalNoteDto,
  AgentDto,
} from '../../services/inbox.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-inbox',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="inbox-container">
      <!-- Sidebar: Conversation List -->
      <aside class="conversations-sidebar">
        <div class="sidebar-header">
          <h2 class="sidebar-title">Inbox</h2>
          <button class="refresh-btn" (click)="loadConversations()" title="Refresh">
            🔄
          </button>
        </div>

        <!-- Summary Stats -->
        @if (summary()) {
          <div class="summary-stats">
            <div class="stat" [class.active]="statusFilter() === null" (click)="setStatusFilter(null)">
              <span class="stat-count">{{ summary()!.total }}</span>
              <span class="stat-label">All</span>
            </div>
            <div class="stat" [class.active]="statusFilter() === 'OPEN'" (click)="setStatusFilter('OPEN')">
              <span class="stat-count">{{ summary()!.open }}</span>
              <span class="stat-label">Open</span>
            </div>
            <div class="stat pending" [class.active]="statusFilter() === 'PENDING_AGENT'" (click)="setStatusFilter('PENDING_AGENT')">
              <span class="stat-count">{{ summary()!.pendingAgent }}</span>
              <span class="stat-label">Pending</span>
            </div>
            <div class="stat" [class.active]="statusFilter() === 'CLOSED'" (click)="setStatusFilter('CLOSED')">
              <span class="stat-count">{{ summary()!.closed }}</span>
              <span class="stat-label">Closed</span>
            </div>
          </div>
        }

        <!-- Search -->
        <div class="search-box">
          <input
            type="text"
            placeholder="Search by phone or name..."
            [(ngModel)]="searchQuery"
            (input)="onSearchChange()"
          />
        </div>

        <!-- Conversation List -->
        <div class="conversation-list">
          @if (loading()) {
            <div class="loading-state">
              <div class="loader"></div>
            </div>
          } @else if (conversations().length === 0) {
            <div class="empty-state">
              <span class="empty-icon">💬</span>
              <p>No conversations yet</p>
            </div>
          } @else {
            @for (conv of conversations(); track conv.id) {
              <div
                class="conversation-item"
                [class.active]="selectedConversationId() === conv.id"
                [class.pending]="conv.status === 'PENDING_AGENT'"
                (click)="selectConversation(conv)"
              >
                <div class="conv-avatar">
                  {{ getInitials(conv.customerName || conv.customerPhone) }}
                </div>
                <div class="conv-content">
                  <div class="conv-header">
                    <span class="conv-name">{{ conv.customerName || conv.customerPhone }}</span>
                    <span class="conv-time">{{ formatTime(conv.lastMessageAt) }}</span>
                  </div>
                  <div class="conv-preview">
                    @if (conv.lastMessage) {
                      <span class="preview-direction" [class.outgoing]="conv.lastMessage.direction === 'OUT'">
                        {{ conv.lastMessage.direction === 'OUT' ? '↩' : '' }}
                      </span>
                      <span class="preview-text">{{ conv.lastMessage.text || getKindLabel(conv.lastMessage.kind) }}</span>
                    }
                  </div>
                </div>
                <div class="conv-status">
                  <span class="status-badge" [attr.data-status]="conv.status">
                    {{ getStatusLabel(conv.status) }}
                  </span>
                </div>
              </div>
            }
          }
        </div>
      </aside>

      <!-- Main: Chat Area -->
      <main class="chat-area" [class.with-panel]="showIntentPanel()">
        @if (!selectedConversation()) {
          <div class="no-conversation">
            <span class="empty-icon">💬</span>
            <p>Select a conversation to view messages</p>
          </div>
        } @else {
          <!-- Chat Header -->
          <div class="chat-header">
            <div class="chat-user">
              <div class="chat-avatar">
                {{ getInitials(selectedConversation()!.customerName || selectedConversation()!.customerPhone) }}
              </div>
              <div class="chat-user-info">
                <span class="chat-user-name">
                  {{ selectedConversation()!.customerName || selectedConversation()!.customerPhone }}
                </span>
                <span class="chat-user-phone text-muted">
                  {{ selectedConversation()!.customerPhone }}
                </span>
              </div>
            </div>
            <div class="chat-actions">
              <!-- Lock Status -->
              @if (currentLock()) {
                <div class="lock-indicator" [class.own-lock]="currentLock()!.isOwnLock">
                  🔒 {{ currentLock()!.isOwnLock ? 'Sizde' : currentLock()!.lockedByUserName }}
                </div>
              }

              <!-- Assign Dropdown -->
              <select
                class="assign-select"
                [ngModel]="currentAssignment()?.assignedUserId || ''"
                (ngModelChange)="onAssignChange($event)"
              >
                <option value="">Atanmamış</option>
                @for (agent of agents(); track agent.id) {
                  <option [value]="agent.id">{{ agent.name }}</option>
                }
              </select>

              <!-- Take Over Button -->
              @if (!currentLock() || !currentLock()!.isOwnLock) {
                <button 
                  class="action-btn take-over"
                  (click)="takeOver()"
                  [disabled]="currentLock() && !currentLock()!.isOwnLock"
                  title="Devral"
                >
                  ✋ Devral
                </button>
              } @else {
                <button class="action-btn release" (click)="releaseLock()" title="Bırak">
                  🔓 Bırak
                </button>
              }

              <!-- Handoff Button -->
              <button 
                class="action-btn handoff"
                (click)="handoffToAgent()"
                title="Temsilciye Aktar"
              >
                🔄 Temsilciye Aktar
              </button>

              <!-- Panel Toggle -->
              <button 
                class="panel-toggle-btn" 
                [class.active]="showIntentPanel()"
                (click)="showIntentPanel.set(!showIntentPanel())"
                title="Toggle AI Panel"
              >
                🤖
              </button>

              <!-- Status Select -->
              <select
                class="status-select"
                [ngModel]="selectedConversation()!.status"
                (ngModelChange)="updateStatus($event)"
              >
                <option value="OPEN">Open</option>
                <option value="PENDING_AGENT">Pending</option>
                <option value="CLOSED">Closed</option>
              </select>
            </div>
          </div>

          <!-- Messages -->
          <div class="messages-container" #messagesContainer>
            @if (loadingMessages()) {
              <div class="loading-state">
                <div class="loader"></div>
              </div>
            } @else {
              @for (msg of messages(); track msg.id) {
                <div class="message" [class.outgoing]="msg.direction === 'OUT'" [class.system]="msg.kind === 'SYSTEM'">
                  <div class="message-bubble">
                    @if (msg.kind === 'LOCATION' && msg.payloadJson) {
                      <div class="message-location">
                        📍 {{ msg.text }}
                        <a
                          [href]="'https://maps.google.com/?q=' + msg.payloadJson['latitude'] + ',' + msg.payloadJson['longitude']"
                          target="_blank"
                          class="location-link"
                        >
                          View on map
                        </a>
                      </div>
                    } @else if (msg.kind === 'IMAGE') {
                      <div class="message-image">
                        🖼️ {{ msg.text }}
                      </div>
                    } @else if (msg.kind === 'VOICE') {
                      <div class="message-voice">
                        🎤 {{ msg.text }}
                      </div>
                    } @else {
                      <div class="message-text">{{ msg.text }}</div>
                    }
                    <div class="message-meta">
                      <span class="message-time">{{ formatMessageTime(msg.createdAt) }}</span>
                      @if (msg.direction === 'OUT' && msg.senderName) {
                        <span class="message-sender">• {{ msg.senderName }}</span>
                      }
                    </div>
                  </div>
                </div>
              }
            }
          </div>

          <!-- Internal Notes Section -->
          <div class="internal-notes-section">
            <div class="notes-header" (click)="showNotes.set(!showNotes())">
              <span>📝 Internal Notes ({{ internalNotes().length }})</span>
              <span class="toggle-icon">{{ showNotes() ? '▼' : '▶' }}</span>
            </div>
            @if (showNotes()) {
              <div class="notes-content">
                @for (note of internalNotes(); track note.id) {
                  <div class="note-item">
                    <div class="note-header">
                      <span class="note-author">{{ note.authorName }}</span>
                      <span class="note-time">{{ formatMessageTime(note.createdAt) }}</span>
                    </div>
                    <div class="note-text">{{ note.text }}</div>
                  </div>
                }
                <form (ngSubmit)="createNote()" class="note-form">
                  <input
                    type="text"
                    placeholder="Add internal note..."
                    [(ngModel)]="newNoteText"
                    name="newNoteText"
                  />
                  <button type="submit" [disabled]="!newNoteText.trim()">+</button>
                </form>
              </div>
            }
          </div>

          <!-- Reply Input -->
          <div class="reply-container" [class.disabled]="!canWrite()">
            @if (!canWrite()) {
              <div class="lock-warning">
                🔒 Bu sohbet {{ currentLock()?.lockedByUserName }} tarafından kilitli
              </div>
            }
            <form (ngSubmit)="sendReply()" class="reply-form">
              <input
                type="text"
                class="reply-input"
                placeholder="Type a message..."
                [(ngModel)]="replyText"
                name="replyText"
                [disabled]="sending() || !canWrite()"
              />
              <button type="submit" class="send-btn" [disabled]="!replyText.trim() || sending() || !canWrite()">
                @if (sending()) {
                  <span class="spinner"></span>
                } @else {
                  ➤
                }
              </button>
            </form>
          </div>
        }
      </main>

      <!-- Order Intent Panel -->
      @if (selectedConversation() && showIntentPanel()) {
        <aside class="intent-panel">
          <div class="panel-header">
            <h3>🤖 Bot Önerisi</h3>
            <button class="close-btn" (click)="showIntentPanel.set(false)">✕</button>
          </div>
          
          <div class="panel-content">
            @if (loadingIntents()) {
              <div class="loading-state">
                <div class="loader small"></div>
              </div>
            } @else if (orderIntents().length === 0) {
              <div class="empty-intent">
                <span>📋</span>
                <p>Henüz sipariş çıkarımı yok</p>
              </div>
            } @else {
              @for (intent of orderIntents(); track intent.id) {
                <div class="intent-card" [class.low-confidence]="intent.confidence < 0.7">
                  <div class="intent-header">
                    <span class="confidence-badge" [attr.data-level]="getConfidenceLevel(intent.confidence)">
                      {{ (intent.confidence * 100).toFixed(0) }}%
                    </span>
                    <span class="intent-time">{{ formatMessageTime(intent.createdAt) }}</span>
                  </div>
                  
                  @if (intent.needsClarification && intent.clarificationQuestion) {
                    <div class="clarification-box">
                      <span class="clarification-icon">❓</span>
                      <span>{{ intent.clarificationQuestion }}</span>
                    </div>
                  }
                  
                  @if (intent.extractedJson.items.length > 0) {
                    <div class="extracted-items">
                      <h4>Çıkarılan Ürünler:</h4>
                      @for (item of intent.extractedJson.items; track item.menuItemId) {
                        <div class="extracted-item">
                          <span class="item-qty">{{ item.qty }}x</span>
                          <span class="item-name">{{ item.menuItemName || item.menuItemId }}</span>
                          @if (item.optionSelections.length > 0) {
                            <div class="item-options">
                              @for (opt of item.optionSelections; track opt.optionName) {
                                <span class="option-tag">{{ opt.optionName }}</span>
                              }
                            </div>
                          }
                          @if (item.notes) {
                            <div class="item-notes text-muted">📝 {{ item.notes }}</div>
                          }
                        </div>
                      }
                    </div>
                  }
                  
                  @if (intent.extractedJson.missingFields.length > 0) {
                    <div class="missing-fields">
                      <span class="missing-icon">⚠️</span>
                      <span>Eksik: {{ intent.extractedJson.missingFields.join(', ') }}</span>
                    </div>
                  }
                  
                  <!-- Feedback Buttons -->
                  <div class="feedback-section">
                    @if (intent.agentFeedback) {
                      <span class="feedback-given" [attr.data-feedback]="intent.agentFeedback">
                        {{ intent.agentFeedback === 'correct' ? '✓ Doğru' : '✗ Yanlış' }}
                      </span>
                    } @else {
                      <span class="feedback-label">Bu çıkarım doğru mu?</span>
                      <div class="feedback-buttons">
                        <button class="feedback-btn correct" (click)="submitFeedback(intent, 'correct')">
                          👍 Doğru
                        </button>
                        <button class="feedback-btn incorrect" (click)="submitFeedback(intent, 'incorrect')">
                          👎 Yanlış
                        </button>
                      </div>
                    }
                  </div>
                </div>
              }
            }
          </div>
        </aside>
      }
    </div>
  `,
  styles: [
    `
      .inbox-container {
        display: flex;
        height: calc(100vh - var(--topbar-height, 60px) - 2 * var(--spacing-lg));
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        overflow: hidden;
      }

      /* Sidebar */
      .conversations-sidebar {
        width: 360px;
        display: flex;
        flex-direction: column;
        border-right: 1px solid var(--color-border);
        background: var(--color-bg-primary);
        flex-shrink: 0;
      }

      .sidebar-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--spacing-lg);
        border-bottom: 1px solid var(--color-border);
      }

      .sidebar-title {
        font-size: 1.25rem;
        font-weight: 700;
      }

      .refresh-btn, .panel-toggle-btn {
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        cursor: pointer;
        transition: all var(--transition-fast);

        &:hover {
          background: var(--color-bg-tertiary);
        }

        &.active {
          background: var(--color-accent-primary);
          color: white;
          border-color: var(--color-accent-primary);
        }
      }

      .summary-stats {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: var(--spacing-xs);
        padding: var(--spacing-md);
        border-bottom: 1px solid var(--color-border);
      }

      .stat {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: var(--spacing-sm);
        border-radius: var(--radius-sm);
        cursor: pointer;
        transition: all var(--transition-fast);

        &:hover, &.active {
          background: var(--color-bg-tertiary);
        }

        &.active {
          border: 1px solid var(--color-accent-primary);
        }

        &.pending .stat-count {
          color: var(--color-accent-warning);
        }
      }

      .stat-count {
        font-size: 1.25rem;
        font-weight: 700;
      }

      .stat-label {
        font-size: 0.625rem;
        text-transform: uppercase;
        color: var(--color-text-muted);
      }

      .search-box {
        padding: var(--spacing-md);
        border-bottom: 1px solid var(--color-border);

        input {
          width: 100%;
          padding: var(--spacing-sm) var(--spacing-md);
          background: var(--color-bg-tertiary);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
          color: var(--color-text-primary);
          font-size: 0.875rem;

          &::placeholder {
            color: var(--color-text-muted);
          }

          &:focus {
            outline: none;
            border-color: var(--color-accent-primary);
          }
        }
      }

      .conversation-list {
        flex: 1;
        overflow-y: auto;
      }

      .conversation-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        padding: var(--spacing-md);
        cursor: pointer;
        border-bottom: 1px solid var(--color-border);
        transition: background var(--transition-fast);

        &:hover {
          background: var(--color-bg-tertiary);
        }

        &.active {
          background: var(--color-bg-elevated);
          border-left: 3px solid var(--color-accent-primary);
        }

        &.pending {
          background: rgba(245, 158, 11, 0.05);
        }
      }

      .conv-avatar {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background: var(--gradient-primary);
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 600;
        font-size: 0.875rem;
        color: white;
        flex-shrink: 0;
      }

      .conv-content {
        flex: 1;
        min-width: 0;
      }

      .conv-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 2px;
      }

      .conv-name {
        font-weight: 600;
        font-size: 0.9375rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .conv-time {
        font-size: 0.75rem;
        color: var(--color-text-muted);
        flex-shrink: 0;
      }

      .conv-preview {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 0.8125rem;
        color: var(--color-text-secondary);
      }

      .preview-direction {
        color: var(--color-text-muted);

        &.outgoing {
          color: var(--color-accent-primary);
        }
      }

      .preview-text {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .conv-status {
        flex-shrink: 0;
      }

      .status-badge {
        padding: 2px 6px;
        border-radius: var(--radius-sm);
        font-size: 0.625rem;
        font-weight: 600;
        text-transform: uppercase;

        &[data-status='OPEN'] {
          background: rgba(34, 197, 94, 0.15);
          color: var(--color-accent-success);
        }

        &[data-status='PENDING_AGENT'] {
          background: rgba(245, 158, 11, 0.15);
          color: var(--color-accent-warning);
        }

        &[data-status='CLOSED'] {
          background: var(--color-bg-elevated);
          color: var(--color-text-muted);
        }
      }

      /* Chat Area */
      .chat-area {
        flex: 1;
        display: flex;
        flex-direction: column;
        background: var(--color-bg-secondary);
        min-width: 0;

        &.with-panel {
          border-right: 1px solid var(--color-border);
        }
      }

      .no-conversation {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-md);
        color: var(--color-text-muted);
      }

      .empty-icon {
        font-size: 3rem;
        opacity: 0.5;
      }

      .chat-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--spacing-md) var(--spacing-lg);
        border-bottom: 1px solid var(--color-border);
        background: var(--color-bg-primary);
        flex-wrap: wrap;
        gap: var(--spacing-sm);
      }

      .chat-user {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
      }

      .chat-avatar {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: var(--gradient-primary);
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 600;
        color: white;
      }

      .chat-user-info {
        display: flex;
        flex-direction: column;
      }

      .chat-user-name {
        font-weight: 600;
      }

      .chat-user-phone {
        font-size: 0.75rem;
      }

      .chat-actions {
        display: flex;
        gap: var(--spacing-sm);
        align-items: center;
        flex-wrap: wrap;
      }

      .lock-indicator {
        padding: var(--spacing-xs) var(--spacing-sm);
        background: rgba(239, 68, 68, 0.15);
        color: var(--color-accent-danger);
        border-radius: var(--radius-sm);
        font-size: 0.75rem;
        font-weight: 500;

        &.own-lock {
          background: rgba(34, 197, 94, 0.15);
          color: var(--color-accent-success);
        }
      }

      .assign-select, .status-select {
        padding: var(--spacing-xs) var(--spacing-sm);
        background: var(--color-bg-tertiary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-primary);
        font-size: 0.8125rem;
        cursor: pointer;
      }

      .action-btn {
        padding: var(--spacing-xs) var(--spacing-sm);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        background: var(--color-bg-tertiary);
        color: var(--color-text-primary);
        font-size: 0.75rem;
        cursor: pointer;
        transition: all var(--transition-fast);

        &:hover:not(:disabled) {
          background: var(--color-bg-elevated);
        }

        &:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        &.take-over {
          background: rgba(99, 102, 241, 0.1);
          border-color: var(--color-accent-primary);
          color: var(--color-accent-primary);
        }

        &.release {
          background: rgba(34, 197, 94, 0.1);
          border-color: var(--color-accent-success);
          color: var(--color-accent-success);
        }

        &.handoff {
          background: rgba(245, 158, 11, 0.1);
          border-color: var(--color-accent-warning);
          color: var(--color-accent-warning);
        }
      }

      /* Messages */
      .messages-container {
        flex: 1;
        overflow-y: auto;
        padding: var(--spacing-lg);
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
        background-image: radial-gradient(
          circle at 100% 0%,
          rgba(99, 102, 241, 0.03),
          transparent 50%
        );
      }

      .loading-state {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xl);
      }

      .loader {
        width: 24px;
        height: 24px;
        border: 2px solid var(--color-border);
        border-top-color: var(--color-accent-primary);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;

        &.small {
          width: 16px;
          height: 16px;
        }
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      .message {
        display: flex;
        max-width: 70%;

        &.outgoing {
          align-self: flex-end;

          .message-bubble {
            background: var(--color-accent-primary);
            color: white;
            border-bottom-right-radius: 4px;
          }

          .message-meta {
            color: rgba(255, 255, 255, 0.7);
          }
        }

        &.system {
          align-self: center;
          max-width: 90%;

          .message-bubble {
            background: var(--color-bg-elevated);
            color: var(--color-text-muted);
            font-size: 0.8125rem;
            text-align: center;
          }
        }
      }

      .message-bubble {
        background: var(--color-bg-primary);
        padding: var(--spacing-sm) var(--spacing-md);
        border-radius: var(--radius-lg);
        border-bottom-left-radius: 4px;
        box-shadow: 0 1px 2px var(--color-shadow);
      }

      .message-text {
        font-size: 0.9375rem;
        line-height: 1.4;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .message-location,
      .message-image,
      .message-voice {
        font-size: 0.9375rem;
      }

      .location-link {
        display: block;
        color: inherit;
        opacity: 0.8;
        font-size: 0.75rem;
        margin-top: 4px;

        &:hover {
          text-decoration: underline;
        }
      }

      .message-meta {
        display: flex;
        gap: var(--spacing-xs);
        font-size: 0.6875rem;
        color: var(--color-text-muted);
        margin-top: 4px;
      }

      /* Internal Notes */
      .internal-notes-section {
        border-top: 1px solid var(--color-border);
        background: var(--color-bg-tertiary);
      }

      .notes-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--spacing-sm) var(--spacing-lg);
        cursor: pointer;
        font-size: 0.8125rem;
        color: var(--color-text-secondary);

        &:hover {
          background: var(--color-bg-elevated);
        }
      }

      .toggle-icon {
        font-size: 0.625rem;
      }

      .notes-content {
        padding: 0 var(--spacing-lg) var(--spacing-md);
        max-height: 200px;
        overflow-y: auto;
      }

      .note-item {
        padding: var(--spacing-sm);
        background: var(--color-bg-primary);
        border-radius: var(--radius-sm);
        margin-bottom: var(--spacing-xs);
      }

      .note-header {
        display: flex;
        justify-content: space-between;
        font-size: 0.6875rem;
        color: var(--color-text-muted);
        margin-bottom: 4px;
      }

      .note-author {
        font-weight: 500;
      }

      .note-text {
        font-size: 0.8125rem;
      }

      .note-form {
        display: flex;
        gap: var(--spacing-xs);
        margin-top: var(--spacing-sm);

        input {
          flex: 1;
          padding: var(--spacing-xs) var(--spacing-sm);
          background: var(--color-bg-primary);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-sm);
          color: var(--color-text-primary);
          font-size: 0.8125rem;
        }

        button {
          padding: var(--spacing-xs) var(--spacing-sm);
          background: var(--color-accent-primary);
          border: none;
          border-radius: var(--radius-sm);
          color: white;
          cursor: pointer;

          &:disabled {
            opacity: 0.5;
          }
        }
      }

      /* Reply */
      .reply-container {
        padding: var(--spacing-md) var(--spacing-lg);
        border-top: 1px solid var(--color-border);
        background: var(--color-bg-primary);

        &.disabled {
          opacity: 0.7;
        }
      }

      .lock-warning {
        text-align: center;
        padding: var(--spacing-xs);
        background: rgba(239, 68, 68, 0.1);
        color: var(--color-accent-danger);
        font-size: 0.75rem;
        border-radius: var(--radius-sm);
        margin-bottom: var(--spacing-sm);
      }

      .reply-form {
        display: flex;
        gap: var(--spacing-sm);
      }

      .reply-input {
        flex: 1;
        padding: var(--spacing-sm) var(--spacing-md);
        background: var(--color-bg-tertiary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        color: var(--color-text-primary);
        font-size: 0.9375rem;

        &::placeholder {
          color: var(--color-text-muted);
        }

        &:focus {
          outline: none;
          border-color: var(--color-accent-primary);
        }

        &:disabled {
          opacity: 0.5;
        }
      }

      .send-btn {
        width: 44px;
        height: 44px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--gradient-primary);
        border: none;
        border-radius: 50%;
        color: white;
        font-size: 1.25rem;
        cursor: pointer;
        transition: all var(--transition-fast);

        &:hover:not(:disabled) {
          transform: scale(1.05);
        }

        &:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      }

      .spinner {
        width: 18px;
        height: 18px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-top-color: white;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-2xl);
        color: var(--color-text-muted);
      }

      /* Intent Panel */
      .intent-panel {
        width: 320px;
        display: flex;
        flex-direction: column;
        background: var(--color-bg-primary);
        flex-shrink: 0;
      }

      .panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--spacing-md) var(--spacing-lg);
        border-bottom: 1px solid var(--color-border);
        background: var(--color-bg-tertiary);

        h3 {
          font-size: 0.9375rem;
          font-weight: 600;
        }
      }

      .close-btn {
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: none;
        color: var(--color-text-muted);
        cursor: pointer;

        &:hover {
          color: var(--color-text-primary);
        }
      }

      .panel-content {
        flex: 1;
        overflow-y: auto;
        padding: var(--spacing-md);
      }

      .empty-intent {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xl);
        color: var(--color-text-muted);
        text-align: center;

        span {
          font-size: 2rem;
          margin-bottom: var(--spacing-sm);
        }
      }

      .intent-card {
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: var(--spacing-md);
        margin-bottom: var(--spacing-md);

        &.low-confidence {
          border-color: var(--color-accent-warning);
        }
      }

      .intent-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--spacing-sm);
      }

      .confidence-badge {
        padding: 2px 8px;
        border-radius: var(--radius-sm);
        font-size: 0.75rem;
        font-weight: 600;

        &[data-level='high'] {
          background: rgba(34, 197, 94, 0.15);
          color: var(--color-accent-success);
        }

        &[data-level='medium'] {
          background: rgba(245, 158, 11, 0.15);
          color: var(--color-accent-warning);
        }

        &[data-level='low'] {
          background: rgba(239, 68, 68, 0.15);
          color: var(--color-accent-danger);
        }
      }

      .intent-time {
        font-size: 0.6875rem;
        color: var(--color-text-muted);
      }

      .clarification-box {
        display: flex;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm);
        background: rgba(245, 158, 11, 0.1);
        border-radius: var(--radius-sm);
        font-size: 0.8125rem;
        margin-bottom: var(--spacing-sm);
      }

      .extracted-items {
        margin-bottom: var(--spacing-sm);

        h4 {
          font-size: 0.75rem;
          color: var(--color-text-secondary);
          text-transform: uppercase;
          margin-bottom: var(--spacing-xs);
        }
      }

      .extracted-item {
        padding: var(--spacing-xs) 0;
        border-bottom: 1px solid var(--color-border);

        &:last-child {
          border-bottom: none;
        }
      }

      .item-qty {
        font-weight: 600;
        color: var(--color-accent-primary);
        margin-right: var(--spacing-xs);
      }

      .item-name {
        font-weight: 500;
      }

      .item-options {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 4px;
      }

      .option-tag {
        padding: 1px 6px;
        background: var(--color-bg-tertiary);
        border-radius: 2px;
        font-size: 0.6875rem;
      }

      .item-notes {
        font-size: 0.75rem;
        margin-top: 4px;
      }

      .missing-fields {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        font-size: 0.75rem;
        color: var(--color-accent-warning);
        margin-bottom: var(--spacing-sm);
      }

      .feedback-section {
        padding-top: var(--spacing-sm);
        border-top: 1px solid var(--color-border);
      }

      .feedback-label {
        font-size: 0.75rem;
        color: var(--color-text-muted);
        display: block;
        margin-bottom: var(--spacing-xs);
      }

      .feedback-buttons {
        display: flex;
        gap: var(--spacing-xs);
      }

      .feedback-btn {
        flex: 1;
        padding: var(--spacing-xs) var(--spacing-sm);
        border: none;
        border-radius: var(--radius-sm);
        font-size: 0.75rem;
        cursor: pointer;
        transition: all var(--transition-fast);

        &.correct {
          background: rgba(34, 197, 94, 0.15);
          color: var(--color-accent-success);

          &:hover {
            background: rgba(34, 197, 94, 0.25);
          }
        }

        &.incorrect {
          background: rgba(239, 68, 68, 0.15);
          color: var(--color-accent-danger);

          &:hover {
            background: rgba(239, 68, 68, 0.25);
          }
        }
      }

      .feedback-given {
        font-size: 0.75rem;
        font-weight: 500;

        &[data-feedback='correct'] {
          color: var(--color-accent-success);
        }

        &[data-feedback='incorrect'] {
          color: var(--color-accent-danger);
        }
      }
    `,
  ],
})
export class InboxComponent implements OnInit, OnDestroy {
  @ViewChild('messagesContainer') messagesContainer!: ElementRef;

  private inboxService = inject(InboxService);
  private authService = inject(AuthService);

  // State
  loading = signal(true);
  loadingMessages = signal(false);
  loadingIntents = signal(false);
  sending = signal(false);

  // Data
  summary = signal<InboxSummaryDto | null>(null);
  conversations = signal<ConversationDto[]>([]);
  messages = signal<MessageDto[]>([]);
  orderIntents = signal<OrderIntentDto[]>([]);
  agents = signal<AgentDto[]>([]);
  currentAssignment = signal<ConversationAssignmentDto | null>(null);
  currentLock = signal<ConversationLockDto | null>(null);
  internalNotes = signal<InternalNoteDto[]>([]);

  selectedConversationId = signal<string | null>(null);
  selectedConversation = computed(() =>
    this.conversations().find((c) => c.id === this.selectedConversationId())
  );

  // Computed
  canWrite = computed(() => {
    const lock = this.currentLock();
    if (!lock) return true;
    return lock.isOwnLock;
  });

  // UI State
  showIntentPanel = signal(true);
  showNotes = signal(false);

  // Filters
  statusFilter = signal<ConversationStatus | null>(null);
  searchQuery = '';

  // Reply & Notes
  replyText = '';
  newNoteText = '';

  // Polling & Heartbeat
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.loadAgents();
    this.loadSummary();
    this.loadConversations();
    this.startPolling();
  }

  ngOnDestroy(): void {
    this.stopPolling();
    this.stopHeartbeat();
  }

  startPolling(): void {
    this.pollInterval = setInterval(() => {
      this.loadConversations(true);
      if (this.selectedConversationId()) {
        this.loadMessages(true);
        this.loadOrderIntents(true);
        this.loadLock(true);
      }
    }, 5000);
  }

  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      const lock = this.currentLock();
      if (lock?.isOwnLock && this.selectedConversationId()) {
        this.inboxService.refreshLock(this.selectedConversationId()!).subscribe();
      }
    }, 60000); // Refresh every 60 seconds
  }

  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  loadAgents(): void {
    this.inboxService.getAgents().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.agents.set(response.data);
        }
      },
    });
  }

  loadSummary(): void {
    this.inboxService.getSummary().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.summary.set(response.data);
        }
      },
    });
  }

  loadConversations(silent = false): void {
    if (!silent) this.loading.set(true);

    this.inboxService
      .getConversations({
        status: this.statusFilter() || undefined,
        q: this.searchQuery || undefined,
      })
      .subscribe({
        next: (response) => {
          if (response.success && response.data) {
            this.conversations.set(response.data.conversations);
          }
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
        },
      });
  }

  loadMessages(silent = false): void {
    const conversationId = this.selectedConversationId();
    if (!conversationId) return;

    if (!silent) this.loadingMessages.set(true);

    this.inboxService.getMessages(conversationId).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.messages.set(response.data);
          if (!silent) {
            setTimeout(() => this.scrollToBottom(), 100);
          }
        }
        this.loadingMessages.set(false);
      },
      error: () => {
        this.loadingMessages.set(false);
      },
    });
  }

  loadOrderIntents(silent = false): void {
    const conversationId = this.selectedConversationId();
    if (!conversationId) return;

    if (!silent) this.loadingIntents.set(true);

    this.inboxService.getOrderIntents(conversationId).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.orderIntents.set(response.data);
        }
        this.loadingIntents.set(false);
      },
      error: () => {
        this.loadingIntents.set(false);
      },
    });
  }

  loadAssignment(): void {
    const conversationId = this.selectedConversationId();
    if (!conversationId) return;

    this.inboxService.getAssignment(conversationId).subscribe({
      next: (response) => {
        if (response.success) {
          this.currentAssignment.set(response.data || null);
        }
      },
    });
  }

  loadLock(silent = false): void {
    const conversationId = this.selectedConversationId();
    if (!conversationId) return;

    this.inboxService.getLock(conversationId).subscribe({
      next: (response) => {
        if (response.success) {
          this.currentLock.set(response.data || null);
        }
      },
    });
  }

  loadInternalNotes(): void {
    const conversationId = this.selectedConversationId();
    if (!conversationId) return;

    this.inboxService.getInternalNotes(conversationId).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.internalNotes.set(response.data);
        }
      },
    });
  }

  selectConversation(conv: ConversationDto): void {
    // Release lock from previous conversation
    const prevConvId = this.selectedConversationId();
    if (prevConvId && this.currentLock()?.isOwnLock) {
      this.inboxService.releaseLock(prevConvId).subscribe();
    }

    this.selectedConversationId.set(conv.id);
    this.messages.set([]);
    this.orderIntents.set([]);
    this.currentAssignment.set(null);
    this.currentLock.set(null);
    this.internalNotes.set([]);
    this.showNotes.set(false);

    this.loadMessages();
    this.loadOrderIntents();
    this.loadAssignment();
    this.loadLock();
    this.loadInternalNotes();
  }

  setStatusFilter(status: ConversationStatus | null): void {
    this.statusFilter.set(status);
    this.loadConversations();
    this.loadSummary();
  }

  onSearchChange(): void {
    setTimeout(() => {
      this.loadConversations();
    }, 300);
  }

  updateStatus(status: ConversationStatus): void {
    const conversationId = this.selectedConversationId();
    if (!conversationId) return;

    this.inboxService.updateConversation(conversationId, { status }).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.conversations.update((convs) =>
            convs.map((c) => (c.id === conversationId ? response.data! : c))
          );
          this.loadSummary();
        }
      },
    });
  }

  onAssignChange(userId: string): void {
    const conversationId = this.selectedConversationId();
    if (!conversationId) return;

    if (userId) {
      this.inboxService.assignConversation(conversationId, userId).subscribe({
        next: (response) => {
          if (response.success && response.data) {
            this.currentAssignment.set(response.data);
          }
        },
      });
    } else {
      this.inboxService.unassignConversation(conversationId).subscribe({
        next: () => {
          this.currentAssignment.set(null);
        },
      });
    }
  }

  takeOver(): void {
    const conversationId = this.selectedConversationId();
    if (!conversationId) return;

    this.inboxService.acquireLock(conversationId).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.currentLock.set(response.data);
          this.startHeartbeat();
        }
      },
      error: (err) => {
        console.error('Failed to acquire lock', err);
      },
    });
  }

  releaseLock(): void {
    const conversationId = this.selectedConversationId();
    if (!conversationId) return;

    this.inboxService.releaseLock(conversationId).subscribe({
      next: () => {
        this.currentLock.set(null);
        this.stopHeartbeat();
      },
    });
  }

  handoffToAgent(): void {
    const conversationId = this.selectedConversationId();
    if (!conversationId) return;

    this.inboxService.handoffToAgent(conversationId).subscribe({
      next: () => {
        this.loadMessages();
        this.loadConversations();
        this.loadSummary();
      },
    });
  }

  sendReply(): void {
    const conversationId = this.selectedConversationId();
    const text = this.replyText.trim();
    if (!conversationId || !text || !this.canWrite()) return;

    this.sending.set(true);

    this.inboxService.sendReply(conversationId, text).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.messages.update((msgs) => [...msgs, response.data!]);
          this.replyText = '';
          setTimeout(() => this.scrollToBottom(), 100);
        }
        this.sending.set(false);
      },
      error: () => {
        this.sending.set(false);
      },
    });
  }

  createNote(): void {
    const conversationId = this.selectedConversationId();
    const text = this.newNoteText.trim();
    if (!conversationId || !text) return;

    this.inboxService.createInternalNote(conversationId, text).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.internalNotes.update((notes) => [response.data!, ...notes]);
          this.newNoteText = '';
        }
      },
    });
  }

  submitFeedback(intent: OrderIntentDto, feedback: 'correct' | 'incorrect'): void {
    this.inboxService.submitIntentFeedback(intent.id, feedback).subscribe({
      next: () => {
        this.orderIntents.update((intents) =>
          intents.map((i) => (i.id === intent.id ? { ...i, agentFeedback: feedback } : i))
        );
      },
    });
  }

  scrollToBottom(): void {
    if (this.messagesContainer) {
      const el = this.messagesContainer.nativeElement;
      el.scrollTop = el.scrollHeight;
    }
  }

  // Helpers
  getInitials(name: string): string {
    if (!name) return '?';
    const parts = name.split(/[\s-]+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  formatTime(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  }

  formatMessageTime(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  getStatusLabel(status: ConversationStatus): string {
    switch (status) {
      case 'OPEN':
        return 'Open';
      case 'PENDING_AGENT':
        return 'Pending';
      case 'CLOSED':
        return 'Closed';
    }
  }

  getKindLabel(kind: string): string {
    switch (kind) {
      case 'LOCATION':
        return '📍 Location';
      case 'IMAGE':
        return '🖼️ Image';
      case 'VOICE':
        return '🎤 Voice';
      case 'SYSTEM':
        return 'System message';
      default:
        return 'Message';
    }
  }

  getConfidenceLevel(confidence: number): string {
    if (confidence >= 0.8) return 'high';
    if (confidence >= 0.6) return 'medium';
    return 'low';
  }
}
