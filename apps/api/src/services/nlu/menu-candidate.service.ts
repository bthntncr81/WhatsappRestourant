import * as stringSimilarity from 'string-similarity';
import prisma from '../../db/prisma';
import { cacheService } from '../cache.service';
import { MenuCandidateDto, CanonicalMenuExport } from '@whatres/shared';
import { createLogger } from '../../logger';

const logger = createLogger();

// Configuration
const TOP_N_CANDIDATES = 10;
const MIN_SIMILARITY_SCORE = 0.15;

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

    // Check if user mentions a category name (e.g. "içecek", "tatlı", "burger")
    const matchedCategoryNames = new Set<string>();
    for (const category of menu.categories) {
      const normalizedCategory = this.normalizeText(category.name);
      // Check singular/plural/stem forms of category
      const categoryStems = this.getCategoryStems(normalizedCategory);
      for (const stem of categoryStems) {
        if (stem.length >= 3 && userWords.some((uw) => uw === stem || uw.includes(stem) || stem.includes(uw))) {
          matchedCategoryNames.add(category.name);
        }
      }
    }

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

        // Boost score if item belongs to a matched category
        if (matchedCategoryNames.has(category.name)) {
          score.totalScore = Math.max(score.totalScore, 0.3);
        }

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

    const normalizedName = this.normalizeText(item.name);
    const nameWords = normalizedName.split(/\s+/).filter((w) => w.length > 1);

    // 1. Exact containment check (highest priority)
    // If the full normalized name appears in user text, strong match
    if (normalizedText.includes(normalizedName)) {
      totalScore += 0.8;
    } else {
      // Check if any significant name word appears exactly in user text
      const exactWordMatches = nameWords.filter((nw) =>
        nw.length >= 3 && userWords.some((uw) => uw === nw)
      );
      if (exactWordMatches.length > 0) {
        // Strong bonus for exact word containment (e.g. "doner" in "bir doner istiyorum")
        totalScore += 0.5 * (exactWordMatches.length / nameWords.length);
      }

      // Fuzzy word matching for close matches (e.g. typos)
      const fuzzyWordMatches = nameWords.filter((nw) =>
        nw.length >= 3 && userWords.some(
          (uw) => uw !== nw && stringSimilarity.compareTwoStrings(uw, nw) > 0.7
        )
      );
      if (fuzzyWordMatches.length > 0) {
        totalScore += 0.3 * (fuzzyWordMatches.length / nameWords.length);
      }
    }

    // 2. Full-text similarity (lower weight - helps when text is short)
    const nameSimilarity = stringSimilarity.compareTwoStrings(
      normalizedText,
      normalizedName
    );
    totalScore += nameSimilarity * 0.2;

    // 3. Synonym matching
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
        // Check individual synonym words
        const synWords = normalizedPhrase.split(/\s+/).filter((w) => w.length >= 3);
        const synExactMatches = synWords.filter((sw) => userWords.some((uw) => uw === sw));
        if (synExactMatches.length > 0) {
          totalScore += 0.4 * synonym.weight * (synExactMatches.length / synWords.length);
          matchedSynonyms.push(synonym.phrase);
        } else {
          const phraseSimilarity = stringSimilarity.compareTwoStrings(
            normalizedText,
            normalizedPhrase
          );
          if (phraseSimilarity > 0.5) {
            totalScore += phraseSimilarity * 0.3 * synonym.weight;
            matchedSynonyms.push(synonym.phrase);
          }
        }
      }
    }

    // 4. Description match (lowest priority)
    if (item.description) {
      const normalizedDesc = this.normalizeText(item.description);
      const descWords = normalizedDesc.split(/\s+/).filter((w) => w.length >= 3).slice(0, 10);
      const descMatches = descWords.filter((dw) =>
        userWords.some((uw) => uw === dw || stringSimilarity.compareTwoStrings(uw, dw) > 0.7)
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
   * Get stem variations for category matching (Turkish plural/suffix removal)
   * e.g. "icecekler" → ["icecekler", "icecek"], "tatlilar" → ["tatlilar", "tatli"]
   */
  private getCategoryStems(normalizedCategory: string): string[] {
    const stems = [normalizedCategory];
    // Turkish plural suffix removal: -ler, -lar
    if (normalizedCategory.endsWith('ler') || normalizedCategory.endsWith('lar')) {
      stems.push(normalizedCategory.slice(0, -3));
    }
    // Also try removing -lar/-ler + last vowel harmony suffix
    if (normalizedCategory.endsWith('leri') || normalizedCategory.endsWith('lari')) {
      stems.push(normalizedCategory.slice(0, -4));
    }
    return stems;
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


