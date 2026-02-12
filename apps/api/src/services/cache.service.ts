import redis from '../db/redis';
import { CanonicalMenuExport } from '@whatres/shared';

const MENU_CACHE_TTL = 60 * 60 * 24; // 24 hours

export class CacheService {
  private getMenuKey(tenantId: string): string {
    return `tenant:${tenantId}:menu:published`;
  }

  async getPublishedMenu(tenantId: string): Promise<CanonicalMenuExport | null> {
    try {
      const cached = await redis.get(this.getMenuKey(tenantId));
      if (cached) {
        return JSON.parse(cached);
      }
      return null;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  async setPublishedMenu(tenantId: string, menu: CanonicalMenuExport): Promise<void> {
    try {
      await redis.setex(
        this.getMenuKey(tenantId),
        MENU_CACHE_TTL,
        JSON.stringify(menu)
      );
    } catch (error) {
      console.error('Cache set error:', error);
    }
  }

  async invalidateMenu(tenantId: string): Promise<void> {
    try {
      await redis.del(this.getMenuKey(tenantId));
    } catch (error) {
      console.error('Cache invalidate error:', error);
    }
  }

  async isConnected(): Promise<boolean> {
    try {
      await redis.ping();
      return true;
    } catch {
      return false;
    }
  }
}

export const cacheService = new CacheService();


