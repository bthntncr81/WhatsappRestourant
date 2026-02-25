import crypto from 'crypto';
import { createLogger } from '../logger';
import { WhatsAppWebhookPayload } from '@whatres/shared';

const logger = createLogger();

// ==================== CONFIGURATION ====================

interface MetaCloudApiConfig {
  phoneNumberId: string;
  accessToken: string;
  apiVersion: string;
  verifyToken: string;
  appSecret: string;
}

const getConfig = (): MetaCloudApiConfig => {
  return {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v21.0',
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || 'whatres-verify-token',
    appSecret: process.env.WHATSAPP_APP_SECRET || '',
  };
};

// ==================== SERVICE ====================

export class WhatsAppProviderService {
  private config: MetaCloudApiConfig;

  constructor() {
    this.config = getConfig();
    if (this.config.phoneNumberId) {
      logger.info({ phoneNumberId: this.config.phoneNumberId }, 'WhatsApp Meta Cloud API provider initialized');
    } else {
      logger.warn('WhatsApp provider not configured - messages will be logged only');
    }
  }

  isConfigured(): boolean {
    return !!(this.config.phoneNumberId && this.config.accessToken);
  }

  // ==================== SEND MESSAGES ====================

  /**
   * Send a plain text message
   */
  async sendText(to: string, text: string): Promise<{ messageId: string }> {
    return this.sendMessage(to, {
      type: 'text',
      text: { preview_url: true, body: text },
    });
  }

  /**
   * Send interactive button message (e.g., payment method selection)
   */
  async sendInteractiveButtons(
    to: string,
    body: string,
    buttons: Array<{ id: string; title: string }>,
    header?: string,
    footer?: string,
  ): Promise<{ messageId: string }> {
    const interactive: Record<string, unknown> = {
      type: 'button',
      body: { text: body },
      action: {
        buttons: buttons.map((btn) => ({
          type: 'reply',
          reply: { id: btn.id, title: btn.title },
        })),
      },
    };

    if (header) {
      interactive.header = { type: 'text', text: header };
    }
    if (footer) {
      interactive.footer = { text: footer };
    }

    return this.sendMessage(to, {
      type: 'interactive',
      interactive,
    });
  }

  /**
   * Send a location request message
   */
  async sendLocationRequest(to: string, bodyText: string): Promise<{ messageId: string }> {
    return this.sendMessage(to, {
      type: 'interactive',
      interactive: {
        type: 'location_request_message',
        body: { text: bodyText },
        action: { name: 'send_location' },
      },
    });
  }

  // ==================== WEBHOOK VERIFICATION ====================

