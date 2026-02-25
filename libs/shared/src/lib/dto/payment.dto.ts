// ==================== PAYMENT TYPES ====================

export type PaymentMethod = 'CASH' | 'CREDIT_CARD';
export type OrderPaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXPIRED';

// ==================== ORDER PAYMENT ====================

export interface OrderPaymentDto {
  id: string;
  tenantId: string;
  orderId: string;
  conversationId: string;
  method: PaymentMethod;
  status: OrderPaymentStatus;
  amount: number;
  currency: string;
  checkoutFormUrl: string | null;
  expiresAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface InitiatePaymentDto {
  orderId: string;
  conversationId: string;
  method: PaymentMethod;
}

export interface PaymentCallbackDto {
  token: string;
}

// ==================== WHATSAPP INTERACTIVE MESSAGES ====================

export interface WhatsAppInteractiveButton {
  type: 'reply';
  reply: {
    id: string;
    title: string; // max 20 chars
  };
}

export interface WhatsAppInteractiveMessage {
  type: 'button';
  header?: { type: 'text'; text: string };
  body: { text: string };
  footer?: { text: string };
  action: {
    buttons: WhatsAppInteractiveButton[];
  };
}

export interface WhatsAppLocationRequestMessage {
  type: 'location_request_message';
  body: { text: string };
  action: { name: 'send_location' };
}
