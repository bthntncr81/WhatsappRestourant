import { createLogger } from '../logger';

const logger = createLogger();

let cachedRate: { rate: number; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function getUsdToTryRate(): Promise<number> {
  // PRICING_CURRENCY=TRY: plan fiyatlari dogrudan TL kabul edilir (kur donusumu yok)
  if (process.env.PRICING_CURRENCY === 'TRY') return 1;
  if (cachedRate && Date.now() - cachedRate.fetchedAt < CACHE_TTL_MS) {
    return cachedRate.rate;
  }

  try {
    const res = await fetch(
      'https://api.exchangerate-data.com/latest?base=USD&symbols=TRY',
      { signal: AbortSignal.timeout(5000) },
    );

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { rates?: { TRY?: number } };
    const rate = data.rates?.TRY;

    if (!rate || rate < 1) throw new Error('Invalid rate');

    cachedRate = { rate, fetchedAt: Date.now() };
    logger.info({ rate }, 'USD/TRY rate fetched');
    return rate;
  } catch {
    // Fallback: try TCMB-compatible free API
    try {
      const res2 = await fetch(
        'https://open.er-api.com/v6/latest/USD',
        { signal: AbortSignal.timeout(5000) },
      );
      if (!res2.ok) throw new Error(`HTTP ${res2.status}`);
      const data2 = await res2.json() as { rates?: { TRY?: number } };
      const rate2 = data2.rates?.TRY;
      if (!rate2 || rate2 < 1) throw new Error('Invalid rate');

      cachedRate = { rate: rate2, fetchedAt: Date.now() };
      logger.info({ rate: rate2 }, 'USD/TRY rate fetched (fallback)');
      return rate2;
    } catch (e2) {
      logger.error({ error: e2 }, 'All USD/TRY rate sources failed, using hardcoded fallback');
      // Hardcoded fallback — updated periodically
      const FALLBACK_RATE = 38.5;
      return cachedRate?.rate || FALLBACK_RATE;
    }
  }
}

export function convertUsdToTry(usdAmount: number, rate: number): number {
  return Math.round(usdAmount * rate * 100) / 100;
}
