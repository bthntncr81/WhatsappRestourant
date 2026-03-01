// ==================== ORDER ====================

export type OrderStatus =
  | 'DRAFT'
  | 'PENDING_CONFIRMATION'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'READY'
  | 'DELIVERED'
  | 'CANCELLED';

export interface OrderDto {
  id: string;
  tenantId: string;
  conversationId: string;
  storeId: string | null;
  storeName: string | null;
  orderNumber: number | null;
  status: OrderStatus;
  totalPrice: number;
  notes: string | null;
  customerPhone: string | null;
  customerName: string | null;
  deliveryAddress: string | null;
  paymentMethod: string | null;
  parentOrderId: string | null;
  rejectionReason: string | null;
  items: OrderItemDto[];
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
}

export interface OrderItemDto {
  id: string;
  orderId: string;
  menuItemId: string;
  menuItemName: string;
  qty: number;
  unitPrice: number;
  optionsJson: OrderItemOption[] | null;
  extrasJson: OrderItemExtra[] | null;
  notes: string | null;
}

export interface OrderItemOption {
  groupName: string;
  optionName: string;
  priceDelta: number;
}

export interface OrderItemExtra {
  name: string;
  qty: number;
  price: number;
}

export interface CreateOrderDto {
  conversationId: string;
  items: CreateOrderItemDto[];
  notes?: string;
  customerPhone?: string;
  customerName?: string;
  deliveryAddress?: string;
  paymentMethod?: string;
}

export interface ConfirmOrderDto {
  deliveryAddress?: string;
  paymentMethod?: string;
  notes?: string;
}

export interface RejectOrderDto {
  reason: string;
}

export interface CreateOrderItemDto {
  menuItemId: string;
  qty: number;
  options?: { groupName: string; optionName: string }[];
  extras?: { name: string; qty: number }[];
  notes?: string;
}

// ==================== ORDER INTENT (NLU) ====================

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
  action?: 'add' | 'remove' | 'keep';
}

// ==================== MENU CANDIDATE ====================

export interface MenuCandidateDto {
  menuItemId: string;
  name: string;
  category: string;
  basePrice: number;
  synonymsMatched: string[];
  score: number;
}

// ==================== LLM EXTRACTION ====================

/**
 * JSON Schema for OpenAI Structured Outputs
 * This is the expected response format from the LLM
 */
export interface LlmExtractionResponse {
  items: LlmExtractedItem[];
  missingFields: string[];
  clarificationQuestion: string | null;
  confidence: number;
  orderNotes?: string | null;
}

export interface LlmExtractedItem {
  menuItemId: string;
  qty: number;
  optionSelections: { groupName: string; optionName: string }[];
  extras: { name: string; qty: number }[];
  notes: string | null;
  action: 'add' | 'remove' | 'keep';
  itemConfidence: number;
}

/**
 * OpenAI JSON Schema definition for Structured Outputs
 */
export const LLM_EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          menuItemId: { type: 'string', description: 'ID of the menu item' },
          qty: { type: 'integer', minimum: 1, description: 'Quantity ordered' },
          optionSelections: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                groupName: { type: 'string' },
                optionName: { type: 'string' },
              },
              required: ['groupName', 'optionName'],
              additionalProperties: false,
            },
          },
          extras: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                qty: { type: 'integer', minimum: 1 },
              },
              required: ['name', 'qty'],
              additionalProperties: false,
            },
          },
          notes: { type: ['string', 'null'], description: 'Special instructions' },
          action: {
            type: 'string',
            enum: ['add', 'remove', 'keep'],
            description: 'Action: add = new item or increase qty, remove = remove item, keep = no change (existing item)',
          },
          itemConfidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: 'Confidence score for this specific item (0-1). High if customer clearly named the item, low if ambiguous or inferred.',
          },
        },
        required: ['menuItemId', 'qty', 'optionSelections', 'extras', 'notes', 'action', 'itemConfidence'],
        additionalProperties: false,
      },
    },
    missingFields: {
      type: 'array',
      items: { type: 'string' },
      description: 'List of required information that is missing',
    },
    clarificationQuestion: {
      type: ['string', 'null'],
      description: 'Question to ask the user for clarification, or null if order is clear',
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'Confidence score between 0 and 1',
    },
    orderNotes: {
      type: ['string', 'null'],
      description: 'General order/delivery notes not specific to any item (e.g., "zile basmayin", "kapiya birakin")',
    },
  },
  required: ['items', 'missingFields', 'clarificationQuestion', 'confidence', 'orderNotes'],
  additionalProperties: false,
} as const;

// ==================== AGENT FEEDBACK ====================

export interface OrderIntentFeedbackDto {
  feedback: 'correct' | 'incorrect';
}

// ==================== PRINT JOBS ====================

export type PrintJobType = 'KITCHEN' | 'COURIER';
export type PrintJobStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';

export interface PrintJobDto {
  id: string;
  tenantId: string;
  orderId: string;
  type: PrintJobType;
  status: PrintJobStatus;
  payloadJson: PrintJobPayload;
  errorMessage: string | null;
  retryCount: number;
  createdAt: string;
  processedAt: string | null;
}

export interface PrintJobPayload {
  orderNumber: number;
  timestamp: string;
  storeName?: string | null;
  items: PrintJobItem[];
  notes: string | null;
  // Kitchen specific
  // Courier specific
  customerName?: string | null;
  customerPhone?: string | null;
  deliveryAddress?: string | null;
  paymentMethod?: string | null;
  totalPrice?: number;
}

export interface PrintJobItem {
  name: string;
  qty: number;
  options: string[];
  notes: string | null;
}

export interface PrintJobCompleteDto {
  success: boolean;
  errorMessage?: string;
}

// ==================== ORDER LIST ====================

export interface OrderListQueryDto {
  status?: OrderStatus;
  conversationId?: string;
  limit?: number;
  offset?: number;
}