  /**
   * Verify webhook signature (HMAC-SHA256)
   */
  verifySignature(signature: string, rawBody: Buffer): boolean {
    if (!this.config.appSecret) {
      logger.warn('WhatsApp App Secret not configured, skipping signature verification');
      return true;
    }

    const expectedSignature = crypto
      .createHmac('sha256', this.config.appSecret)
      .update(rawBody)
      .digest('hex');

    const providedHash = signature.replace('sha256=', '');
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(providedHash, 'hex'),
    );
  }

  /**
   * Verify webhook subscription (GET request from Meta)
   */
  verifyWebhook(mode: string, token: string, challenge: string): string | null {
    if (mode === 'subscribe' && token === this.config.verifyToken) {
      logger.info('WhatsApp webhook verified successfully');
      return challenge;
    }
    logger.warn({ mode, token }, 'WhatsApp webhook verification failed');
    return null;
  }

  // ==================== PARSE WEBHOOK ====================

  /**
   * Parse Meta webhook payload into internal format
   */
  parseWebhookPayload(metaPayload: Record<string, unknown>): WhatsAppWebhookPayload | null {
    try {
      const entry = (metaPayload.entry as any[])?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;

      if (!value?.messages?.[0]) {
        // Status update or other non-message event
        return null;
      }

      const msg = value.messages[0];
      const contact = value.contacts?.[0];

      const payload: WhatsAppWebhookPayload = {
        messageId: msg.id,
        from: msg.from,
        fromName: contact?.profile?.name,
        type: msg.type,
        timestamp: msg.timestamp,
        raw: metaPayload,
      };

      switch (msg.type) {
        case 'text':
          payload.text = { body: msg.text.body };
          break;
        case 'location':
          payload.location = {
            latitude: msg.location.latitude,
            longitude: msg.location.longitude,
            name: msg.location.name,
            address: msg.location.address,
          };
          break;
        case 'image':
          payload.image = {
            id: msg.image.id,
            caption: msg.image.caption,
            mimeType: msg.image.mime_type,
          };
          break;
        case 'voice':
          payload.voice = {
            id: msg.voice.id,
            mimeType: msg.voice.mime_type,
          };
          break;
        case 'interactive':
          if (msg.interactive.type === 'button_reply') {
            payload.type = 'interactive';
            payload.interactive = {
              type: 'button_reply',
              buttonReply: {
                id: msg.interactive.button_reply.id,
                title: msg.interactive.button_reply.title,
              },
            };
          } else if (msg.interactive.type === 'list_reply') {
            payload.interactive = {
              type: 'list_reply',
              listReply: {
                id: msg.interactive.list_reply.id,
                title: msg.interactive.list_reply.title,
                description: msg.interactive.list_reply.description,
              },
            };
          }
          break;
      }

      return payload;
    } catch (error) {
      logger.error({ error, metaPayload }, 'Failed to parse Meta webhook payload');
      return null;
    }
  }

  // ==================== PER-TENANT SEND METHODS ====================

  /**
   * Send text using per-tenant DB config (decrypted credentials)
   */
  async sendTextWithConfig(
    to: string,
    text: string,
    tenantConfig: { phoneNumberId: string; accessToken: string },
  ): Promise<{ messageId: string }> {
    return this.sendMessageWithConfig(to, { type: 'text', text: { preview_url: true, body: text } }, tenantConfig);
  }

  /**
   * Send interactive buttons using per-tenant DB config
   */
  async sendInteractiveButtonsWithConfig(
    to: string,
    body: string,
    buttons: Array<{ id: string; title: string }>,
    tenantConfig: { phoneNumberId: string; accessToken: string },
    header?: string,
    footer?: string,
  ): Promise<{ messageId: string }> {
    const interactive: Record<string, unknown> = {
      type: 'button',
      body: { text: body },
      action: {
        buttons: buttons.map((btn) => ({
          type: 'reply',
          reply: { id: btn.id, title: btn.title },
        })),
      },
    };
    if (header) interactive.header = { type: 'text', text: header };
    if (footer) interactive.footer = { text: footer };
    return this.sendMessageWithConfig(to, { type: 'interactive', interactive }, tenantConfig);
  }

  /**
   * Send location request using per-tenant DB config
   */
  async sendLocationRequestWithConfig(
    to: string,
    bodyText: string,
    tenantConfig: { phoneNumberId: string; accessToken: string },
  ): Promise<{ messageId: string }> {
    return this.sendMessageWithConfig(to, {
      type: 'interactive',
      interactive: {
        type: 'location_request_message',
        body: { text: bodyText },
        action: { name: 'send_location' },
      },
    }, tenantConfig);
  }

  // ==================== PRIVATE ====================

  private async sendMessageWithConfig(
    to: string,
    messagePayload: Record<string, unknown>,
    tenantConfig: { phoneNumberId: string; accessToken: string },
  ): Promise<{ messageId: string }> {
    const formattedTo = to.replace(/^\+/, '');
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: formattedTo,
      ...messagePayload,
    };

    const apiVersion = this.config.apiVersion || 'v21.0';
    const url = `https://graph.facebook.com/${apiVersion}/${tenantConfig.phoneNumberId}/messages`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tenantConfig.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const data = await response.json() as any;

      if (!response.ok) {
        logger.error({ status: response.status, error: data.error, to: formattedTo }, 'Meta Cloud API send failed (per-tenant)');
        throw new Error(data.error?.message || `Meta API error: ${response.status}`);
      }

      const messageId = data.messages?.[0]?.id || `meta_${Date.now()}`;
      logger.info({ to: formattedTo, messageId, type: messagePayload.type }, 'WhatsApp message sent (per-tenant)');
      return { messageId };
    } catch (error) {
      logger.error({ error, to: formattedTo }, 'Failed to send WhatsApp message (per-tenant)');
      throw error;
    }
  }

  private async sendMessage(
    to: string,
    messagePayload: Record<string, unknown>,
  ): Promise<{ messageId: string }> {
    const formattedTo = to.replace(/^\+/, '');

    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: formattedTo,
      ...messagePayload,
    };

    if (!this.isConfigured()) {
      logger.info(
        {
          provider: 'STUB',
          to: formattedTo,
          type: messagePayload.type,
          text: typeof messagePayload.text === 'object'
            ? (messagePayload.text as any)?.body?.substring(0, 80)
            : undefined,
        },
        'WhatsApp SEND (stub) - Provider not configured',
      );
      return { messageId: `stub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` };
    }

    const url = `https://graph.facebook.com/${this.config.apiVersion}/${this.config.phoneNumberId}/messages`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const data = await response.json() as any;

      if (!response.ok) {
        logger.error(
          { status: response.status, error: data.error, to: formattedTo },
          'Meta Cloud API send failed',
        );
        throw new Error(data.error?.message || `Meta API error: ${response.status}`);
      }

      const messageId = data.messages?.[0]?.id || `meta_${Date.now()}`;
      logger.info({ to: formattedTo, messageId, type: messagePayload.type }, 'WhatsApp message sent');

      return { messageId };
    } catch (error) {
      logger.error({ error, to: formattedTo }, 'Failed to send WhatsApp message');
      throw error;
    }
  }
}

export const whatsappProviderService = new WhatsAppProviderService();
