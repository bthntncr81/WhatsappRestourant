import { inboxService } from './inbox.service';
import { geoService } from './geo.service';
import { whatsappProviderService } from './whatsapp-provider.service';
import { whatsappConfigService } from './whatsapp-config.service';
import { createLogger } from '../logger';
import {
  WhatsAppWebhookPayload,
  MessageDto,
  MessageKind,
} from '@whatres/shared';

const logger = createLogger();

export class WhatsAppService {
  /**
   * Process incoming WhatsApp webhook message
   * Stores message in DB and performs geo check for location messages.
   * Response logic is handled by conversation-flow.service.ts
   */
  async processIncomingMessage(
    tenantId: string,
    payload: WhatsAppWebhookPayload
  ): Promise<MessageDto> {
    // Normalize phone number (remove + prefix if present)
    const customerPhone = payload.from.replace(/^\+/, '');
    const customerName = payload.fromName;

    // Get or create conversation
    const conversation = await inboxService.getOrCreateConversation(
      tenantId,
      customerPhone,
      customerName
    );

    // Determine message kind
    const kind = this.mapPayloadTypeToKind(payload.type);

    // Extract text based on type
    let text: string | null = null;
    let payloadJson: Record<string, unknown> | undefined;

    switch (payload.type) {
      case 'text':
        text = payload.text?.body || null;
        break;
      case 'location':
        text = payload.location?.name || payload.location?.address || 'Location shared';
        payloadJson = {
          latitude: payload.location?.latitude,
          longitude: payload.location?.longitude,
          name: payload.location?.name,
          address: payload.location?.address,
        };
        break;
      case 'image':
        text = payload.image?.caption || 'Image';
        payloadJson = {
          imageId: payload.image?.id,
          url: payload.image?.url,
          mimeType: payload.image?.mimeType,
        };
        break;
      case 'voice':
        text = 'Voice message';
        payloadJson = {
          voiceId: payload.voice?.id,
          url: payload.voice?.url,
          mimeType: payload.voice?.mimeType,
        };
        break;
      case 'interactive':
      case 'button':
        text =
          payload.interactive?.buttonReply?.title ||
          payload.interactive?.listReply?.title ||
          'Interactive response';
        payloadJson = { interactive: payload.interactive };
        break;
    }

    // Store raw payload for debugging
    if (payload.raw) {
      payloadJson = { ...payloadJson, raw: payload.raw };
    }

    // Create message
    const message = await inboxService.createMessage(
      tenantId,
      conversation.id,
      'IN',
      kind,
      text,
      payloadJson,
      undefined, // No sender user for incoming messages
      payload.messageId
    );

    logger.info(
      { tenantId, conversationId: conversation.id, messageId: message.id, kind },
      'Processed incoming WhatsApp message'
    );

    // Store geo check result when customer sends location (side effect)
    // Response messages are handled by conversation-flow.service.ts
    if (kind === 'LOCATION' && payload.location?.latitude && payload.location?.longitude) {
      try {
        const result = await geoService.checkServiceArea(tenantId, {
          lat: payload.location.latitude,
          lng: payload.location.longitude,
        });
        await inboxService.updateConversationGeoCheck(tenantId, conversation.id, result, {
          lat: payload.location.latitude,
          lng: payload.location.longitude,
        });
        logger.info(
          { tenantId, conversationId: conversation.id, isWithinServiceArea: result.isWithinServiceArea },
          'Geo check stored for location message'
        );
      } catch (error) {
        logger.error({ error, tenantId, conversationId: conversation.id }, 'Failed to process geo check');
      }
    }

    return message;
  }

  // ==================== SEND MESSAGES ====================

  /**
   * Get per-tenant WhatsApp config (cached per request context)
   */
  private async getTenantConfig(tenantId: string): Promise<{ phoneNumberId: string; accessToken: string } | null> {
    try {
      const config = await whatsappConfigService.getDecryptedConfig(tenantId);
      if (config?.phoneNumberId && config?.accessToken) {
        return { phoneNumberId: config.phoneNumberId, accessToken: config.accessToken };
      }
    } catch (error) {
      logger.warn({ error, tenantId }, 'Failed to get per-tenant WhatsApp config, falling back to global');
    }
    return null;
  }

  /**
   * Send a text message via WhatsApp provider
   * Uses per-tenant DB config if available, falls back to global env config
   */
  async sendText(
    tenantId: string,
    conversationId: string,
    text: string,
    senderUserId?: string,
  ): Promise<{ messageId: string; externalId?: string }> {
    const conversation = await inboxService.getConversation(tenantId, conversationId);

    // Store message in DB
    const message = await inboxService.createMessage(
      tenantId,
      conversationId,
      'OUT',
      'TEXT',
      text,
      senderUserId ? undefined : { isSystemMessage: true },
      senderUserId,
    );

    // Send via provider - try per-tenant config first, then global
    try {
      const tenantConfig = await this.getTenantConfig(tenantId);
      let result;
      if (tenantConfig) {
        result = await whatsappProviderService.sendTextWithConfig(conversation.customerPhone, text, tenantConfig);
      } else {
        result = await whatsappProviderService.sendText(conversation.customerPhone, text);
      }
      return { messageId: message.id, externalId: result.messageId };
    } catch (error) {
      logger.error({ error, tenantId, conversationId }, 'Failed to send text message');
      return { messageId: message.id };
    }
  }

