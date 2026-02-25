export type WhatsAppConnectionStatus = 'DISCONNECTED' | 'PENDING' | 'CONNECTED' | 'ERROR';

/** Returned to frontend with sensitive fields masked */
export interface WhatsAppConfigDto {
  id: string;
  tenantId: string;
  phoneNumberId: string;
  wabaId: string;
  accessTokenMasked: string;
  appSecretMasked: string;
  webhookVerifyToken: string;
  webhookUrl: string;
  connectionStatus: WhatsAppConnectionStatus;
  statusMessage: string | null;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Create/Update request from frontend */
export interface UpsertWhatsAppConfigDto {
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
  appSecret: string;
}

/** Test connection response */
export interface WhatsAppTestConnectionDto {
  success: boolean;
  phoneNumber?: string;
  qualityRating?: string;
  messagingLimit?: string;
  message: string;
}
