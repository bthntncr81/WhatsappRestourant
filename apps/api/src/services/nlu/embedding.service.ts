import OpenAI from 'openai';
import { getConfig } from '@whatres/config';
import redis from '../../db/redis';
import { createLogger } from '../../logger';
import { CanonicalMenuExport } from '@whatres/shared';
import { EmbeddingProvider } from './menu-candidate.service';

const logger = createLogger();

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 512; // Reduced dimensions for efficiency
const EMBEDDING_CACHE_TTL = 24 * 60 * 60; // 24 hours

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

/**
 * Redis key for menu item embeddings
 */
function embeddingKey(tenantId: string, itemId: string): string {
  return `tenant:${tenantId}:embedding:${itemId}`;
}

/**
 * Redis key for the embedding index (list of all item IDs with embeddings)
 */
function embeddingIndexKey(tenantId: string): string {
  return `tenant:${tenantId}:embedding:index`;
}

export class EmbeddingService implements EmbeddingProvider {
  private client: OpenAI | null = null;
  private config = getConfig();

  constructor() {
    if (this.config.openai.apiKey) {
      this.client = new OpenAI({ apiKey: this.config.openai.apiKey });
    }
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  /**
   * Get embedding for a text string
   */
  async getEmbedding(text: string): Promise<number[]> {
    if (!this.client) throw new Error('OpenAI client not configured');

    const response = await this.client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
      dimensions: EMBEDDING_DIMENSIONS,
    });

    return response.data[0].embedding;
  }

  /**
   * Build/refresh embedding index for a tenant's menu
   * Called when menu is published or cache is invalidated
   */
  async buildIndex(tenantId: string, menu: CanonicalMenuExport): Promise<void> {
    if (!this.client) return;

    const startTime = Date.now();
    const texts: string[] = [];
    const itemIds: string[] = [];

    for (const category of menu.categories) {
      for (const item of category.items) {
        if (!item.isActive) continue;
        // Build rich text for embedding: name + category + description
        let text = `${item.name} ${category.name}`;
        if (item.description) {
          text += ` ${item.description}`;
        }
        texts.push(text);
        itemIds.push(item.id);
      }
    }

    if (texts.length === 0) return;

    try {
      // Batch embedding request (OpenAI supports up to 2048 inputs)
      const response = await this.client.embeddings.create({
        model: EMBEDDING_MODEL,
        input: texts,
        dimensions: EMBEDDING_DIMENSIONS,
      });

      // Store embeddings in Redis
      const pipeline = redis.pipeline();

      for (let i = 0; i < response.data.length; i++) {
        const key = embeddingKey(tenantId, itemIds[i]);
        pipeline.setex(
          key,
          EMBEDDING_CACHE_TTL,
          JSON.stringify(response.data[i].embedding)
        );
      }

      // Store index of all item IDs
      const indexKey = embeddingIndexKey(tenantId);
      pipeline.del(indexKey);
      pipeline.setex(indexKey, EMBEDDING_CACHE_TTL, JSON.stringify(itemIds));

      await pipeline.exec();

      logger.info(
        {
          tenantId,
          itemCount: itemIds.length,
          durationMs: Date.now() - startTime,
        },
        'Embedding index built'
      );
    } catch (error) {
      logger.error({ error, tenantId }, 'Failed to build embedding index');
    }
  }

  /**
   * Search for similar menu items using embedding similarity
   */
  async searchSimilar(
    tenantId: string,
    queryEmbedding: number[],
    topK: number
  ): Promise<{ itemId: string; score: number }[]> {
    try {
      // Get index of all item IDs
      const indexRaw = await redis.get(embeddingIndexKey(tenantId));
      if (!indexRaw) return [];

      const itemIds: string[] = JSON.parse(indexRaw);
      if (itemIds.length === 0) return [];

      // Fetch all embeddings from Redis
      const keys = itemIds.map((id) => embeddingKey(tenantId, id));
      const embeddings = await redis.mget(...keys);

      // Compute similarities
      const results: { itemId: string; score: number }[] = [];

      for (let i = 0; i < itemIds.length; i++) {
        if (!embeddings[i]) continue;
        const itemEmbedding: number[] = JSON.parse(embeddings[i]!);
        const score = cosineSimilarity(queryEmbedding, itemEmbedding);
        results.push({ itemId: itemIds[i], score });
      }

      // Sort by score and return top K
      results.sort((a, b) => b.score - a.score);
      return results.slice(0, topK);
    } catch (error) {
      logger.error({ error, tenantId }, 'Embedding search failed');
      return [];
    }
  }

  /**
   * Invalidate embedding index for a tenant
   */
  async invalidateIndex(tenantId: string): Promise<void> {
    try {
      const indexRaw = await redis.get(embeddingIndexKey(tenantId));
      if (indexRaw) {
        const itemIds: string[] = JSON.parse(indexRaw);
        const keys = [
          embeddingIndexKey(tenantId),
          ...itemIds.map((id) => embeddingKey(tenantId, id)),
        ];
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      }
    } catch (error) {
      logger.error({ error, tenantId }, 'Failed to invalidate embedding index');
    }
  }
}

export const embeddingService = new EmbeddingService();
