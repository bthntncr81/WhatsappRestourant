import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

// ==================== DTOs ====================

export type ConversationStatus = 'OPEN' | 'PENDING_AGENT' | 'CLOSED';
export type MessageDirection = 'IN' | 'OUT';
export type MessageKind = 'TEXT' | 'LOCATION' | 'IMAGE' | 'VOICE' | 'SYSTEM';

export interface ConversationDto {
  id: string;
  tenantId: string;
  customerPhone: string;
  customerName: string | null;
  status: ConversationStatus;
  lastMessageAt: string;
  createdAt: string;
  lastMessage?: MessageDto;
  unreadCount?: number;
}

export interface MessageDto {
  id: string;
  tenantId: string;
  conversationId: string;
  direction: MessageDirection;
  kind: MessageKind;
  text: string | null;
  payloadJson: Record<string, unknown> | null;
  senderUserId: string | null;
  senderName?: string;
  externalId: string | null;
  createdAt: string;
}

export interface InboxSummaryDto {
  total: number;
  open: number;
  pendingAgent: number;
  closed: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

// ==================== ORDER INTENT ====================

export interface OrderIntentDto {
  id: string;
  tenantId: string;
  conversationId: string;
  lastUserMessageId: string;
  extractedJson: ExtractedOrderData;
  confidence: number;
  needsClarification: boolean;
  clarificationQuestion: string | null;
  agentFeedback: 'correct' | 'incorrect' | null;
  createdAt: string;
}

export interface ExtractedOrderData {
  items: ExtractedOrderItem[];
  missingFields: string[];
  clarificationQuestion: string | null;
  confidence: number;
}

export interface ExtractedOrderItem {
  menuItemId: string;
  menuItemName?: string;
  qty: number;
  optionSelections: { groupName: string; optionName: string }[];
  extras: { name: string; qty: number }[];
  notes: string | null;
}

// ==================== ASSIGNMENT ====================

export interface ConversationAssignmentDto {
  id: string;
  tenantId: string;
  conversationId: string;
  assignedUserId: string;
  assignedUserName: string;
  assignedAt: string;
}

export interface ConversationLockDto {
  conversationId: string;
  lockedByUserId: string;
  lockedByUserName: string;
  lockedAt: string;
  expiresAt: string;
  isOwnLock: boolean;
}

export interface ConversationParticipantDto {
  id: string;
  conversationId: string;
  userId: string;
  userName: string;
  canWrite: boolean;
  joinedAt: string;
}

export interface InternalNoteDto {
  id: string;
  tenantId: string;
  conversationId: string;
  authorUserId: string;
  authorName: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentDto {
  id: string;
  name: string;
  email: string;
  role: string;
}

@Injectable({
  providedIn: 'root',
})
export class InboxService {
  private http = inject(HttpClient);
  private authService = inject(AuthService);

  private get headers() {
    return { headers: this.authService.getAuthHeaders() };
  }

  // ==================== SUMMARY ====================

  getSummary(): Observable<ApiResponse<InboxSummaryDto>> {
    return this.http.get<ApiResponse<InboxSummaryDto>>(
      `${environment.apiBaseUrl}/inbox/summary`,
      this.headers
    );
  }

  // ==================== CONVERSATIONS ====================

  getConversations(params?: {
    status?: ConversationStatus;
    q?: string;
    limit?: number;
    offset?: number;
  }): Observable<ApiResponse<{ conversations: ConversationDto[]; total: number }>> {
    const queryParams = new URLSearchParams();
    if (params?.status) queryParams.set('status', params.status);
    if (params?.q) queryParams.set('q', params.q);
    if (params?.limit) queryParams.set('limit', params.limit.toString());
    if (params?.offset) queryParams.set('offset', params.offset.toString());

    const query = queryParams.toString() ? `?${queryParams.toString()}` : '';
    return this.http.get<ApiResponse<{ conversations: ConversationDto[]; total: number }>>(
      `${environment.apiBaseUrl}/inbox/conversations${query}`,
      this.headers
    );
  }

  getConversation(id: string): Observable<ApiResponse<ConversationDto>> {
    return this.http.get<ApiResponse<ConversationDto>>(
      `${environment.apiBaseUrl}/inbox/conversations/${id}`,
      this.headers
    );
  }

  updateConversation(
    id: string,
    data: { status?: ConversationStatus; customerName?: string }
  ): Observable<ApiResponse<ConversationDto>> {
    return this.http.patch<ApiResponse<ConversationDto>>(
      `${environment.apiBaseUrl}/inbox/conversations/${id}`,
      data,
      this.headers
    );
  }

  // ==================== MESSAGES ====================

  getMessages(
    conversationId: string,
    limit?: number,
    before?: string
  ): Observable<ApiResponse<MessageDto[]>> {
    const queryParams = new URLSearchParams();
    if (limit) queryParams.set('limit', limit.toString());
    if (before) queryParams.set('before', before);

    const query = queryParams.toString() ? `?${queryParams.toString()}` : '';
    return this.http.get<ApiResponse<MessageDto[]>>(
      `${environment.apiBaseUrl}/inbox/conversations/${conversationId}/messages${query}`,
      this.headers
    );
  }

