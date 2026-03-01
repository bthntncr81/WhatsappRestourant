import prisma from '../../db/prisma';
import { createLogger } from '../../logger';

const logger = createLogger();

/**
 * Customer preference data stored in preferencesJson
 */
export interface CustomerPreferences {
  favoriteItems: Array<{
    menuItemId: string;
    name: string;
    count: number;
  }>;
  dislikedIngredients: string[];
  preferredOptions: Record<string, string>; // groupName → optionName
  lastNotes: string[]; // Recent order notes
}

const EMPTY_PREFERENCES: CustomerPreferences = {
  favoriteItems: [],
  dislikedIngredients: [],
  preferredOptions: {},
  lastNotes: [],
};

export class PreferencesService {
  /**
   * Get customer preferences for LLM context
   */
  async getPreferences(
    tenantId: string,
    customerPhone: string
  ): Promise<CustomerPreferences | null> {
    try {
      const profile = await prisma.customerProfile.findUnique({
        where: {
          tenantId_customerPhone: { tenantId, customerPhone },
        },
        select: { preferencesJson: true },
      });

      if (!profile?.preferencesJson) return null;
      return profile.preferencesJson as unknown as CustomerPreferences;
    } catch (error) {
      logger.error({ error, tenantId, customerPhone }, 'Failed to get preferences');
      return null;
    }
  }

  /**
   * Learn preferences from a delivered order
   * Called after order status changes to DELIVERED/CONFIRMED
   */
  async learnFromOrder(
    tenantId: string,
    customerPhone: string,
    orderItems: Array<{
      menuItemId: string;
      menuItemName: string;
      qty: number;
      optionsJson: any;
      notes: string | null;
    }>,
    orderNotes: string | null
  ): Promise<void> {
    try {
      // Get or create profile
      const profile = await prisma.customerProfile.findUnique({
        where: {
          tenantId_customerPhone: { tenantId, customerPhone },
        },
      });

      if (!profile) return; // Profile should exist from broadcast sync

      const prefs: CustomerPreferences =
        (profile.preferencesJson as unknown as CustomerPreferences) ||
        { ...EMPTY_PREFERENCES };

      // Update favorite items
      for (const item of orderItems) {
        const existing = prefs.favoriteItems.find(
          (f) => f.menuItemId === item.menuItemId
        );
        if (existing) {
          existing.count += item.qty;
          existing.name = item.menuItemName; // Keep name fresh
        } else {
          prefs.favoriteItems.push({
            menuItemId: item.menuItemId,
            name: item.menuItemName,
            count: item.qty,
          });
        }
      }

      // Sort favorites by count (descending), keep top 20
      prefs.favoriteItems.sort((a, b) => b.count - a.count);
      prefs.favoriteItems = prefs.favoriteItems.slice(0, 20);

      // Learn preferred options (most recent wins)
      for (const item of orderItems) {
        if (item.optionsJson && Array.isArray(item.optionsJson)) {
          for (const opt of item.optionsJson) {
            if (opt.groupName && opt.optionName) {
              prefs.preferredOptions[opt.groupName] = opt.optionName;
            }
          }
        }
      }

      // Learn disliked ingredients from notes
      for (const item of orderItems) {
        if (item.notes) {
          const disliked = this.extractDislikedIngredients(item.notes);
          for (const ingredient of disliked) {
            if (!prefs.dislikedIngredients.includes(ingredient)) {
              prefs.dislikedIngredients.push(ingredient);
            }
          }
        }
      }
      // Keep max 15 disliked ingredients
      prefs.dislikedIngredients = prefs.dislikedIngredients.slice(0, 15);

      // Store recent order notes
      if (orderNotes) {
        prefs.lastNotes = [orderNotes, ...prefs.lastNotes].slice(0, 5);
      }

      // Save to DB
      await prisma.customerProfile.update({
        where: {
          tenantId_customerPhone: { tenantId, customerPhone },
        },
        data: {
          preferencesJson: prefs as any,
        },
      });

      logger.debug(
        {
          tenantId,
          customerPhone: customerPhone.slice(-4),
          favoriteCount: prefs.favoriteItems.length,
        },
        'Customer preferences updated'
      );
    } catch (error) {
      logger.error({ error, tenantId }, 'Failed to learn preferences');
    }
  }

  /**
   * Build LLM prompt context from customer preferences
   * Returns a string to append to the system prompt
   */
  buildPreferencesPrompt(prefs: CustomerPreferences): string {
    const parts: string[] = [];

    if (prefs.favoriteItems.length > 0) {
      const top5 = prefs.favoriteItems.slice(0, 5);
      parts.push(
        'MUSTERI FAVORILERI: ' +
          top5.map((f) => `${f.name} (${f.count}x siparis)`).join(', ')
      );
    }

    if (prefs.dislikedIngredients.length > 0) {
      parts.push(
        'ISTEMEDIGI MALZEMELER: ' + prefs.dislikedIngredients.join(', ')
      );
    }

    if (Object.keys(prefs.preferredOptions).length > 0) {
      const optParts = Object.entries(prefs.preferredOptions)
        .slice(0, 5)
        .map(([group, option]) => `${group}: ${option}`);
      parts.push('TERCIH ETTIGI OPSIYONLAR: ' + optParts.join(', '));
    }

    if (parts.length === 0) return '';
    return '\n\nMUSTERI TERCIHLERI (onceki siparislerden ogrenilmis):\n' + parts.join('\n');
  }

  /**
   * Extract disliked ingredients from order notes
   * Patterns: "sogansiz", "aci olmadan", "sossuz", etc.
   */
  private extractDislikedIngredients(notes: string): string[] {
    const ingredients: string[] = [];
    const lower = notes.toLowerCase();

    // Pattern: "X olmadan"
    const olmadanMatch = lower.match(/(\w+)\s+olmadan/g);
    if (olmadanMatch) {
      for (const m of olmadanMatch) {
        ingredients.push(m.replace(/\s+olmadan/, '').trim());
      }
    }

    // Pattern: "Xsiz/suz/sız/süz"
    const sizMatch = lower.match(/(\w+)(siz|suz|sız|süz)\b/g);
    if (sizMatch) {
      for (const m of sizMatch) {
        const base = m.replace(/(siz|suz|sız|süz)$/, '').trim();
        if (base.length >= 2) {
          ingredients.push(base);
        }
      }
    }

    return ingredients;
  }
}

export const preferencesService = new PreferencesService();
