import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import prisma from '../db/prisma';
import { createLogger } from '../logger';
import { voiceSandboxService } from '../services/voice/voice-sandbox.service';
import {
  SANDBOX_TENANT_ID,
  SESSIONS_PER_IP_MAX,
  SESSIONS_PER_IP_WINDOW_MS,
} from '../services/voice/voice-sandbox.constants';
import { VOICE_DEMO_HTML } from '../services/voice/voice-demo.page';

/**
 * Sesli sipariş asistanı — PUBLIC router (auth yok, abonelik kapısı yok).
 *
 * Varsayılan mod izole sandbox'tır (SANDBOX_TENANT_ID). /session ayrıca
 * gövdede bir `tenant` slug'ı kabul eder; bu slug SUNUCUDAKİ env allowlist'ine
 * (VOICE_TENANT_SLUGS) karşı doğrulanır — listede olmayan her değer 404 alır.
 * Allowlist'teki bir slug o kiracının GERÇEK sipariş hattını açar (sipariş
 * POS'a düşer). /orders kanıt ucu her modda SANDBOX_TENANT_ID'ye sabittir.
 */
const router = Router();
const logger = createLogger();

const sessionRateLimiter = rateLimit({
  windowMs: SESSIONS_PER_IP_WINDOW_MS,
  max: SESSIONS_PER_IP_MAX,
  message: {
    success: false,
    error: { code: 'TOO_MANY_REQUESTS', message: 'Çok fazla demo denemesi. Lütfen biraz sonra tekrar deneyin.' },
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false, xForwardedForHeader: false },
});

const toolRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: {
    success: false,
    error: { code: 'TOO_MANY_REQUESTS', message: 'Çok fazla istek.' },
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false, xForwardedForHeader: false },
});

function hashIp(req: Request): string {
  const salt = process.env.JWT_SECRET || 'voice-demo';
  return crypto.createHash('sha256').update(`${req.ip || 'unknown'}|${salt}`).digest('hex').slice(0, 12);
}

// ==================== TEST SAYFASI ====================

router.get('/demo', (_req: Request, res: Response) => {
  res.type('html').send(VOICE_DEMO_HTML);
});

// ==================== OTURUM ====================

router.post('/session', sessionRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Konuşma sırası modu — demo sayfasındaki anahtardan gelir.
    // 'fast' (server_vad, 500 ms) varsayılan; 'smart' (semantic_vad) bölmez ama yavaştır.
    const mode = req.body?.mode === 'smart' ? 'smart' : 'fast';
    // Gerçek restoran modu: /demo?t=<slug> sayfası bu alanı doldurur.
    // Servis slug'ı env allowlist'ine (VOICE_TENANT_SLUGS) karşı doğrular;
    // listede olmayan her değer 404 alır — istemciden tenant KİMLİĞİ alınmaz.
    const tenantSlug =
      typeof req.body?.tenant === 'string' ? req.body.tenant.trim().toLowerCase() : '';
    const result = await voiceSandboxService.createSession(hashIp(req), mode, tenantSlug || undefined);
    // DİKKAT: burada dönen `clientSecret` OpenAI'ın KISA ÖMÜRLÜ ephemeral
    // anahtarıdır. OPENAI_API_KEY hiçbir koşulda istemciye gönderilmez.
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

/**
 * İstemci, OpenAI'ın SDP yanıtındaki Location başlığından okuduğu çağrı
 * kimliğini bildirir. Sunucu bunu süre dolduğunda çağrıyı kapatmak için
 * kullanır (maliyet freni). Bildirilmemesi demoyu bozmaz.
 */
router.post('/session/call', toolRateLimiter, (req: Request, res: Response) => {
  const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : '';
  const callId = typeof req.body?.callId === 'string' ? req.body.callId : '';
  if (!sessionId || !callId) {
    return res.status(400).json({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'sessionId ve callId zorunlu.' },
    });
  }
  const registered = voiceSandboxService.registerCall(sessionId, callId);
  res.json({ success: true, data: { registered } });
});

/**
 * Konuşma dökümü — sayfa, kesinleşen müşteri/Ada satırlarını toplu gönderir.
 * Ses tarayıcı ile OpenAI arasında aktığı için sunucu konuşmayı ancak buradan
 * görebilir; kayıtlar voice-logs/<gün>/<sessionId>.jsonl dosyalarına yazılır.
 */
router.post('/session/log', toolRateLimiter, (req: Request, res: Response) => {
  const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : '';
  const events = Array.isArray(req.body?.events) ? req.body.events : [];
  if (!sessionId || events.length === 0) {
    return res.status(400).json({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'sessionId ve events zorunlu.' },
    });
  }
  const yazilan = voiceSandboxService.appendClientLog(sessionId, events);
  res.json({ success: true, data: { yazilan } });
});

router.post('/session/end', (req: Request, res: Response) => {
  const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : '';
  if (sessionId) voiceSandboxService.endSession(sessionId);
  res.json({ success: true, data: { ended: true } });
});

// ==================== FONKSİYON KÖPRÜSÜ ====================

router.post('/tool', toolRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : '';
    const name = typeof req.body?.name === 'string' ? req.body.name : '';
    const args =
      req.body?.arguments && typeof req.body.arguments === 'object' && !Array.isArray(req.body.arguments)
        ? (req.body.arguments as Record<string, unknown>)
        : {};

    if (!sessionId || !name) {
      return res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'sessionId ve name zorunlu.' },
      });
    }

    const result = await voiceSandboxService.executeTool(sessionId, name, args);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// ==================== KANIT: SANDBOX SİPARİŞLERİ ====================

/**
 * Demo sayfasının "sipariş gerçekten düştü mü" kanıtı için okunur.
 * tenantId sabittir; istekten okunmaz.
 */
router.get('/orders', toolRateLimiter, async (_req: Request, res: Response) => {
  try {
    const orders = await prisma.order.findMany({
      where: { tenantId: SANDBOX_TENANT_ID },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    res.json({
      success: true,
      data: orders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        totalPrice: Number(o.totalPrice),
        // customerName ve deliveryAddress BİLEREK dönülmüyor: bu uç auth'suz ve
        // demoda konuşulan ad/adres serbest metin. Sipariş kanıtı için gereksiz.
        deliveryType: o.deliveryType,
        paymentMethod: o.paymentMethod,
        externalOrderId: o.externalOrderId, // POS'a GİTMEDİĞİNİN kanıtı: her zaman null
        createdAt: o.createdAt.toISOString(),
        items: o.items.map((i) => ({ name: i.menuItemName, qty: i.qty, unitPrice: Number(i.unitPrice) })),
      })),
    });
  } catch (error) {
    // Auth'suz uç: ham hatayı genel handler'a bırakmıyoruz (dev modunda
    // err.message bundle'dan kod parçası taşıyabiliyor).
    logger.error({ error }, 'Sandbox sipariş listesi okunamadı');
    res.status(503).json({
      success: false,
      error: { code: 'VOICE_NOT_READY', message: 'Demo ortamı şu anda hazır değil.' },
    });
  }
});

export const voiceRouter = router;