  sendReply(conversationId: string, text: string): Observable<ApiResponse<MessageDto>> {
    return this.http.post<ApiResponse<MessageDto>>(
      `${environment.apiBaseUrl}/inbox/conversations/${conversationId}/reply`,
      { text },
      this.headers
    );
  }

  // ==================== ORDER INTENTS ====================

  getOrderIntents(conversationId: string): Observable<ApiResponse<OrderIntentDto[]>> {
    return this.http.get<ApiResponse<OrderIntentDto[]>>(
      `${environment.apiBaseUrl}/nlu/conversations/${conversationId}/intents`,
      this.headers
    );
  }

  submitIntentFeedback(
    intentId: string,
    feedback: 'correct' | 'incorrect'
  ): Observable<ApiResponse<void>> {
    return this.http.post<ApiResponse<void>>(
      `${environment.apiBaseUrl}/nlu/intents/${intentId}/feedback`,
      { feedback },
      this.headers
    );
  }

  // ==================== AGENTS ====================

  getAgents(): Observable<ApiResponse<AgentDto[]>> {
    return this.http.get<ApiResponse<AgentDto[]>>(
      `${environment.apiBaseUrl}/inbox/agents`,
      this.headers
    );
  }

  // ==================== ASSIGNMENT ====================

  getAssignment(conversationId: string): Observable<ApiResponse<ConversationAssignmentDto | null>> {
    return this.http.get<ApiResponse<ConversationAssignmentDto | null>>(
      `${environment.apiBaseUrl}/inbox/conversations/${conversationId}/assignment`,
      this.headers
    );
  }

  assignConversation(conversationId: string, userId: string): Observable<ApiResponse<ConversationAssignmentDto>> {
    return this.http.post<ApiResponse<ConversationAssignmentDto>>(
      `${environment.apiBaseUrl}/inbox/conversations/${conversationId}/assign`,
      { userId },
      this.headers
    );
  }

  unassignConversation(conversationId: string): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(
      `${environment.apiBaseUrl}/inbox/conversations/${conversationId}/assign`,
      this.headers
    );
  }

  handoffToAgent(conversationId: string): Observable<ApiResponse<void>> {
    return this.http.post<ApiResponse<void>>(
      `${environment.apiBaseUrl}/inbox/conversations/${conversationId}/handoff-to-agent`,
      {},
      this.headers
    );
  }

  // ==================== LOCK ====================

  getLock(conversationId: string): Observable<ApiResponse<ConversationLockDto | null>> {
    return this.http.get<ApiResponse<ConversationLockDto | null>>(
      `${environment.apiBaseUrl}/inbox/conversations/${conversationId}/lock`,
      this.headers
    );
  }

  acquireLock(conversationId: string): Observable<ApiResponse<ConversationLockDto>> {
    return this.http.post<ApiResponse<ConversationLockDto>>(
      `${environment.apiBaseUrl}/inbox/conversations/${conversationId}/lock`,
      {},
      this.headers
    );
  }

  refreshLock(conversationId: string): Observable<ApiResponse<ConversationLockDto>> {
    return this.http.put<ApiResponse<ConversationLockDto>>(
      `${environment.apiBaseUrl}/inbox/conversations/${conversationId}/lock`,
      {},
      this.headers
    );
  }

  releaseLock(conversationId: string): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(
      `${environment.apiBaseUrl}/inbox/conversations/${conversationId}/lock`,
      this.headers
    );
  }

  // ==================== PARTICIPANTS ====================

  getParticipants(conversationId: string): Observable<ApiResponse<ConversationParticipantDto[]>> {
    return this.http.get<ApiResponse<ConversationParticipantDto[]>>(
      `${environment.apiBaseUrl}/inbox/conversations/${conversationId}/participants`,
      this.headers
    );
  }

  joinConversation(conversationId: string): Observable<ApiResponse<ConversationParticipantDto>> {
    return this.http.post<ApiResponse<ConversationParticipantDto>>(
      `${environment.apiBaseUrl}/inbox/conversations/${conversationId}/join`,
      {},
      this.headers
    );
  }

  leaveConversation(conversationId: string): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(
      `${environment.apiBaseUrl}/inbox/conversations/${conversationId}/leave`,
      this.headers
    );
  }

  // ==================== INTERNAL NOTES ====================

  getInternalNotes(conversationId: string): Observable<ApiResponse<InternalNoteDto[]>> {
    return this.http.get<ApiResponse<InternalNoteDto[]>>(
      `${environment.apiBaseUrl}/inbox/conversations/${conversationId}/notes`,
      this.headers
    );
  }

  createInternalNote(conversationId: string, text: string): Observable<ApiResponse<InternalNoteDto>> {
    return this.http.post<ApiResponse<InternalNoteDto>>(
      `${environment.apiBaseUrl}/inbox/conversations/${conversationId}/notes`,
      { text },
      this.headers
    );
  }

  updateInternalNote(noteId: string, text: string): Observable<ApiResponse<InternalNoteDto>> {
    return this.http.patch<ApiResponse<InternalNoteDto>>(
      `${environment.apiBaseUrl}/inbox/notes/${noteId}`,
      { text },
      this.headers
    );
  }

  deleteInternalNote(noteId: string): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(
      `${environment.apiBaseUrl}/inbox/notes/${noteId}`,
      this.headers
    );
  }
}

