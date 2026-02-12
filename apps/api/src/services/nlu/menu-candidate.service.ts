import * as stringSimilarity from 'string-similarity';
import prisma from '../../db/prisma';
import { cacheService } from '../cache.service';
import { MenuCandidateDto, CanonicalMenuExport } from '@whatres/shared';
import { createLogger } from '../../logger';

const logger = createLogger();

// Configuration
const TOP_N_CANDIDATES = 10;
const MIN_SIMILARITY_SCORE = 0.3;

/**
 * Interface for future embedding-based search
 */
export interface EmbeddingProvider {
  getEmbedding(text: string): Promise<number[]>;
  searchSimilar(
    tenantId: string,
    embedding: number[],
    topK: number
  ): Promise<{ itemId: string; score: number }[]>;
}

export class MenuCandidateService {
  // Optional embedding provider for future use
  private embeddingProvider: EmbeddingProvider | null = null;

  setEmbeddingProvider(provider: EmbeddingProvider): void {
    this.embeddingProvider = provider;
  }

  /**
   * Find top-N menu item candidates based on user text
   * Uses synonyms + fuzzy string matching
   */
  async findCandidates(
    tenantId: string,
    userText: string
  ): Promise<MenuCandidateDto[]> {
    const startTime = Date.now();

    // Get published menu
    const menu = await this.getPublishedMenu(tenantId);
    if (!menu) {
      logger.warn({ tenantId }, 'No published menu found for tenant');
      return [];
    }

    // Normalize user text
    const normalizedText = this.normalizeText(userText);
    const userWords = normalizedText.split(/\s+/).filter((w) => w.length > 1);

    // Score each menu item
    const candidates: MenuCandidateDto[] = [];

    for (const category of menu.categories) {
      for (const item of category.items) {
        if (!item.isActive) continue;

        const score = this.scoreItem(
          item,
          menu.synonyms,
          normalizedText,
          userWords
        );

        if (score.totalScore >= MIN_SIMILARITY_SCORE) {
          candidates.push({
            menuItemId: item.id,
            name: item.name,
            category: category.name,
            basePrice: item.basePrice,
            synonymsMatched: score.matchedSynonyms,
            score: score.totalScore,
          });
        }
      }
    }

    // Sort by score and take top N
    candidates.sort((a, b) => b.score - a.score);
    const topCandidates = candidates.slice(0, TOP_N_CANDIDATES);

    logger.info(
      {
        tenantId,
        userText: userText.substring(0, 50),
        candidatesFound: topCandidates.length,
        durationMs: Date.now() - startTime,
      },
      'Menu candidates search completed'
    );

    return topCandidates;
  }

  /**
   * Score a menu item against user text
   */
  private scoreItem(
    item: { id: string; name: string; description: string | null },
    synonyms: Array<{
      phrase: string;
      mapsTo: { type: 'item' | 'option'; id: string; name: string };
      weight: number;
    }>,
    normalizedText: string,
    userWords: string[]
  ): { totalScore: number; matchedSynonyms: string[] } {
    let totalScore = 0;
    const matchedSynonyms: string[] = [];

    // 1. Direct name match (highest priority)
    const normalizedName = this.normalizeText(item.name);
    const nameSimilarity = stringSimilarity.compareTwoStrings(
      normalizedText,
      normalizedName
    );
    totalScore += nameSimilarity * 0.4;

    // Check if name words appear in user text
    const nameWords = normalizedName.split(/\s+/);
    const nameWordMatches = nameWords.filter((nw) =>
      userWords.some(
        (uw) => stringSimilarity.compareTwoStrings(uw, nw) > 0.7
      )
    );
    totalScore += (nameWordMatches.length / nameWords.length) * 0.3;

    // 2. Synonym matching
    const itemSynonyms = synonyms.filter(
      (s) => s.mapsTo.type === 'item' && s.mapsTo.id === item.id
    );

    for (const synonym of itemSynonyms) {
      const normalizedPhrase = this.normalizeText(synonym.phrase);
      
      // Check if phrase appears in text
      if (normalizedText.includes(normalizedPhrase)) {
        totalScore += 0.5 * synonym.weight;
        matchedSynonyms.push(synonym.phrase);
      } else {
        // Fuzzy match on phrase
        const phraseSimilarity = stringSimilarity.compareTwoStrings(
          normalizedText,
          normalizedPhrase
        );
        if (phraseSimilarity > 0.6) {
          totalScore += phraseSimilarity * 0.3 * synonym.weight;
          matchedSynonyms.push(synonym.phrase);
        }
      }
    }

    // 3. Description match (lower priority)
    if (item.description) {
      const normalizedDesc = this.normalizeText(item.description);
      const descWords = normalizedDesc.split(/\s+/).slice(0, 10);
      const descMatches = descWords.filter((dw) =>
        userWords.some(
          (uw) => stringSimilarity.compareTwoStrings(uw, dw) > 0.7
        )
      );
      if (descMatches.length > 0) {
        totalScore += (descMatches.length / descWords.length) * 0.1;
      }
    }

    // Normalize score to 0-1 range
    totalScore = Math.min(1, totalScore);

    return { totalScore, matchedSynonyms };
  }

