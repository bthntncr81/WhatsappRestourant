import crypto from 'crypto';
import prisma from '../db/prisma';
import { AppError } from '../middleware/error-handler';
import { createLogger } from '../logger';
import { getConfig } from '@whatres/config';
import { encrypt, decrypt, maskSecret } from '../utils/encryption';
import {
  WhatsAppConfigDto,
  UpsertWhatsAppConfigDto,
  WhatsAppTestConnectionDto,
} from '@whatres/shared';

const logger = createLogger();

export interface DecryptedWhatsAppConfig {
  tenantId: string;
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
  appSecret: string;
  webhookVerifyToken: string;
}

export class WhatsAppConfigService {
  /** Get config for a tenant (masked for frontend) */
  async getConfig(tenantId: string): Promise<WhatsAppConfigDto | null> {
    const record = await prisma.whatsAppConfig.findUnique({
      where: { tenantId },
    });

    if (!record) return null;

    return this.mapToDto(record);
  }

  /** Create or update WhatsApp config */
  async upsertConfig(
    tenantId: string,
    dto: UpsertWhatsAppConfigDto
  ): Promise<WhatsAppConfigDto> {
    const accessTokenEncrypted = encrypt(dto.accessToken);
    const appSecretEncrypted = encrypt(dto.appSecret);

    const existing = await prisma.whatsAppConfig.findUnique({
      where: { tenantId },
    });

    const webhookVerifyToken = existing?.webhookVerifyToken
      || crypto.randomBytes(32).toString('hex');

    const record = await prisma.whatsAppConfig.upsert({
      where: { tenantId },
      create: {
        tenantId,
        phoneNumberId: dto.phoneNumberId,
        wabaId: dto.wabaId,
        accessTokenEncrypted,
        appSecretEncrypted,
        webhookVerifyToken,
        connectionStatus: 'PENDING',
      },
      update: {
        phoneNumberId: dto.phoneNumberId,
        wabaId: dto.wabaId,
        accessTokenEncrypted,
        appSecretEncrypted,
        connectionStatus: 'PENDING',
        statusMessage: null,
      },
    });

    logger.info({ tenantId }, 'WhatsApp config upserted');
    return this.mapToDto(record);
  }

  /** Delete config (disconnect) */
  async deleteConfig(tenantId: string): Promise<void> {
    await prisma.whatsAppConfig.deleteMany({
      where: { tenantId },
    });
    logger.info({ tenantId }, 'WhatsApp config deleted');
  }

  /** Test connection by calling Meta Cloud API */
  async testConnection(tenantId: string): Promise<WhatsAppTestConnectionDto> {
    const decrypted = await this.getDecryptedConfig(tenantId);
    if (!decrypted) {
      throw new AppError(404, 'NOT_FOUND', 'WhatsApp config not found');
    }

    const config = getConfig();
    const url = `${config.whatsapp.apiBaseUrl}/${decrypted.phoneNumberId}?fields=verified_name,quality_rating,messaging_limit_tier&access_token=${decrypted.accessToken}`;

    try {
      const response = await fetch(url);
      const data = await response.json() as Record<string, unknown>;

      if (!response.ok) {
        const errorMsg = (data as { error?: { message?: string } }).error?.message || 'Unknown Meta API error';
        await this.updateStatus(tenantId, 'ERROR', errorMsg);
        return {
          success: false,
          message: errorMsg,
        };
      }

      await this.updateStatus(tenantId, 'CONNECTED', null);

      return {
        success: true,
        phoneNumber: data.verified_name as string | undefined,
        qualityRating: data.quality_rating as string | undefined,
        messagingLimit: data.messaging_limit_tier as string | undefined,
        message: 'Connection successful',
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Connection failed';
      await this.updateStatus(tenantId, 'ERROR', msg);
      logger.error({ tenantId, error }, 'WhatsApp test connection failed');
      return {
        success: false,
        message: msg,
      };
    }
  }

  /** Get decrypted config (internal use for sending messages / webhook verification) */
  async getDecryptedConfig(tenantId: string): Promise<DecryptedWhatsAppConfig | null> {
    const record = await prisma.whatsAppConfig.findUnique({
      where: { tenantId },
    });

    if (!record) return null;

    return {
      tenantId: record.tenantId,
      phoneNumberId: record.phoneNumberId,
      wabaId: record.wabaId,
      accessToken: decrypt(record.accessTokenEncrypted),
      appSecret: decrypt(record.appSecretEncrypted),
      webhookVerifyToken: record.webhookVerifyToken,
    };
  }

  /** Mark config as verified (after webhook verification succeeds) */
  async markVerified(tenantId: string): Promise<void> {
    await prisma.whatsAppConfig.updateMany({
      where: { tenantId, connectionStatus: { not: 'CONNECTED' } },
      data: {
        connectionStatus: 'CONNECTED',
        statusMessage: null,
        lastVerifiedAt: new Date(),
      },
    });
  }

  /** Update connection status */
  private async updateStatus(
    tenantId: string,
    status: 'DISCONNECTED' | 'PENDING' | 'CONNECTED' | 'ERROR',
    message: string | null
  ): Promise<void> {
    await prisma.whatsAppConfig.updateMany({
      where: { tenantId },
      data: {
        connectionStatus: status,
        statusMessage: message,
        ...(status === 'CONNECTED' ? { lastVerifiedAt: new Date() } : {}),
      },
    });
  }

  /** Map DB record to masked DTO */
  private mapToDto(record: {
    id: string;
    tenantId: string;
    phoneNumberId: string;
    wabaId: string;
    accessTokenEncrypted: string;
    appSecretEncrypted: string;
    webhookVerifyToken: string;
    connectionStatus: string;
    statusMessage: string | null;
    lastVerifiedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): WhatsAppConfigDto {
    const config = getConfig();
    const webhookUrl = `${config.whatsapp.appBaseUrl}${config.server.apiPrefix}/whatsapp/webhook/${record.tenantId}`;

    let accessTokenMasked = '****';
    let appSecretMasked = '****';
    try {
      accessTokenMasked = maskSecret(decrypt(record.accessTokenEncrypted));
    } catch { /* leave masked */ }
    try {
      appSecretMasked = maskSecret(decrypt(record.appSecretEncrypted));
    } catch { /* leave masked */ }

    return {
      id: record.id,
      tenantId: record.tenantId,
      phoneNumberId: record.phoneNumberId,
      wabaId: record.wabaId,
      accessTokenMasked,
      appSecretMasked,
      webhookVerifyToken: record.webhookVerifyToken,
      webhookUrl,
      connectionStatus: record.connectionStatus as WhatsAppConfigDto['connectionStatus'],
      statusMessage: record.statusMessage,
      lastVerifiedAt: record.lastVerifiedAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}

export const whatsappConfigService = new WhatsAppConfigService();
