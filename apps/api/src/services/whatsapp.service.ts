import { inboxService } from './inbox.service';
import { geoService } from './geo.service';
import { createLogger } from '../logger';
import {
  WhatsAppWebhookPayload,
  MessageDto,
  MessageKind,
  GeoCheckResult,
} from '@whatres/shared';

const logger = createLogger();

export class WhatsAppService {
  /**
   * Process incoming WhatsApp webhook message
   * Provider-agnostic: normalizes payload to our internal format
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
      { tenantId, conversationId: conversation.id, messageId: message.id },
      'Processed incoming WhatsApp message'
    );

    // ==================== GEO CHECK HOOK ====================
    // When customer sends location, check if within service area
    if (kind === 'LOCATION' && payload.location?.latitude && payload.location?.longitude) {
      await this.handleLocationMessage(
        tenantId,
        conversation.id,
        {
          lat: payload.location.latitude,
          lng: payload.location.longitude,
        }
      );
    }

    return message;
  }

  /**
   * Handle location message - check service area and respond
   */
  private async handleLocationMessage(
    tenantId: string,
    conversationId: string,
    location: { lat: number; lng: number }
  ): Promise<void> {
    try {
      const result = await geoService.checkServiceArea(tenantId, location);

      // Store geo check result in conversation (for later use in order flow)
      await inboxService.updateConversationGeoCheck(tenantId, conversationId, result);

      // Send appropriate response based on service area check
      if (result.isWithinServiceArea) {
        // Customer is within service area
        const deliveryInfo = result.deliveryRule
          ? `\n\n📍 ${result.nearestStore?.name}\n🚗 Teslimat ücreti: ${result.deliveryRule.deliveryFee} TL\n🛒 Minimum sepet: ${result.deliveryRule.minBasket} TL`
          : '';

        await this.sendSystemMessage(
          tenantId,
          conversationId,
          `✅ Harika! Konumunuza hizmet verebiliyoruz.${deliveryInfo}\n\nSiparişinizi almaya hazırız. Menümüzden seçim yapabilirsiniz.`
        );
      } else {
        // Customer is outside service area
        let message = '❌ ' + result.message;

        if (result.alternativeStores.length > 0) {
          message += '\n\nSize en yakın şubelerimiz:';
          result.alternativeStores.forEach((alt, i) => {
            message += `\n${i + 1}. ${alt.store.name} (${alt.distance.toFixed(1)} km)`;
            if (alt.store.phone) {
              message += ` - ${alt.store.phone}`;
            }
          });
        }

        await this.sendSystemMessage(tenantId, conversationId, message);
      }

      logger.info(
        {
          tenantId,
          conversationId,
          isWithinServiceArea: result.isWithinServiceArea,
          nearestStore: result.nearestStore?.name,
          distance: result.distance,
        },
        'Processed location message geo check'
      );
    } catch (error) {
      logger.error({ error, tenantId, conversationId }, 'Failed to process geo check');
      // Don't fail the whole message processing if geo check fails
    }
  }

  /**
   * Send a system/bot message to conversation
   */
  private async sendSystemMessage(
    tenantId: string,
    conversationId: string,
    text: string
  ): Promise<void> {
    // Create outgoing message in DB
    await inboxService.createMessage(
      tenantId,
      conversationId,
      'OUT',
      'TEXT',
      text,
      { isSystemMessage: true },
      undefined // No sender user for system messages
    );

    // Get conversation for logging
    const conversation = await inboxService.getConversation(tenantId, conversationId);

    // Log (in production, this would send via provider)
    logger.info(
      {
        provider: 'STUB',
        tenantId,
        to: conversation.customerPhone,
        text: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
        isSystemMessage: true,
      },
      '📤 WhatsApp SYSTEM MESSAGE (stub)'
    );
  }

  /**
   * Send message via WhatsApp
   * Currently a stub - logs to console
   * In production, this would call the actual WhatsApp provider API
   */
  async sendMessage(
    tenantId: string,
    conversationId: string,
    text: string,
    senderUserId: string
  ): Promise<{ messageId: string; externalId?: string }> {
    // Get conversation to get customer phone
    const conversation = await inboxService.getConversation(tenantId, conversationId);

    // Create outgoing message in DB
    const message = await inboxService.createMessage(
      tenantId,
      conversationId,
      'OUT',
      'TEXT',
      text,
      undefined,
      senderUserId
    );

    // ============================================
    // PROVIDER STUB - Replace with actual provider
    // ============================================
    logger.info(
      {
        provider: 'STUB',
        tenantId,
        to: conversation.customerPhone,
        messageId: message.id,
        text: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
      },
      '📤 WhatsApp SEND (stub) - Message would be sent to provider'
    );

    // Simulate external ID from provider
    const externalId = `ext_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // In production, you would:
    // 1. Call provider API (e.g., Twilio, MessageBird, Meta Cloud API)
    // 2. Get the external message ID from response
    // 3. Update message record with external ID
    // 4. Handle errors and retries
    // ============================================

    return {
      messageId: message.id,
      externalId,
    };
  }

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
   * Verify webhook signature (placeholder)
   * In production, implement actual signature verification
   */
  verifyWebhookSignature(signature: string, body: string, secret: string): boolean {
    // TODO: Implement actual signature verification based on provider
    // For now, return true (stub)
    logger.debug({ signature: signature.substring(0, 20) + '...' }, 'Webhook signature verification (stub)');
    return true;
  }
}

export const whatsappService = new WhatsAppService();

