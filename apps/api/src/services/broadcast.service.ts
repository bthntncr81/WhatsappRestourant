import OpenAI from 'openai';
import { getConfig } from '@whatres/config';
import prisma from '../db/prisma';
import { createLogger } from '../logger';
import { whatsappProviderService } from './whatsapp-provider.service';
import { whatsappConfigService } from './whatsapp-config.service';

const logger = createLogger();

const CAMPAIGN_SYSTEM_PROMPT = `Sen bir restoran pazarlama asistanisin. Musteriye kisisel kampanya mesaji yazacaksin.
Kurallar:
- Samimi, sicak, arkadasca tonda yaz
- Turkce, kisa (max 3 cumle)
- Emoji kullan ama abartma (max 2)
- Musterinin adini kullan (varsa)
- Daha once siparis ettigi urunleri dogal sekilde referans ver
- Indirim bilgisini dogal sekilde ver
- Baskici olma, davet et
- Sadece mesaj metnini yaz, baska bir sey ekleme

Ornekler:
- "Ahmet bey, bi suredir gelmiyorsunuz! Doner + ayran kombonuz %15 indirimle sizi bekliyor 🥙"
- "Kebap ozleminiz varsa tam zamani! Bu hafta %10 indirimle 😋"
- "Merhaba! En sevdiginiz sutlac bugun %20 indirimde, bir tane ayirtalim mi? 🍮"`;

export class BroadcastService {
  private client: OpenAI | null = null;
  private config = getConfig();

  constructor() {
    if (this.config.openai.apiKey) {
      this.client = new OpenAI({ apiKey: this.config.openai.apiKey });
    }
  }

  // ==================== SETTINGS ====================

  async getSettings(tenantId: string) {
    let settings = await prisma.broadcastSettings.findUnique({
      where: { tenantId },
    });
    if (!settings) {
      settings = await prisma.broadcastSettings.create({
        data: { tenantId },
      });
    }
    return settings;
  }

  async updateSettings(tenantId: string, dto: {
    isEnabled?: boolean;
    maxDiscountPct?: number;
    minDaysBetweenSends?: number;
    dailySendLimit?: number;
    activeThresholdDays?: number;
    sleepingThresholdDays?: number;
  }) {
    return prisma.broadcastSettings.upsert({
      where: { tenantId },
      update: dto,
      create: { tenantId, ...dto },
    });
  }

  // ==================== CUSTOMER PROFILE MANAGEMENT ====================