  /**
   * Send interactive button message (e.g., payment method selection)
   * Uses per-tenant DB config if available, falls back to global env config
   */
  async sendInteractiveButtons(
    tenantId: string,
    conversationId: string,
    body: string,
    buttons: Array<{ id: string; title: string }>,
    header?: string,
  ): Promise<{ messageId: string; externalId?: string }> {
    const conversation = await inboxService.getConversation(tenantId, conversationId);

    // Store in DB as system message with payload
    const message = await inboxService.createMessage(
      tenantId,
      conversationId,
      'OUT',
      'TEXT',
      body,
      { isSystemMessage: true, interactive: { buttons } },
    );

    try {
      const tenantConfig = await this.getTenantConfig(tenantId);
      let result;
      if (tenantConfig) {
        result = await whatsappProviderService.sendInteractiveButtonsWithConfig(
          conversation.customerPhone, body, buttons, tenantConfig, header,
        );
      } else {
        result = await whatsappProviderService.sendInteractiveButtons(
          conversation.customerPhone, body, buttons, header,
        );
      }
      return { messageId: message.id, externalId: result.messageId };
    } catch (error) {
      logger.error({ error, tenantId, conversationId }, 'Failed to send interactive buttons');
      return { messageId: message.id };
    }
  }

  /**
   * Send location request message
   * Uses per-tenant DB config if available, falls back to global env config
   */
  async sendLocationRequest(
    tenantId: string,
    conversationId: string,
    bodyText: string,
  ): Promise<{ messageId: string; externalId?: string }> {
    const conversation = await inboxService.getConversation(tenantId, conversationId);

    const message = await inboxService.createMessage(
      tenantId,
      conversationId,
      'OUT',
      'TEXT',
      bodyText,
      { isSystemMessage: true, type: 'location_request' },
    );

    try {
      const tenantConfig = await this.getTenantConfig(tenantId);
      let result;
      if (tenantConfig) {
        result = await whatsappProviderService.sendLocationRequestWithConfig(
          conversation.customerPhone, bodyText, tenantConfig,
        );
      } else {
        result = await whatsappProviderService.sendLocationRequest(conversation.customerPhone, bodyText);
      }
      return { messageId: message.id, externalId: result.messageId };
    } catch (error) {
      logger.error({ error, tenantId, conversationId }, 'Failed to send location request');
      return { messageId: message.id };
    }
  }

  /**
   * Send interactive list message (e.g., saved address selection)
   */
  async sendListMessage(
    tenantId: string,
    conversationId: string,
    body: string,
    buttonText: string,
    sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>,
    header?: string,
  ): Promise<{ messageId: string; externalId?: string }> {
    const conversation = await inboxService.getConversation(tenantId, conversationId);

    const message = await inboxService.createMessage(
      tenantId,
      conversationId,
      'OUT',
      'TEXT',
      body,
      { isSystemMessage: true, interactive: { type: 'list', sections } },
    );

    try {
      const tenantConfig = await this.getTenantConfig(tenantId);
      let result;
      if (tenantConfig) {
        result = await whatsappProviderService.sendListMessageWithConfig(
          conversation.customerPhone, body, buttonText, sections, tenantConfig, header,
        );
      } else {
        result = await whatsappProviderService.sendListMessage(
          conversation.customerPhone, body, buttonText, sections, header,
        );
      }
      return { messageId: message.id, externalId: result.messageId };
    } catch (error) {
      logger.error({ error, tenantId, conversationId }, 'Failed to send list message');
      return { messageId: message.id };
    }
  }

  /**
   * Send message (agent/admin sending from inbox)
   */
  async sendMessage(
    tenantId: string,
    conversationId: string,
    text: string,
    senderUserId: string
  ): Promise<{ messageId: string; externalId?: string }> {
    return this.sendText(tenantId, conversationId, text, senderUserId);
  }

  // ==================== HELPERS ====================

  /**
   * Map webhook payload type to our MessageKind enum
   */
  private mapPayloadTypeToKind(type: string): MessageKind {
    switch (type) {
      case 'text':
        return 'TEXT';
      case 'location':
        return 'LOCATION';
      case 'image':
        return 'IMAGE';
      case 'voice':
        return 'VOICE';
      default:
        return 'TEXT';
    }
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(signature: string, rawBody: Buffer): boolean {
    return whatsappProviderService.verifySignature(signature, rawBody);
  }
}

export const whatsappService = new WhatsAppService();