  /**
   * Normalize text for comparison
   */
  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
      .replace(/[^a-z0-9\s]/g, ' ') // Remove special chars
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Get published menu (from cache or DB)
   */
  private async getPublishedMenu(
    tenantId: string
  ): Promise<CanonicalMenuExport | null> {
    // Try cache first
    const cached = await cacheService.getPublishedMenu(tenantId);
    if (cached) {
      return cached;
    }

    // Fallback to building from DB
    const latestPublished = await prisma.menuVersion.findFirst({
      where: { tenantId, publishedAt: { not: null } },
      orderBy: { publishedAt: 'desc' },
    });

    if (!latestPublished) {
      return null;
    }

    // Build menu export (simplified version)
    const items = await prisma.menuItem.findMany({
      where: { tenantId, versionId: latestPublished.id },
      include: {
        optionGroups: {
          include: {
            group: {
              include: { options: true },
            },
          },
        },
      },
    });

    const synonyms = await prisma.menuSynonym.findMany({
      where: { tenantId, versionId: latestPublished.id },
      include: { item: true, option: true },
    });

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) return null;

    // Group items by category
    const categoryMap = new Map<
      string,
      {
        name: string;
        items: Array<{
          id: string;
          name: string;
          description: string | null;
          basePrice: number;
          isActive: boolean;
          optionGroupIds: string[];
        }>;
      }
    >();

    for (const item of items) {
      if (!categoryMap.has(item.category)) {
        categoryMap.set(item.category, { name: item.category, items: [] });
      }
      categoryMap.get(item.category)!.items.push({
        id: item.id,
        name: item.name,
        description: item.description,
        basePrice: Number(item.basePrice),
        isActive: item.isActive,
        optionGroupIds: item.optionGroups.map((og) => og.groupId),
      });
    }

    const menu: CanonicalMenuExport = {
      version: latestPublished.version,
      exportedAt: new Date().toISOString(),
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
      },
      categories: Array.from(categoryMap.values()),
      optionGroups: [],
      synonyms: synonyms
        .filter((s) => s.item || s.option)
        .map((s) => ({
          phrase: s.phrase,
          mapsTo: {
            type: s.mapsToItemId ? ('item' as const) : ('option' as const),
            id: (s.mapsToItemId || s.mapsToOptionId)!,
            name: (s.item?.name || s.option?.name)!,
          },
          weight: s.weight,
        })),
    };

    // Cache for future use
    await cacheService.setPublishedMenu(tenantId, menu);

    return menu;
  }

  /**
   * Get option groups for candidate items
   */
  async getOptionGroupsForItems(
    tenantId: string,
    menuItemIds: string[]
  ): Promise<
    Map<
      string,
      Array<{
        id: string;
        name: string;
        type: 'SINGLE' | 'MULTI';
        required: boolean;
        options: Array<{
          id: string;
          name: string;
          priceDelta: number;
          isDefault: boolean;
        }>;
      }>
    >
  > {
    const result = new Map();

    // Get all items with their option groups
    const items = await prisma.menuItem.findMany({
      where: { id: { in: menuItemIds }, tenantId },
      include: {
        optionGroups: {
          include: {
            group: {
              include: {
                options: {
                  where: { isActive: true },
                  orderBy: { sortOrder: 'asc' },
                },
              },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    for (const item of items) {
      const groups = item.optionGroups.map((og) => ({
        id: og.group.id,
        name: og.group.name,
        type: og.group.type as 'SINGLE' | 'MULTI',
        required: og.group.required,
        options: og.group.options.map((opt) => ({
          id: opt.id,
          name: opt.name,
          priceDelta: Number(opt.priceDelta),
          isDefault: opt.isDefault,
        })),
      }));
      result.set(item.id, groups);
    }

    return result;
  }
}

export const menuCandidateService = new MenuCandidateService();