  async syncCustomerProfiles(tenantId: string): Promise<{ created: number; updated: number }> {
    const settings = await this.getSettings(tenantId);
    let created = 0;
    let updated = 0;

    // Get all unique customers from conversations
    const conversations = await prisma.conversation.findMany({
      where: { tenantId },
      select: { customerPhone: true, customerName: true },
    });

    for (const conv of conversations) {
      // Get order stats for this customer
      const orders = await prisma.order.findMany({
        where: {
          tenantId,
          customerPhone: conv.customerPhone,
          status: { notIn: ['DRAFT', 'CANCELLED'] },
        },
        select: {
          totalPrice: true,
          createdAt: true,
          confirmedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      const orderCount = orders.length;
      if (orderCount === 0) continue;

      const totalSpent = orders.reduce((sum, o) => sum + Number(o.totalPrice), 0);
      const lastOrderAt = orders[0].createdAt;
      const avgOrderHour = this.calculateAvgOrderHour(orders.map(o => o.confirmedAt || o.createdAt));
      const segment = this.classifySegment(orderCount, lastOrderAt, settings);

      const existing = await prisma.customerProfile.findUnique({
        where: { tenantId_customerPhone: { tenantId, customerPhone: conv.customerPhone } },
      });

      if (existing) {
        await prisma.customerProfile.update({
          where: { id: existing.id },
          data: {
            customerName: conv.customerName || existing.customerName,
            segment,
            avgOrderHour,
            lastOrderAt,
            orderCount,
            totalSpent,
          },
        });
        updated++;
      } else {
        await prisma.customerProfile.create({
          data: {
            tenantId,
            customerPhone: conv.customerPhone,
            customerName: conv.customerName,
            segment,
            avgOrderHour,
            lastOrderAt,
            orderCount,
            totalSpent,
          },
        });
        created++;
      }
    }

    logger.info({ tenantId, created, updated }, 'Customer profiles synced');
    return { created, updated };
  }

  private calculateAvgOrderHour(dates: Date[]): number | null {
    if (dates.length === 0) return null;

    // Weight recent orders more (2x for last 30 days)
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    let weightedSum = 0;
    let totalWeight = 0;

    for (const date of dates) {
      // Convert to Turkey time (UTC+3)
      const turkeyHour = (date.getUTCHours() + 3) % 24;
      const weight = date > thirtyDaysAgo ? 2 : 1;
      weightedSum += turkeyHour * weight;
      totalWeight += weight;
    }

    return Math.round(weightedSum / totalWeight);
  }

  private classifySegment(
    orderCount: number,
    lastOrderAt: Date,
    settings: { activeThresholdDays: number; sleepingThresholdDays: number },
  ): 'ACTIVE' | 'SLEEPING' | 'NEW' {
    if (orderCount <= 1) return 'NEW';

    const now = new Date();
    const daysSinceLastOrder = Math.floor(
      (now.getTime() - lastOrderAt.getTime()) / (24 * 60 * 60 * 1000),
    );

    if (daysSinceLastOrder <= settings.activeThresholdDays) return 'ACTIVE';
    if (daysSinceLastOrder <= settings.sleepingThresholdDays) return 'SLEEPING';
    return 'SLEEPING'; // Beyond threshold still counts as sleeping
  }

  // ==================== OPT-IN MANAGEMENT ====================

  async askOptIn(
    tenantId: string,
    conversationId: string,
    customerPhone: string,
  ): Promise<boolean> {
    // Check if we should ask
    const profile = await prisma.customerProfile.findUnique({
      where: { tenantId_customerPhone: { tenantId, customerPhone } },
    });

    // Only ask if profile exists and is PENDING
    if (!profile || profile.broadcastOptIn !== 'PENDING') return false;

    // Check if we already asked recently (within 7 days)
    if (profile.optInAskedAt) {
      const daysSinceAsked = Math.floor(
        (Date.now() - profile.optInAskedAt.getTime()) / (24 * 60 * 60 * 1000),
      );
      if (daysSinceAsked < 7) return false;
    }

    // Update asked timestamp
    await prisma.customerProfile.update({
      where: { id: profile.id },
      data: { optInAskedAt: new Date() },
    });

    return true;
  }

  async handleOptInResponse(
    tenantId: string,
    customerPhone: string,
    optedIn: boolean,
  ): Promise<void> {
    await prisma.customerProfile.upsert({
      where: { tenantId_customerPhone: { tenantId, customerPhone } },
      update: {
        broadcastOptIn: optedIn ? 'OPTED_IN' : 'OPTED_OUT',
        optInChangedAt: new Date(),
      },
      create: {
        tenantId,
        customerPhone,
        broadcastOptIn: optedIn ? 'OPTED_IN' : 'OPTED_OUT',
        optInChangedAt: new Date(),
      },
    });

    logger.info({ tenantId, customerPhone, optedIn }, 'Broadcast opt-in response');
  }

  // ==================== CAMPAIGN CRUD ====================

  async getCampaigns(tenantId: string) {
    return prisma.campaign.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getCampaign(tenantId: string, campaignId: string) {
    return prisma.campaign.findFirst({
      where: { id: campaignId, tenantId },
    });
  }

  async createCampaign(tenantId: string, dto: {
    name: string;
    targetSegments: string[];
    maxDiscountPct: number;
    usePersonalTime: boolean;
    scheduledAt?: string;
  }) {
    const settings = await this.getSettings(tenantId);

    // Cap discount to tenant max
    const maxDiscount = Math.min(dto.maxDiscountPct, settings.maxDiscountPct);

    return prisma.campaign.create({
      data: {
        tenantId,
        name: dto.name,
        targetSegments: dto.targetSegments,
        maxDiscountPct: maxDiscount,
        usePersonalTime: dto.usePersonalTime,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        status: 'DRAFT',
      },
    });
  }

  async cancelCampaign(tenantId: string, campaignId: string) {
    return prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'CANCELLED' },
    });
  }

  // ==================== CAMPAIGN SCHEDULING ====================

  async scheduleCampaign(tenantId: string, campaignId: string): Promise<{ recipientCount: number }> {
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, tenantId },
    });
    if (!campaign || campaign.status !== 'DRAFT') {
      throw new Error('Campaign not found or not in DRAFT status');
    }

    const settings = await this.getSettings(tenantId);

    // Get eligible customers: matching segments + opted in
    const profiles = await prisma.customerProfile.findMany({
      where: {
        tenantId,
        broadcastOptIn: 'OPTED_IN',
        segment: { in: campaign.targetSegments as any[] },
      },
    });

    // Filter out customers who received a campaign recently
    const minDate = new Date(
      Date.now() - settings.minDaysBetweenSends * 24 * 60 * 60 * 1000,
    );

    const recentRecipients = await prisma.campaignSendLog.findMany({
      where: {
        tenantId,
        customerPhone: { in: profiles.map(p => p.customerPhone) },
        status: { in: ['SENT', 'DELIVERED', 'OPENED', 'CONVERTED'] },
        sentAt: { gte: minDate },
      },
      select: { customerPhone: true },
    });

    const recentPhones = new Set(recentRecipients.map(r => r.customerPhone));
    const eligibleProfiles = profiles.filter(p => !recentPhones.has(p.customerPhone));

    // Limit to daily send limit
    const limited = eligibleProfiles.slice(0, settings.dailySendLimit);

    // For each customer, get their favorite items and calculate send time
    const now = new Date();

    for (const profile of limited) {
      // Calculate personalized send time
      let scheduledSendAt: Date;
      if (campaign.usePersonalTime && profile.avgOrderHour != null) {
        // Schedule for customer's usual ordering hour (Turkey UTC+3)
        scheduledSendAt = new Date(now);
        const targetUTCHour = (profile.avgOrderHour - 3 + 24) % 24;
        scheduledSendAt.setUTCHours(targetUTCHour, 0, 0, 0);
        // If the time has passed today, schedule for tomorrow
        if (scheduledSendAt <= now) {
          scheduledSendAt.setDate(scheduledSendAt.getDate() + 1);
        }
      } else if (campaign.scheduledAt) {
        scheduledSendAt = campaign.scheduledAt;
      } else {
        // Default: send in 5 minutes
        scheduledSendAt = new Date(now.getTime() + 5 * 60 * 1000);
      }

      // Get customer's top 3 favorite items
      const topItems = await this.getCustomerTopItems(tenantId, profile.customerPhone, 3);

      // Calculate discount based on segment
      const discountPct = this.calculateDiscount(
        profile.segment as 'ACTIVE' | 'SLEEPING' | 'NEW',
        campaign.maxDiscountPct,
      );

      const suggestedItems = topItems.map(item => ({
        menuItemId: item.menuItemId,
        name: item.menuItemName,
        originalPrice: Number(item.unitPrice),
        discountedPrice: Number(item.unitPrice) * (1 - discountPct / 100),
      }));

      await prisma.campaignSendLog.create({
        data: {
          tenantId,
          campaignId,
          customerProfileId: profile.id,
          customerPhone: profile.customerPhone,
          status: 'PENDING_SEND',
          scheduledSendAt,
          discountPct,
          suggestedItems: suggestedItems.length > 0 ? suggestedItems : undefined,
        },
      });
    }

    // Update campaign
    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: 'SCHEDULED',
        totalRecipients: limited.length,
      },
    });

    logger.info(
      { tenantId, campaignId, recipientCount: limited.length },
      'Campaign scheduled',
    );

    return { recipientCount: limited.length };
  }

  private async getCustomerTopItems(
    tenantId: string,
    customerPhone: string,
    limit: number,
  ) {
    // Get most frequently ordered items
    const items = await prisma.orderItem.findMany({
      where: {
        order: {
          tenantId,
          customerPhone,
          status: { in: ['DELIVERED', 'CONFIRMED', 'PREPARING', 'READY'] },
        },
      },
      select: {
        menuItemId: true,
        menuItemName: true,
        unitPrice: true,
        qty: true,
      },
    });

    // Group and rank
    const grouped = new Map<string, { menuItemId: string; menuItemName: string; unitPrice: any; count: number }>();
    for (const item of items) {
      const existing = grouped.get(item.menuItemId);
      if (existing) {
        existing.count += item.qty;
      } else {
        grouped.set(item.menuItemId, {
          menuItemId: item.menuItemId,
          menuItemName: item.menuItemName,
          unitPrice: item.unitPrice,
          count: item.qty,
        });
      }
    }

    return Array.from(grouped.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  private calculateDiscount(
    segment: 'ACTIVE' | 'SLEEPING' | 'NEW',
    maxDiscountPct: number,
  ): number {
    let min: number, max: number;
    switch (segment) {
      case 'SLEEPING':
        min = Math.round(maxDiscountPct * 0.7);
        max = maxDiscountPct;
        break;
      case 'NEW':
        min = Math.round(maxDiscountPct * 0.5);
        max = Math.round(maxDiscountPct * 0.7);
        break;
      case 'ACTIVE':
      default:
        min = Math.round(maxDiscountPct * 0.3);
        max = Math.round(maxDiscountPct * 0.6);
        break;
    }
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // ==================== MESSAGE SENDING ====================

  async processPendingSends(): Promise<{ sent: number; failed: number; skipped: number }> {
    const now = new Date();
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    // Get pending sends that are due
    const pendingLogs = await prisma.campaignSendLog.findMany({
      where: {
        status: 'PENDING_SEND',
        scheduledSendAt: { lte: now },
      },
      include: {
        customerProfile: true,
        campaign: true,
      },
      take: 10, // Process 10 at a time (rate limit)
    });

    if (pendingLogs.length === 0) return { sent: 0, failed: 0, skipped: 0 };

    for (const log of pendingLogs) {
      // Skip if customer opted out
      if (log.customerProfile.broadcastOptIn !== 'OPTED_IN') {
        await prisma.campaignSendLog.update({
          where: { id: log.id },
          data: { status: 'SKIPPED', errorMessage: 'Customer opted out' },
        });
        skipped++;
        continue;
      }

      try {
        // Generate personalized message if not already generated
        let messageText = log.messageText;
        if (!messageText) {
          messageText = await this.generatePersonalizedMessage(
            log.customerProfile.customerName,
            log.suggestedItems as any[] || [],
            log.discountPct || 0,
            log.customerProfile.segment as 'ACTIVE' | 'SLEEPING' | 'NEW',
          );
        }

        // Send via WhatsApp
        const tenantConfig = await this.getTenantConfig(log.tenantId);
        if (!tenantConfig) {
          throw new Error('WhatsApp config not found');
        }

        const result = await whatsappProviderService.sendTextWithConfig(
          log.customerPhone,
          messageText,
          tenantConfig,
        );

        await prisma.campaignSendLog.update({
          where: { id: log.id },
          data: {
            status: 'SENT',
            sentAt: new Date(),
            messageText,
            externalMessageId: result.messageId,
          },
        });

        // Update campaign stats
        await prisma.campaign.update({
          where: { id: log.campaignId },
          data: { totalSent: { increment: 1 } },
        });

        sent++;

        // Rate limit: wait 100ms between sends
        await new Promise(r => setTimeout(r, 100));
      } catch (error: any) {
        await prisma.campaignSendLog.update({
          where: { id: log.id },
          data: {
            status: 'FAILED',
            errorMessage: error.message?.substring(0, 500) || 'Unknown error',
          },
        });
        failed++;
        logger.error({ error, logId: log.id }, 'Campaign send failed');
      }
    }

    // Check if any scheduled campaigns are fully sent
    const campaignIds = [...new Set(pendingLogs.map(l => l.campaignId))];
    for (const campaignId of campaignIds) {
      const remaining = await prisma.campaignSendLog.count({
        where: { campaignId, status: 'PENDING_SEND' },
      });
      if (remaining === 0) {
        await prisma.campaign.update({
          where: { id: campaignId },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
        logger.info({ campaignId }, 'Campaign completed');
      }
    }

    return { sent, failed, skipped };
  }

  private async generatePersonalizedMessage(
    customerName: string | null,
    suggestedItems: Array<{ name: string; originalPrice: number; discountedPrice: number }>,
    discountPct: number,
    segment: 'ACTIVE' | 'SLEEPING' | 'NEW',
  ): Promise<string> {
    if (!this.client || suggestedItems.length === 0) {
      return this.getFallbackMessage(customerName, suggestedItems, discountPct);
    }

    const itemList = suggestedItems.map(i =>
      `${i.name} (${i.originalPrice.toFixed(0)} TL → ${i.discountedPrice.toFixed(0)} TL)`,
    ).join(', ');

    const segmentHint = segment === 'SLEEPING'
      ? 'Musteri uzun suredir siparis vermiyor, onu geri kazanmak istiyoruz.'
      : segment === 'NEW'
        ? 'Musteri yeni, onu tekrar getirmek istiyoruz.'
        : 'Musteri aktif, ona ozel firsat sunuyoruz.';

    const userPrompt = `Musteri: ${customerName || 'Degerli musterimiz'}
Indirim: %${discountPct}
Urunler: ${itemList}
Not: ${segmentHint}
Samimi bir kampanya mesaji yaz.`;

    try {
      const response = await this.client.chat.completions.create({
        model: this.config.openai.model,
        messages: [
          { role: 'system', content: CAMPAIGN_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.8,
        max_completion_tokens: 150,
      });

      const text = response.choices[0]?.message?.content?.trim();
      if (text) return text;
    } catch (error) {
      logger.warn({ error }, 'AI campaign message generation failed, using fallback');
    }

    return this.getFallbackMessage(customerName, suggestedItems, discountPct);
  }

  private getFallbackMessage(
    customerName: string | null,
    suggestedItems: Array<{ name: string; originalPrice: number; discountedPrice: number }>,
    discountPct: number,
  ): string {
    const name = customerName || 'Degerli musterimiz';
    if (suggestedItems.length > 0) {
      const item = suggestedItems[0];
      return `${name}, ${item.name} simdi %${discountPct} indirimle sadece ${item.discountedPrice.toFixed(0)} TL! Siparis icin bir mesaj atin 😊`;
    }
    return `${name}, sizin icin ozel %${discountPct} indirim firsati! Siparis vermek icin yazin 🎉`;
  }

  // ==================== CONVERSION TRACKING ====================

  async trackConversion(tenantId: string, customerPhone: string): Promise<void> {
    if (!customerPhone) return;

    // Find recent campaign sends (within 72h)
    const threeDaysAgo = new Date(Date.now() - 72 * 60 * 60 * 1000);
    const logs = await prisma.campaignSendLog.findMany({
      where: {
        tenantId,
        customerPhone,
        status: { in: ['SENT', 'DELIVERED', 'OPENED'] },
        sentAt: { gte: threeDaysAgo },
      },
    });

    for (const log of logs) {
      await prisma.campaignSendLog.update({
        where: { id: log.id },
        data: { status: 'CONVERTED' },
      });
      await prisma.campaign.update({
        where: { id: log.campaignId },
        data: { totalConverted: { increment: 1 } },
      });
    }
  }

  async trackOpened(tenantId: string, customerPhone: string): Promise<void> {
    if (!customerPhone) return;

    // Find recent campaign sends (within 24h)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const logs = await prisma.campaignSendLog.findMany({
      where: {
        tenantId,
        customerPhone,
        status: 'SENT',
        sentAt: { gte: oneDayAgo },
      },
    });

    for (const log of logs) {
      await prisma.campaignSendLog.update({
        where: { id: log.id },
        data: { status: 'OPENED' },
      });
      await prisma.campaign.update({
        where: { id: log.campaignId },
        data: { totalOpened: { increment: 1 } },
      });
    }
  }

  // ==================== CAMPAIGN LOGS ====================

  async getCampaignLogs(tenantId: string, campaignId: string) {
    return prisma.campaignSendLog.findMany({
      where: { tenantId, campaignId },
      include: {
        customerProfile: {
          select: { customerName: true, segment: true },
        },
      },
      orderBy: { scheduledSendAt: 'asc' },
    });
  }

  // ==================== CUSTOMER PROFILES LIST ====================

  async getCustomerProfiles(tenantId: string, query?: {
    segment?: string;
    optIn?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: any = { tenantId };
    if (query?.segment) where.segment = query.segment;
    if (query?.optIn) where.broadcastOptIn = query.optIn;

    const [profiles, total] = await Promise.all([
      prisma.customerProfile.findMany({
        where,
        orderBy: { orderCount: 'desc' },
        take: query?.limit || 50,
        skip: query?.offset || 0,
      }),
      prisma.customerProfile.count({ where }),
    ]);

    return { profiles, total };
  }

  // ==================== STATS ====================

  async getStats(tenantId: string) {
    const [totalCustomers, optedIn, segments, campaignStats] = await Promise.all([
      prisma.customerProfile.count({ where: { tenantId } }),
      prisma.customerProfile.count({ where: { tenantId, broadcastOptIn: 'OPTED_IN' } }),
      prisma.customerProfile.groupBy({
        by: ['segment'],
        where: { tenantId },
        _count: true,
      }),
      prisma.campaign.aggregate({
        where: { tenantId },
        _sum: {
          totalSent: true,
          totalOpened: true,
          totalConverted: true,
        },
      }),
    ]);

    const segmentCounts: Record<string, number> = {};
    for (const s of segments) {
      segmentCounts[s.segment] = s._count;
    }

    return {
      totalCustomers,
      optedIn,
      segments: segmentCounts,
      totalSent: campaignStats._sum.totalSent || 0,
      totalOpened: campaignStats._sum.totalOpened || 0,
      totalConverted: campaignStats._sum.totalConverted || 0,
    };
  }

  // ==================== HELPERS ====================

  private async getTenantConfig(tenantId: string): Promise<{ phoneNumberId: string; accessToken: string } | null> {
    try {
      const config = await whatsappConfigService.getDecryptedConfig(tenantId);
      if (config?.phoneNumberId && config?.accessToken) {
        return { phoneNumberId: config.phoneNumberId, accessToken: config.accessToken };
      }
    } catch (error) {
      logger.warn({ error, tenantId }, 'Failed to get tenant WhatsApp config for broadcast');
    }
    return null;
  }
}

export const broadcastService = new BroadcastService();
