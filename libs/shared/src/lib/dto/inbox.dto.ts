// ==================== CONVERSATION ====================

export type ConversationStatus = 'OPEN' | 'PENDING_AGENT' | 'CLOSED';

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
  // Geo check fields
  customerLat?: number | null;
  customerLng?: number | null;
  isWithinService?: boolean | null;
  nearestStoreId?: string | null;
}

export interface ConversationListQueryDto {
  status?: ConversationStatus;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface UpdateConversationDto {
  status?: ConversationStatus;
  customerName?: string;
}

// ==================== MESSAGE ====================

export type MessageDirection = 'IN' | 'OUT';
export type MessageKind = 'TEXT' | 'LOCATION' | 'IMAGE' | 'VOICE' | 'SYSTEM';

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

export interface CreateMessageDto {
  conversationId: string;
  text: string;
}

export interface ReplyMessageDto {
  text: string;
}

// ==================== WHATSAPP WEBHOOK ====================

export interface WhatsAppWebhookPayload {
  // Generic payload structure - provider-agnostic
  messageId?: string;
  from: string;
  fromName?: string;
  type: 'text' | 'location' | 'image' | 'voice' | 'interactive' | 'button';
  timestamp?: string;
  text?: {
    body: string;
  };
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
  image?: {
    id?: string;
    url?: string;
    caption?: string;
    mimeType?: string;
  };
  voice?: {
    id?: string;
    url?: string;
    mimeType?: string;
  };
  interactive?: {
    type: string;
    buttonReply?: {
      id: string;
      title: string;
    };
    listReply?: {
      id: string;
      title: string;
      description?: string;
    };
  };
  // Raw payload for debugging
  raw?: unknown;
}

export interface WhatsAppSendDto {
  conversationId: string;
  text: string;
}

export interface WhatsAppSendResponseDto {
  success: boolean;
  messageId: string;
  externalId?: string;
}

// ==================== INBOX SUMMARY ====================

export interface InboxSummaryDto {
  total: number;
  open: number;
  pendingAgent: number;
  closed: number;
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

export interface AssignConversationDto {
  userId: string;
}

// ==================== LOCK ====================

export interface ConversationLockDto {
  conversationId: string;
  lockedByUserId: string;
  lockedByUserName: string;
  lockedAt: string;
  expiresAt: string;
  isOwnLock: boolean;
}

// ==================== PARTICIPANT ====================

export interface ConversationParticipantDto {
  id: string;
  conversationId: string;
  userId: string;
  userName: string;
  canWrite: boolean;
  joinedAt: string;
}

// ==================== INTERNAL NOTE ====================

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

export interface CreateInternalNoteDto {
  text: string;
}

export interface UpdateInternalNoteDto {
  text: string;
}

// ==================== AGENT ====================

export interface AgentDto {
  id: string;
  name: string;
  email: string;
  role: string;
}

