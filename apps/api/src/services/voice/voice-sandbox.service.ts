import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import * as stringSimilarity from 'string-similarity';
import { getConfig } from '@whatres/config';
import prisma from '../../db/prisma';
import { createLogger } from '../../logger';
import { AppError } from '../../middleware/error-handler';
import { orderService } from '../order.service';
import { SANDBOX_MENU } from './voice-sandbox-menu';
import {
  SANDBOX_TENANT_ID,
  SANDBOX_TENANT_NAME,
  SANDBOX_TENANT_SLUG,
  OPENAI_REALTIME_BASE_URL,
  REALTIME_MODEL,
  REALTIME_VOICE,
  MAX_SESSION_SECONDS,
  CLIENT_SECRET_TTL_SECONDS,
  MAX_TOOL_CALLS_PER_SESSION,
  MAX_ORDERS_PER_SESSION,
  MAX_CONCURRENT_SESSIONS,
  MAX_SESSIONS_PER_DAY,
  MAX_OUTPUT_TOKENS,
  MAX_CART_LINES,
  MAX_QTY_PER_LINE,
  VOICE_TENANT_SLUGS,
  TENANT_MAX_SESSION_SECONDS,
  TENANT_MAX_CONCURRENT_SESSIONS,
  TENANT_MAX_SESSIONS_PER_DAY,
  ASSISTANT_NAMES,
} from './voice-sandbox.constants';
import { posIntegrationService } from '../pos-integration.service';

const logger = createLogger();

// ==================== TİPLER ====================

export interface VoiceMenuItem {
  id: string;
  name: string;
  description: string | null;
  price: number;
  category: string;
}

interface CartLine {
  menuItemId: string;
  name: string;
  unitPrice: number;
  qty: number;
  notes: string | null;
}

interface VoiceSession {
  id: string;
  createdAt: number;
  expiresAt: number;
  toolCalls: number;
  orderCount: number;
  cart: CartLine[];
  placedOrder: { orderId: string; orderNumber: number | null; total: number } | null;
  ipHash: string;
  /** Sandbox'ta SANDBOX_TENANT_ID; gerçek restoran modunda o kiracının id'si. */
  tenantId: string;
  tenantName: string;
  /** Oturum açılırken dondurulan menü — tool çağrıları hep bunu kullanır. */
  menu: VoiceMenuItem[];
  /** Bu oturum için yazılan konuşma-kaydı satırı sayısı (tavan: taşma freni). */
  logCount: number;
  /** OpenAI tarafindaki cagri kimligi — bilindiginde sure dolunca kapatilir. */
  callId: string | null;
  hangupTimer: NodeJS.Timeout | null;
  hungUp: boolean;
}

export interface ToolResult {
  ok: boolean;
  /** Modelin sesli olarak aktaracağı kısa Türkçe özet. */
  mesaj: string;
  sepet?: { urun: string; adet: number; birim_fiyat: number; ara_toplam: number }[];
  toplam?: number;
  siparis_no?: number | null;
  kalan_sure_sn?: number;
}

// ==================== OTURUM DEPOSU (bellek içi) ====================

const sessions = new Map<string, VoiceSession>();

// ==================== KONUŞMA KAYITLARI (JSONL) ====================
//
// Ses ve döküm tarayıcı ile OpenAI arasında aktığı için sunucu konuşmayı
// doğrudan görmez: fonksiyon çağrılarını burada, müşteri/Ada satırlarını
// sayfanın /session/log ucuna gönderdiği toplu paketlerden yazarız.
// Kayıt yeri: VOICE_LOG_DIR/<gün>/<sessionId>.jsonl

const VOICE_LOG_DIR = process.env.VOICE_LOG_DIR || '/opt/whatres/voice-logs';
const MAX_LOG_EVENTS_PER_SESSION = 400;

function voiceLog(
  session: VoiceSession,
  role: string,
  text: string,
  extra?: Record<string, unknown>,
): void {
  try {
    if (session.logCount >= MAX_LOG_EVENTS_PER_SESSION) return;
    session.logCount += 1;
    const day = new Date().toISOString().slice(0, 10);
    const dir = path.join(VOICE_LOG_DIR, day);
    fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({
      t: new Date().toISOString(),
      tenant: session.tenantName,
      role,
      text: String(text).slice(0, 2000),
      ...(extra || {}),
    });
    fs.appendFile(path.join(dir, `${session.id}.jsonl`), line + '\n', () => undefined);
  } catch {
    /* kayıt tutulamaması sipariş hattını düşürmez */
  }
}

/**
 * Konuşma sırası (turn-taking) algılaması — sesli siparişte GECİKMENİN ASIL KAYNAĞI.
 *
 *  fast  : server_vad — sustuktan 500 ms sonra yanıt başlar. En akıcısı; ama
 *          düşünmek için verilen uzun duraklamalarda müşterinin sözünü kesebilir.
 *  smart : semantic_vad + eagerness:high — modelin "cümle bitti mi" kararına
 *          bakar, bölmez; karşılığında birkaç yüz ms daha bekler.
 *
 * Varsayılan `fast`: canlı sipariş hattında beklemek, ara sıra bölünmekten
 * daha kötü hissettiriyor. Demo sayfasından anlık değiştirilebilir.
 */
export type VoiceTurnMode = 'fast' | 'smart';

function turnDetectionFor(mode: VoiceTurnMode) {
  if (mode === 'smart') {
    return {
      type: 'semantic_vad',
      eagerness: 'high',
      create_response: true,
      interrupt_response: true,
    };
  }
  return {
    type: 'server_vad',
    // 0.5 restoran/ortam gürültüsünde yanlış tetikleniyordu: Ada tam cümleyi
    // ÜRETİYOR (döküm ekrana geliyor) ama sesi barge-in ile anında kesiliyordu.
    threshold: 0.6,
    prefix_padding_ms: 300,
    silence_duration_ms: 500,
    create_response: true,
    interrupt_response: true,
  };
}
let dailyCount = 0;
let dailyTenantCount = 0;
let dailyBucket = '';

function todayBucket(): string {
  return new Date().toISOString().slice(0, 10);
}

function sweep(): void {
  const now = Date.now();
  for (const [id, s] of sessions) {
    // Süresi dolan oturumları bir süre daha tutup sonra atıyoruz; böylece
    // "süre doldu" mesajı üretebiliyoruz, sonsuza kadar bellekte kalmıyorlar.
    if (now > s.expiresAt + 5 * 60_000) sessions.delete(id);
  }
}

const sweeper = setInterval(sweep, 60_000);
// Test/CLI süreçlerinin kapanmasını engellemesin.
if (typeof sweeper.unref === 'function') sweeper.unref();

// ==================== METİN YARDIMCILARI ====================

const TR_MAP: Record<string, string> = {
  ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', I: 'i', İ: 'i', ö: 'o', Ö: 'o',
  ş: 's', Ş: 's', ü: 'u', Ü: 'u',
};

function normalize(text: string): string {
  return text
    .split('')
    .map((ch) => TR_MAP[ch] ?? ch)
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ==================== BOOTSTRAP (idempotent) ====================

let bootstrapPromise: Promise<VoiceMenuItem[]> | null = null;
let cachedMenu: VoiceMenuItem[] | null = null;

/**
 * Sandbox tenant'ını ve 22 ürünlük demo menüsünü oluşturur/onarır.
 *
 * Her çağrıda POS alanlarını NULL'a ve orderNotifyPhones'u boş diziye ZORLAR.
 * Bu, güvenlik sınırının kendi kendini onaran hâlidir: biri panelden bu
 * tenant'a POS anahtarı girse bile bir sonraki demo başlangıcında temizlenir.
 */
async function bootstrap(): Promise<VoiceMenuItem[]> {
  const safetyFields = {
    posApiUrl: null,
    posApiKey: null,
    posLocationId: null,
    posWebhookSecret: null,
    orderNotifyPhones: [],
  };

  await prisma.tenant.upsert({
    where: { id: SANDBOX_TENANT_ID },
    update: safetyFields,
    create: {
      id: SANDBOX_TENANT_ID,
      name: SANDBOX_TENANT_NAME,
      slug: SANDBOX_TENANT_SLUG,
      ...safetyFields,
    },
  });

  let version = await prisma.menuVersion.findFirst({
    where: { tenantId: SANDBOX_TENANT_ID },
    orderBy: { version: 'desc' },
  });

  if (!version) {
    version = await prisma.menuVersion.create({
      data: { tenantId: SANDBOX_TENANT_ID, version: 1, publishedAt: new Date() },
    });
  }

  const existing = await prisma.menuItem.count({
    where: { tenantId: SANDBOX_TENANT_ID, versionId: version.id },
  });

  if (existing === 0) {
    await prisma.menuItem.createMany({
      data: SANDBOX_MENU.map((item, index) => ({
        tenantId: SANDBOX_TENANT_ID,
        versionId: version!.id,
        name: item.name,
        description: item.description,
        basePrice: item.price,
        category: item.category,
        isActive: true,
        sortOrder: index,
      })),
    });
    logger.info(
      { tenantId: SANDBOX_TENANT_ID, count: SANDBOX_MENU.length },
      'Sesli demo sandbox menüsü oluşturuldu',
    );
  }

  await prisma.tenant.update({
    where: { id: SANDBOX_TENANT_ID },
    data: { activeMenuVersionId: version.id },
  });

  const items = await prisma.menuItem.findMany({
    where: { tenantId: SANDBOX_TENANT_ID, versionId: version.id, isActive: true },
    orderBy: { sortOrder: 'asc' },
  });

  cachedMenu = items.map((i) => ({
    id: i.id,
    name: i.name,
    description: i.description,
    price: Number(i.basePrice),
    category: i.category,
  }));

  return cachedMenu;
}

async function getMenu(): Promise<VoiceMenuItem[]> {
  if (cachedMenu) return cachedMenu;
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrap().catch((err) => {
      bootstrapPromise = null; // bir sonraki istek yeniden denesin
      throw err;
    });
  }
  return bootstrapPromise;
}

/** Aynı kiracı için eşzamanlı pullMenu tekrarını engeller (yinelenen sürüm yarışı). */
const tenantMenuRefresh = new Map<string, Promise<void>>();

function refreshTenantMenu(tenantId: string): Promise<void> {
  let p = tenantMenuRefresh.get(tenantId);
  if (!p) {
    p = posIntegrationService
      .pullMenu(tenantId)
      .then(() => undefined)
      .catch((error) => {
        logger.warn({ tenantId, error }, 'Sesli asistan: POS menüsü tazelenemedi, eldeki sürümle devam');
      })
      .finally(() => tenantMenuRefresh.delete(tenantId));
    tenantMenuRefresh.set(tenantId, p);
  }
  return p;
}

/**
 * Gerçek kiracı menüsü. pullMenu ile POS'tan senkronlanan sürümü okur —
 * cart satırları whatres menuItem.id taşır, pushOrder bunları externalItemId
 * üzerinden POS ürünlerine eşler; bu yüzden POS'un canlı menüsü DEĞİL,
 * senkronlanmış kopya kullanılmak zorundadır.
 *
 * Yalnız YAYIMLANMIŞ sürüm okunur: pullMenu sürümü önce yaratıp en son
 * yayımlar; yarıda kalan/taslak sürümler eksik menü satar ya da externalItemId
 * içermediği için POS push'unu sessizce boşa çıkarırdı.
 *
 * Tazeleme (>1 saat) ARKAPLANDA yapılır: 100+ ürünlük menüde pullMenu on
 * saniyeler sürer ve /session isteğini asmamalı. Yalnız hiç yayımlanmış sürüm
 * yoksa (ilk kurulum) beklenir.
 */
async function getTenantMenu(tenantId: string): Promise<VoiceMenuItem[]> {
  const publishedLatest = () =>
    prisma.menuVersion.findFirst({
      where: { tenantId, publishedAt: { not: null } },
      orderBy: { version: 'desc' },
    });

  let version = await publishedLatest();
  const stale = !version || Date.now() - new Date(version.createdAt).getTime() > 60 * 60_000;
  if (stale) {
    const refresh = refreshTenantMenu(tenantId);
    if (!version) {
      await refresh;
      version = await publishedLatest();
    }
  }
  if (!version) throw new Error('kiracının yayımlanmış menü sürümü yok');
  const items = await prisma.menuItem.findMany({
    where: { tenantId, versionId: version.id, isActive: true },
    orderBy: { sortOrder: 'asc' },
  });
  if (items.length === 0) throw new Error('kiracı menüsü boş');
  return items.map((i) => ({
    id: i.id,
    name: i.name,
    description: i.description,
    price: Number(i.basePrice),
    category: i.category,
  }));
}

// ==================== INSTRUCTIONS (menü gömülü) ====================

function buildInstructions(
  menu: VoiceMenuItem[],
  tenantName?: string | null,
  asistanAdi = 'Ada',
): string {
  const byCategory = new Map<string, VoiceMenuItem[]>();
  for (const item of menu) {
    const list = byCategory.get(item.category) || [];
    list.push(item);
    byCategory.set(item.category, list);
  }

  const menuText = [...byCategory.entries()]
    .map(([category, items]) => {
      const lines = items
        .map((i) => `- ${i.name} — ${i.price} TL${i.description ? ` (${i.description})` : ''}`)
        .join('\n');
      return `${category}:\n${lines}`;
    })
    .join('\n\n');

  const restoran = tenantName || 'OtOrder demo restoranı';
  const siparisAkisi = tenantName
    ? `siparisi_tamamla İÇİN ZORUNLU AKIŞ — her bilgiyi AYRI bir soruyla, şu sırayla al:
1) "Adınızı alabilir miyim?" (musteri_adi)
2) Telefon numarası (telefon) — rakamları sesli teyit et
3) "Gel-al mı olsun, adrese teslim mi?" (teslimat_tipi) — bu soruyu SORMADAN teslimat tipine karar VERME
4) Adrese teslimse açık adresi al: mahalle, cadde/sokak, bina no, kat/daire (adres)
5) "Ödeme nakit mi, kart mı olacak?" (odeme_tipi)
Bu bilgilerin HİÇBİRİNİ varsayma ya da uydurma; müşteri söylemeden fonksiyonu çağırma.
Parametrelere ASLA alan adı gibi yer tutucu değer ("musteri_adi", "telefon" vb.) yazma.`
    : `siparisi_tamamla için ÖNCE şunları sırayla ve tek tek sor:
- adı (musteri_adi)
- gel-al mı, adrese teslim mi (teslimat_tipi)
- adrese teslimse açık adres (adres)
- ödeme nakit mi kart mı (odeme_tipi)
Eksik bilgiyle fonksiyonu çağırma, uydurma.`;
  const uslup = `KONUŞMA TARZI:
- Sıcak, samimi ve doğal konuş — gülümseyen bir telefon görevlisi gibi; robotik ve tekdüze olma.
- Bir fonksiyonu çağırmadan HEMEN ÖNCE kısa bir doldurucu cümle söyle ("Hemen ekliyorum...",
  "Bir saniye, siparişinizi giriyorum...") — müşteriyi sessizlikte bekletme.${tenantName ? `
- Sipariş tamamlanınca sipariş numarası SÖYLEME (sistem numarası müşteride karışıklık yaratıyor);
  "Siparişiniz alındı, hazırlanmaya başlıyor" de ve toplam tutarı tekrar et.` : ''}`;
  const acilis = tenantName
    ? `${tenantName}'ın sipariş hattına hoş geldiniz! Ben ${asistanAdi}. Ne sipariş vermek istersiniz?`
    : `OtOrder sipariş hattına hoş geldiniz! Ben ${asistanAdi}. Ne sipariş vermek istersiniz?`;

  return `Adın ${asistanAdi}; ${restoran} adına telefonla sipariş alan görevlisin.
VARSAYILAN DİLİN TÜRKÇE. Müşteri başka bir dilde konuşursa ANINDA o dile geç ve
konuşmanın kalanını o dilde sürdür — selamlaşma, teyitler, sorular dahil.
Menüdeki ürün adlarını orijinal haliyle söyle, çevirme.
Doğal, sıcak ve KISA cümleler kur — telefonda konuşuyorsun, monolog yapma.
Her yanıtın en fazla 2 cümle olsun. Müşteri sözünü kestiğinde hemen sus ve dinle.

AŞAĞIDAKİ MENÜ TAM VE GÜNCELDİR. Fiyat, içerik ve "neler var" sorularını
DOĞRUDAN bu listeden yanıtla — bunun için ASLA fonksiyon çağırma, bu gecikme yaratır.

===== MENÜ =====
${menuText}
================

FONKSİYON KULLANIMI (sadece bu üç durumda):
1. Müşteri bir ürün istediğinde/eklediğinde -> sepete_ekle
2. Müşteri bir ürünü çıkarmak/azaltmak istediğinde -> sepetten_cikar (hepsini iptal: sepeti_temizle)
3. Müşteri "bu kadar / tamamdır / siparişi ver" dediğinde -> once sepeti sesli özetle ve ONAY AL,
   onay gelince siparisi_tamamla çağır.

${siparisAkisi}

${uslup}

KURALLAR:
- Menüde OLMAYAN bir ürün istenirse kibarca yok de ve menüden en yakın alternatifi öner. Uydurma.
- Fiyatları asla değiştirme, indirim/kampanya uydurma.
- Sepete ekledikten sonra tek cümlede teyit et ("Bir sucuklu pizza eklendi, başka?").
- Fonksiyon sonucu sana "ok: false" dönerse, dönen mesajı müşteriye kendi cümlelerinle nazikçe aktar.
${tenantName
    ? '- Bu GERÇEK bir sipariş hattıdır: sipariş mutfağa iletilir. Telefon numarası olmadan siparişi tamamlama.'
    : '- Bu bir demodur; gerçek teslimat yapılmaz. Müşteri sorarsa bunu söyleyebilirsin.'}

Açılış cümlen: "${acilis}"${tenantName ? `
(Restoran adının sonundaki iyelik ekini Türkçe ünlü uyumuna göre düzelt: -'ın/-'in/-'un/-'ün/-'nın/-'nin.)` : ''}`;
}

// ==================== TOOL TANIMLARI ====================

function toolDefinitions() {
  return [
    {
      type: 'function' as const,
      name: 'sepete_ekle',
      description:
        'Müşterinin istediği ürünü sepete ekler. Sadece menüdeki ürünler eklenebilir. ' +
        'Fiyat/içerik sorularında BU FONKSİYONU ÇAĞIRMA.',
      parameters: {
        type: 'object',
        properties: {
          urun: { type: 'string', description: 'Menüdeki ürün adı, müşterinin söylediği şekliyle.' },
          adet: { type: 'integer', minimum: 1, maximum: MAX_QTY_PER_LINE, description: 'Adet. Belirtilmediyse 1.' },
          not: { type: 'string', description: 'Ürüne özel not, örn. "soğansız". Yoksa boş bırak.' },
        },
        required: ['urun'],
        additionalProperties: false,
      },
    },
    {
      type: 'function' as const,
      name: 'sepetten_cikar',
      description: 'Sepetteki bir üründen belirtilen adeti çıkarır. Adet verilmezse o ürünün tamamını çıkarır.',
      parameters: {
        type: 'object',
        properties: {
          urun: { type: 'string', description: 'Çıkarılacak ürün adı.' },
          adet: { type: 'integer', minimum: 1, maximum: MAX_QTY_PER_LINE },
        },
        required: ['urun'],
        additionalProperties: false,
      },
    },
    {
      type: 'function' as const,
      name: 'sepeti_temizle',
      description: 'Sepetteki tüm ürünleri siler. Müşteri siparişi baştan almak istediğinde kullan.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      type: 'function' as const,
      name: 'sepeti_oku',
      description: 'Sepetin güncel içeriğini ve toplam tutarı döner. Müşteri "ne var sepette / kaç para tuttu" derse kullan.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      type: 'function' as const,
      name: 'siparisi_tamamla',
      description:
        'Siparişi kesinleştirir. SADECE müşteri sepeti sesli özetten sonra onayladıysa ve ' +
        'ad/teslimat tipi/(gerekiyorsa adres)/ödeme tipi alındıysa çağır.',
      parameters: {
        type: 'object',
        properties: {
          musteri_adi: { type: 'string', description: 'Müşterinin adı.' },
          telefon: { type: 'string', description: 'Müşterinin telefon numarası. Gerçek restoran hattında zorunlu; rakamları teyit ederek al.' },
          teslimat_tipi: { type: 'string', enum: ['PICKUP', 'DELIVERY'], description: 'PICKUP = gel al, DELIVERY = adrese teslim.' },
          adres: { type: 'string', description: 'Açık adres. Sadece teslimat_tipi DELIVERY ise zorunlu.' },
          odeme_tipi: { type: 'string', enum: ['CASH', 'CARD'], description: 'CASH = nakit, CARD = kart.' },
          not: { type: 'string', description: 'Sipariş geneline ait not. Yoksa boş bırak.' },
        },
        required: ['musteri_adi', 'teslimat_tipi', 'odeme_tipi'],
        additionalProperties: false,
      },
    },
  ];
}

// ==================== SEPET YARDIMCILARI ====================

function cartView(session: VoiceSession) {
  return session.cart.map((line) => ({
    urun: line.name,
    adet: line.qty,
    birim_fiyat: line.unitPrice,
    ara_toplam: round2(line.unitPrice * line.qty),
  }));
}

function cartTotal(session: VoiceSession): number {
  return round2(session.cart.reduce((sum, l) => sum + l.unitPrice * l.qty, 0));
}

type MenuMatch =
  | { kind: 'hit'; item: VoiceMenuItem }
  | { kind: 'ambiguous'; candidates: VoiceMenuItem[] }
  | { kind: 'miss' };

/**
 * "pizza" gibi bir istek 5 ürüne birden uyar. Bunlardan birini sessizce seçmek
 * müşteriye yanlış ürün yazmak demektir — bu durumda `ambiguous` dönüp modelin
 * "hangisi?" diye sormasını sağlıyoruz.
 */
function matchMenuItem(menu: VoiceMenuItem[], query: string): MenuMatch {
  const q = normalize(query);
  if (!q) return { kind: 'miss' };
  const qTokens = q.split(' ');

  const entries = menu.map((item) => {
    const key = normalize(item.name);
    return { item, key, tokens: key.split(' ') };
  });

  // 1) Birebir ad
  const exact = entries.find((e) => e.key === q);
  if (exact) return { kind: 'hit', item: exact.item };

  // 2) KELİME BAZLI kapsama.
  //    Ham substring KULLANILMIYOR: "Su" ürünü yüzünden "suffle" -> Su ve
  //    "sucuklu" -> Su gibi yanlış eşleşmeler oluyordu. Token karşılaştırması
  //    "bir kola" -> Kola ve "sezar" -> Sezar Salata durumlarını korur.
  const contains = entries.filter(
    (e) =>
      e.tokens.every((t) => qTokens.includes(t)) || qTokens.every((t) => e.tokens.includes(t)),
  );
  if (contains.length === 1) return { kind: 'hit', item: contains[0].item };
  if (contains.length > 1) return { kind: 'ambiguous', candidates: contains.map((c) => c.item) };

  // 3) Yazım/telaffuz sapmaları için benzerlik. Tam ad kadar TEKİL kelimelere de
  //    bakılır ("margarita" -> Margherita Pizza). Birden fazla üründe geçen
  //    kelimeler (pizza, makarna, burger...) aday listesine ALINMAZ — yoksa
  //    "pizzza" rastgele bir pizzaya düşerdi.
  //
  //    Kelime adaylarının eşiği daha YÜKSEK: tek kelime üzerinden eşleşmek
  //    yanılmaya çok açık ("cizburger" -> "hamburger" 0.63 ile geçiyordu ve
  //    müşteriye yanlış ürün yazıyordu). Yüksek eşikte eşleşme bulunamazsa
  //    'miss' dönüp modelin "hangisini istersiniz?" diye sormasını sağlıyoruz.
  const tokenCounts = new Map<string, number>();
  for (const e of entries) {
    for (const t of new Set(e.tokens)) tokenCounts.set(t, (tokenCounts.get(t) || 0) + 1);
  }

  const FULL_NAME_THRESHOLD = 0.6;
  const SINGLE_TOKEN_THRESHOLD = 0.7;

  const candidates: { text: string; item: VoiceMenuItem; threshold: number }[] = [];
  for (const e of entries) {
    candidates.push({ text: e.key, item: e.item, threshold: FULL_NAME_THRESHOLD });
    for (const t of e.tokens) {
      if (t.length >= 4 && tokenCounts.get(t) === 1) {
        candidates.push({ text: t, item: e.item, threshold: SINGLE_TOKEN_THRESHOLD });
      }
    }
  }

  let winner: VoiceMenuItem | null = null;
  let winnerRating = 0;
  for (const candidate of candidates) {
    const rating = stringSimilarity.compareTwoStrings(q, candidate.text);
    if (rating >= candidate.threshold && rating > winnerRating) {
      winner = candidate.item;
      winnerRating = rating;
    }
  }

  return winner ? { kind: 'hit', item: winner } : { kind: 'miss' };
}

// ==================== OTURUM AÇMA ====================

export interface CreateSessionResult {
  sessionId: string;
  clientSecret: string;
  clientSecretExpiresAt: number;
  sessionExpiresAt: number;
  maxSessionSeconds: number;
  model: string;
  realtimeCallsUrl: string;
  menu: VoiceMenuItem[];
  /** Gerçek restoran modunda restoran adı; sandbox'ta null. */
  tenantName: string | null;
  /** Bu oturum için rastgele seçilen asistan adı (sayfa etiketleri kullanır). */
  assistantName: string;
}

export class VoiceSandboxService {
  async getMenuForDisplay(): Promise<VoiceMenuItem[]> {
    return getMenu();
  }

  async createSession(
    ipHash: string,
    mode: VoiceTurnMode = 'fast',
    tenantSlug?: string,
  ): Promise<CreateSessionResult> {
    const config = getConfig();
    const apiKey = config.openai.apiKey;
    if (!apiKey) {
      throw new AppError(503, 'VOICE_NOT_CONFIGURED', 'OPENAI_API_KEY tanımlı değil, sesli asistan kapalı.');
    }

    // --- Gerçek restoran modu: yalnız env allowlist'indeki kiracılar ---
    let tenant: { id: string; name: string } | null = null;
    if (tenantSlug) {
      if (!VOICE_TENANT_SLUGS.includes(tenantSlug)) {
        throw new AppError(404, 'VOICE_TENANT_UNKNOWN', 'Bu restoran için sesli asistan tanımlı değil.');
      }
      const t = await prisma.tenant.findUnique({
        where: { slug: tenantSlug },
        select: { id: true, name: true },
      });
      if (!t) {
        throw new AppError(404, 'VOICE_TENANT_UNKNOWN', 'Bu restoran için sesli asistan tanımlı değil.');
      }
      tenant = t;
    }

    // --- Maliyet freni: günlük ve eşzamanlı oturum tavanları ---
    // Restoran hattı ve demo AYRI sayılır: demo trafiği gerçek hattı boğamaz.
    const bucket = todayBucket();
    if (dailyBucket !== bucket) {
      dailyBucket = bucket;
      dailyCount = 0;
      dailyTenantCount = 0;
    }
    if (tenant) {
      if (dailyTenantCount >= TENANT_MAX_SESSIONS_PER_DAY) {
        throw new AppError(429, 'VOICE_DAILY_LIMIT', 'Sesli sipariş hattı bugünlük kapandı, lütfen restoranı telefonla arayın.');
      }
    } else if (dailyCount >= MAX_SESSIONS_PER_DAY) {
      throw new AppError(429, 'VOICE_DAILY_LIMIT', 'Günlük demo kotası doldu, yarın tekrar deneyin.');
    }

    sweep();
    const now = Date.now();
    const wantTenantMode = !!tenant;
    const active = [...sessions.values()].filter(
      (s) => s.expiresAt > now && (s.tenantId !== SANDBOX_TENANT_ID) === wantTenantMode,
    ).length;
    const concurrentCap = tenant ? TENANT_MAX_CONCURRENT_SESSIONS : MAX_CONCURRENT_SESSIONS;
    if (active >= concurrentCap) {
      throw new AppError(
        429,
        'VOICE_BUSY',
        tenant
          ? 'Şu anda tüm hatlarımız meşgul, lütfen birazdan tekrar deneyin.'
          : 'Şu anda tüm demo hatları meşgul, birazdan tekrar deneyin.',
      );
    }

    // Ham hatanın genel error handler'a düşmesine izin verilmiyor: NODE_ENV
    // development iken o handler err.message'ı aynen döner ve Prisma hataları
    // bundle'dan kod parçası taşır. Bu uç auth'suz olduğu için susturuyoruz.
    let menu: VoiceMenuItem[];
    try {
      menu = tenant ? await getTenantMenu(tenant.id) : await getMenu();
    } catch (error) {
      logger.error({ error, tenantSlug }, 'Sesli asistan menü hazırlığı başarısız');
      throw new AppError(
        503,
        'VOICE_NOT_READY',
        tenant
          ? 'Sesli sipariş hattı şu anda hizmet veremiyor, lütfen restoranı telefonla arayın.'
          : 'Demo ortamı şu anda hazır değil, biraz sonra tekrar deneyin.',
      );
    }
    const asistanAdi = ASSISTANT_NAMES[Math.floor(Math.random() * ASSISTANT_NAMES.length)] || 'Ada';
    const instructions = buildInstructions(menu, tenant?.name, asistanAdi);
    const sessionSeconds = tenant ? TENANT_MAX_SESSION_SECONDS : MAX_SESSION_SECONDS;

    const body = {
      expires_after: { anchor: 'created_at', seconds: CLIENT_SECRET_TTL_SECONDS },
      session: {
        type: 'realtime',
        model: REALTIME_MODEL,
        instructions,
        output_modalities: ['audio'],
        max_output_tokens: MAX_OUTPUT_TOKENS,
        // NOT: `format` bilerek verilmiyor — WebRTC taşımasında codec'i tarayıcı
        // ile OpenAI pazarlık ediyor (Opus). Format alanı yalnız WebSocket
        // taşıması için anlamlı ve burada 400'e yol açabiliyor.
        audio: {
          input: {
            // Dil bilerek sabitlenmiyor: müşteri hangi dilde konuşursa o dilde
            // çözülür — asistanın "her dili konuşabilme" şartı bunu gerektiriyor.
            transcription: { model: 'gpt-4o-mini-transcribe' },
            turn_detection: turnDetectionFor(mode),
          },
          output: { voice: REALTIME_VOICE, speed: 1.05 },
        },
        tool_choice: 'auto',
        tools: toolDefinitions(),
      },
    };

    // NOT: config.openai.baseUrl BİLEREK kullanılmıyor — yerel Ollama'ya
    // işaret ediyor olabilir. Realtime her zaman gerçek OpenAI'a gider.
    const response = await fetch(`${OPENAI_REALTIME_BASE_URL}/realtime/client_secrets`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(config.openai.orgId ? { 'OpenAI-Organization': config.openai.orgId } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      // Ham OpenAI hatasını istemciye YANSITMIYORUZ (anahtar/proje bilgisi sızabilir).
      logger.error({ status: response.status, detail: detail.slice(0, 500) }, 'Realtime client secret alınamadı');
      throw new AppError(502, 'VOICE_UPSTREAM_ERROR', 'Sesli oturum başlatılamadı, lütfen tekrar deneyin.');
    }

    const payload = (await response.json()) as {
      value?: string;
      client_secret?: { value?: string; expires_at?: number };
      expires_at?: number;
    };

    // GA yanıtı düz { value, expires_at }; eski şekil { client_secret: { value } }.
    const clientSecret = payload.value || payload.client_secret?.value;
    if (!clientSecret) {
      logger.error({ keys: Object.keys(payload || {}) }, 'Realtime yanıtında ephemeral anahtar yok');
      throw new AppError(502, 'VOICE_UPSTREAM_ERROR', 'Sesli oturum başlatılamadı, lütfen tekrar deneyin.');
    }

    // 144 bit entropi: /tool ucu oturuma sadece bu kimlikle eristigi icin
    // tahmin edilebilir bir id baskasinin sepetini degistirmeye izin verirdi.
    const sessionId = `vs_${crypto.randomBytes(18).toString('base64url')}`;
    const session: VoiceSession = {
      id: sessionId,
      createdAt: now,
      expiresAt: now + sessionSeconds * 1000,
      toolCalls: 0,
      orderCount: 0,
      cart: [],
      placedOrder: null,
      ipHash,
      callId: null,
      hangupTimer: null,
      hungUp: false,
      tenantId: tenant?.id ?? SANDBOX_TENANT_ID,
      tenantName: tenant?.name ?? SANDBOX_TENANT_NAME,
      menu,
      logCount: 0,
    };
    sessions.set(sessionId, session);
    voiceLog(session, 'sistem', 'Oturum açıldı', { mode, tenantSlug: tenantSlug || null, asistan: asistanAdi });
    if (tenant) dailyTenantCount += 1;
    else dailyCount += 1;

    logger.info(
      { sessionId, ipHash, active: active + 1, dailyCount, dailyTenantCount, tenantSlug: tenantSlug || null },
      'Sesli asistan oturumu açıldı',
    );

    return {
      sessionId,
      clientSecret,
      clientSecretExpiresAt:
        (payload.expires_at || payload.client_secret?.expires_at || Math.floor(now / 1000) + CLIENT_SECRET_TTL_SECONDS) * 1000,
      sessionExpiresAt: session.expiresAt,
      maxSessionSeconds: sessionSeconds,
      tenantName: tenant?.name ?? null,
      assistantName: asistanAdi,
      model: REALTIME_MODEL,
      realtimeCallsUrl: `${OPENAI_REALTIME_BASE_URL}/realtime/calls`,
      menu,
    };
  }

  /**
   * MALİYET FRENİ (sunucu tarafı).
   *
   * Tarayıcıdaki sayaç iyi niyetli istemciyi keser; değiştirilmiş bir istemci
   * WebRTC bağlantısını süre dolduktan sonra da açık tutabilirdi. Bu yüzden
   * çağrı kimliğini öğrendiğimizde süre dolunca OpenAI'ın kendi hangup ucunu
   * ÇAĞIRIYORUZ — bağlantı istemci ne yaparsa yapsın kapanır.
   *
   * Çağrı kimliği alınamazsa (Location başlığı CORS'ta açılmamışsa) geriye
   * kalan frenler devrededir: süre sonrası tool çağrıları reddedilir, IP başına
   * ve global oturum tavanları uygulanır, max_output_tokens sınırlıdır.
   */
  registerCall(sessionId: string, callId: string): boolean {
    const session = sessions.get(sessionId);
    if (!session || session.callId) return false;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(callId)) return false;

    session.callId = callId;
    const delay = Math.max(0, session.expiresAt - Date.now());
    session.hangupTimer = setTimeout(() => {
      void this.hangup(session, 'süre doldu');
    }, delay);
    if (typeof session.hangupTimer.unref === 'function') session.hangupTimer.unref();
    return true;
  }

  private async hangup(session: VoiceSession, reason: string): Promise<void> {
    if (session.hungUp || !session.callId) return;
    session.hungUp = true;

    const config = getConfig();
    if (!config.openai.apiKey) return;

    try {
      // API anahtarı yalnızca burada, SUNUCUDA kullanılır.
      const res = await fetch(
        `${OPENAI_REALTIME_BASE_URL}/realtime/calls/${encodeURIComponent(session.callId)}/hangup`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.openai.apiKey}` },
          signal: AbortSignal.timeout(8000),
        },
      );
      logger.info(
        { sessionId: session.id, status: res.status, reason },
        'Sesli demo çağrısı sunucudan kapatıldı',
      );
    } catch (error) {
      logger.warn({ sessionId: session.id, error, reason }, 'Sesli demo hangup başarısız');
    }
  }

  /** Demo sayfasından gelen kesinleşmiş konuşma satırları (müşteri/Ada). */
  appendClientLog(sessionId: string, events: unknown[]): number {
    const session = sessions.get(sessionId);
    if (!session) return 0;
    let yazilan = 0;
    for (const raw of events.slice(0, 40)) {
      const ev = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      const role =
        ev.role === 'musteri' ? 'musteri' : ev.role === 'ada' || ev.role === 'asistan' ? 'asistan' : null;
      const text = typeof ev.text === 'string' ? ev.text.trim() : '';
      if (!role || !text) continue;
      voiceLog(session, role, text);
      yazilan += 1;
    }
    return yazilan;
  }

  endSession(sessionId: string): void {
    const session = sessions.get(sessionId);
    if (!session) return;

    session.expiresAt = Math.min(session.expiresAt, Date.now());
    if (session.hangupTimer) {
      clearTimeout(session.hangupTimer);
      session.hangupTimer = null;
    }
    void this.hangup(session, 'istemci bitirdi');
    logger.info({ sessionId, toolCalls: session.toolCalls }, 'Sesli demo oturumu kapatıldı');
  }

  // ==================== TOOL YÜRÜTME ====================

  async executeTool(sessionId: string, name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const session = sessions.get(sessionId);
    if (!session) {
      return { ok: false, mesaj: 'Oturum bulunamadı. Lütfen sayfayı yenileyip yeniden başlatın.' };
    }

    const now = Date.now();
    if (now > session.expiresAt) {
      return { ok: false, mesaj: 'Oturum süresi doldu. Lütfen sayfayı yenileyip yeniden başlatın.', kalan_sure_sn: 0 };
    }

    if (session.toolCalls >= MAX_TOOL_CALLS_PER_SESSION) {
      return { ok: false, mesaj: 'Bu oturum için işlem limiti doldu. Lütfen yeniden başlatın.' };
    }
    session.toolCalls += 1;

    const remaining = Math.max(0, Math.round((session.expiresAt - now) / 1000));

    voiceLog(session, 'fonksiyon', `${name} ${JSON.stringify(args).slice(0, 500)}`);
    try {
      const sonuc = await (async (): Promise<ToolResult> => {
        switch (name) {
          case 'sepete_ekle':
            return { ...(await this.addToCart(session, args)), kalan_sure_sn: remaining };
          case 'sepetten_cikar':
            return { ...(await this.removeFromCart(session, args)), kalan_sure_sn: remaining };
          case 'sepeti_temizle':
            session.cart = [];
            return { ok: true, mesaj: 'Sepet temizlendi.', sepet: [], toplam: 0, kalan_sure_sn: remaining };
          case 'sepeti_oku':
            return {
              ok: true,
              mesaj: session.cart.length ? 'Sepet okundu.' : 'Sepet boş.',
              sepet: cartView(session),
              toplam: cartTotal(session),
              kalan_sure_sn: remaining,
            };
          case 'siparisi_tamamla':
            return { ...(await this.placeOrder(session, args)), kalan_sure_sn: remaining };
          default:
            return { ok: false, mesaj: 'Bilinmeyen işlem.' };
        }
      })();
      voiceLog(session, 'fonksiyon_sonuc', sonuc.mesaj, { ok: sonuc.ok });
      return sonuc;
    } catch (error) {
      logger.error({ error, sessionId, name }, 'Sesli demo fonksiyon çağrısı başarısız');
      return { ok: false, mesaj: 'Sistemsel bir sorun oluştu, özür dilerim. Tekrar deneyebilir miyiz?' };
    }
  }

  private async addToCart(session: VoiceSession, args: Record<string, unknown>): Promise<ToolResult> {
    if (session.placedOrder) {
      return { ok: false, mesaj: 'Sipariş zaten verildi, sepete ekleme yapılamaz.' };
    }

    const menu = session.menu;
    const query = typeof args.urun === 'string' ? args.urun : '';
    const match = matchMenuItem(menu, query);

    if (match.kind === 'ambiguous') {
      const names = match.candidates.map((c) => c.name).join(', ');
      return {
        ok: false,
        mesaj: `"${query}" birden fazla ürüne uyuyor: ${names}. Müşteriye hangisini istediğini sor, sepete EKLEME.`,
        sepet: cartView(session),
        toplam: cartTotal(session),
      };
    }
    if (match.kind === 'miss') {
      return {
        ok: false,
        mesaj: `"${query}" menüde yok. Menüdeki ürünlerden birini öner.`,
        sepet: cartView(session),
        toplam: cartTotal(session),
      };
    }
    const item = match.item;

    const rawQty = Number(args.adet);
    const qty = Number.isFinite(rawQty) && rawQty >= 1 ? Math.min(Math.floor(rawQty), MAX_QTY_PER_LINE) : 1;
    const notes = typeof args.not === 'string' && args.not.trim() ? args.not.trim().slice(0, 200) : null;

    const existing = session.cart.find((l) => l.menuItemId === item.id && l.notes === notes);
    if (existing) {
      existing.qty = Math.min(existing.qty + qty, MAX_QTY_PER_LINE);
    } else {
      if (session.cart.length >= MAX_CART_LINES) {
        return {
          ok: false,
          mesaj: 'Sepette daha fazla farklı ürün taşınamıyor.',
          sepet: cartView(session),
          toplam: cartTotal(session),
        };
      }
      session.cart.push({ menuItemId: item.id, name: item.name, unitPrice: item.price, qty, notes });
    }

    return {
      ok: true,
      mesaj: `${qty} adet ${item.name} eklendi.`,
      sepet: cartView(session),
      toplam: cartTotal(session),
    };
  }

  private async removeFromCart(session: VoiceSession, args: Record<string, unknown>): Promise<ToolResult> {
    if (session.placedOrder) {
      return { ok: false, mesaj: 'Sipariş zaten verildi, sepet değiştirilemez.' };
    }

    const query = typeof args.urun === 'string' ? args.urun : '';
    const q = normalize(query);
    let index = session.cart.findIndex((l) => normalize(l.name) === q);
    if (index === -1) {
      const menu = session.menu;
      const match = matchMenuItem(menu, query);
      if (match.kind === 'hit') {
        index = session.cart.findIndex((l) => l.menuItemId === match.item.id);
      } else if (match.kind === 'ambiguous') {
        // Belirsiz istekte sepetteki adaylara daralt; hâlâ tek değilse sordur.
        const inCart = match.candidates.filter((c) =>
          session.cart.some((l) => l.menuItemId === c.id),
        );
        if (inCart.length === 1) {
          index = session.cart.findIndex((l) => l.menuItemId === inCart[0].id);
        } else if (inCart.length > 1) {
          return {
            ok: false,
            mesaj: `Sepette birden fazla eşleşme var: ${inCart
              .map((c) => c.name)
              .join(', ')}. Hangisini çıkaracağını sor.`,
            sepet: cartView(session),
            toplam: cartTotal(session),
          };
        }
      }
    }

    if (index === -1) {
      return {
        ok: false,
        mesaj: `Sepette "${query}" bulunmuyor.`,
        sepet: cartView(session),
        toplam: cartTotal(session),
      };
    }

    const line = session.cart[index];
    const rawQty = Number(args.adet);
    const qty = Number.isFinite(rawQty) && rawQty >= 1 ? Math.floor(rawQty) : line.qty;

    if (qty >= line.qty) {
      session.cart.splice(index, 1);
    } else {
      line.qty -= qty;
    }

    return {
      ok: true,
      mesaj: `${line.name} çıkarıldı.`,
      sepet: cartView(session),
      toplam: cartTotal(session),
    };
  }

  private async placeOrder(session: VoiceSession, args: Record<string, unknown>): Promise<ToolResult> {
    if (session.placedOrder) {
      return {
        ok: true,
        mesaj: session.placedOrder.orderNumber
          ? `Siparişiniz zaten alınmıştı. Sipariş numaranız ${session.placedOrder.orderNumber}.`
          : 'Siparişiniz zaten alındı ve mutfağa iletildi.',
        siparis_no: session.placedOrder.orderNumber,
        toplam: session.placedOrder.total,
      };
    }
    if (session.orderCount >= MAX_ORDERS_PER_SESSION) {
      return { ok: false, mesaj: 'Bu oturumda sipariş limiti doldu.' };
    }
    if (session.cart.length === 0) {
      return { ok: false, mesaj: 'Sepet boş, önce ürün eklemeliyiz.' };
    }

    const deliveryType = args.teslimat_tipi === 'DELIVERY' ? 'DELIVERY' : 'PICKUP';
    const paymentMethod = args.odeme_tipi === 'CARD' ? 'CARD' : 'CASH';
    const customerName =
      typeof args.musteri_adi === 'string' && args.musteri_adi.trim()
        ? args.musteri_adi.trim().slice(0, 80)
        : 'Demo Müşteri';
    const address =
      typeof args.adres === 'string' && args.adres.trim() ? args.adres.trim().slice(0, 300) : null;
    const extraNote =
      typeof args.not === 'string' && args.not.trim() ? args.not.trim().slice(0, 300) : null;

    if (deliveryType === 'DELIVERY' && !address) {
      return { ok: false, mesaj: 'Adrese teslim için açık adres gerekiyor, adresi sor.' };
    }

    const tenantMode = session.tenantId !== SANDBOX_TENANT_ID;

    // Gerçek restoran hattında telefon zorunlu — eksikse modele sordurtuyoruz.
    // Normalizasyon: TR numaraları 90XXXXXXXXXX biçimine getirilir (WhatsApp
    // anahtar biçimi); uluslararası numaralar olduğu gibi bırakılır — son 10
    // haneye kırpıp başına 90 koymak yabancı numarayı sahte TR numarasına
    // çevirirdi.
    let phoneDigits = typeof args.telefon === 'string' ? args.telefon.replace(/\D/g, '') : '';
    if (phoneDigits.startsWith('00')) phoneDigits = phoneDigits.slice(2);
    if (phoneDigits.length === 10) phoneDigits = `90${phoneDigits}`;
    else if (phoneDigits.length === 11 && phoneDigits.startsWith('0')) phoneDigits = `9${phoneDigits}`;
    if (tenantMode && (phoneDigits.length < 11 || phoneDigits.length > 15)) {
      return {
        ok: false,
        mesaj: 'Sipariş için müşterinin telefon numarası gerekiyor. Numarayı iste, rakamları teyit et, sonra tamamla.',
        sepet: cartView(session),
        toplam: cartTotal(session),
      };
    }

    // Model bazen sormak yerine parametreye alan adını yazıyor ("musteri_adi").
    // Gerçek hatta böyle bir sipariş POS'a "musteri_adi" adıyla düşer — reddet.
    const rawName = typeof args.musteri_adi === 'string' ? args.musteri_adi.trim() : '';
    // toLocaleLowerCase('tr'): /i bayrağı noktalı büyük İ'yi katlayamıyor ("MÜŞTERİ" kaçıyordu).
    const placeholderAd = /^(musteri_adi|musteri|müşteri|isim|ad|name|telefon|string)$/.test(
      rawName.toLocaleLowerCase('tr'),
    );
    if (tenantMode && (rawName.length < 2 || placeholderAd)) {
      return {
        ok: false,
        mesaj: 'Müşterinin adını henüz almadın. Önce adını sor, sonra siparişi tamamla.',
        sepet: cartView(session),
        toplam: cartTotal(session),
      };
    }

    if (!tenantMode) {
      // --- GÜVENLİK SINIRI (yalnız sandbox): siparişi yazmadan önce izolasyonu doğrula ---
      const sandboxTenant = await prisma.tenant.findUnique({
        where: { id: SANDBOX_TENANT_ID },
        select: { id: true, posApiUrl: true, posApiKey: true, orderNotifyPhones: true },
      });
      if (!sandboxTenant) {
        return { ok: false, mesaj: 'Demo ortamı hazır değil, lütfen tekrar deneyin.' };
      }
      if (
        sandboxTenant.posApiUrl ||
        sandboxTenant.posApiKey ||
        (sandboxTenant.orderNotifyPhones?.length ?? 0) > 0
      ) {
        logger.error(
          { tenantId: SANDBOX_TENANT_ID },
          'GÜVENLİK: sandbox tenant izole değil (POS/bildirim alanları dolu) — sipariş REDDEDİLDİ',
        );
        return { ok: false, mesaj: 'Demo ortamı şu anda kullanılamıyor.' };
      }
    }

    // Sandbox'ta sentetik numara (gerçek telefon TOPLANMAZ). Restoran modunda
    // yukarıda normalize edilen numara — POS bu numarayı müşteri kaydına bağlar.
    const syntheticPhone = tenantMode ? phoneDigits : `sandbox:${session.id}`;
    // update dalı customerName YAZMAZ: sesli arayan, numarasını verdiği kişinin
    // mevcut WhatsApp konuşmasındaki kayıtlı adını değiştirememeli (ad yine de
    // siparişin kendi customerName alanına yazılır).
    const conversation = await prisma.conversation.upsert({
      where: { tenantId_customerPhone: { tenantId: session.tenantId, customerPhone: syntheticPhone } },
      update: { lastMessageAt: new Date() },
      create: {
        tenantId: session.tenantId,
        customerPhone: syntheticPhone,
        customerName,
        status: 'CLOSED', // Ajan kuyruğunu kirletmesin
        phase: 'ORDER_CONFIRMED',
      },
    });

    const total = cartTotal(session);
    const notes = [
      tenantMode
        ? '[VOICE] Sesli asistan — telefon siparişi' // pushOrder baştaki [VOICE] imzasından source üretir
        : 'SESLİ DEMO SİPARİŞİ (ai-sandbox) — gerçek teslimat yok',
      deliveryType === 'DELIVERY' ? 'Adrese teslim' : 'Gel al',
      extraNote,
      // Aynı numaranın kayıtlı müşteri adı korunur (sipariş o adla düşer);
      // arayan farklı bir ad verdiyse mutfak karışmasın diye nota yazılır.
      tenantMode && conversation.customerName && conversation.customerName !== customerName
        ? `Arayan adı: ${customerName}`
        : null,
    ]
      .filter(Boolean)
      .join(' | ');

    const draft = await prisma.order.create({
      data: {
        tenantId: session.tenantId,
        conversationId: conversation.id,
        status: 'DRAFT',
        totalPrice: total,
        deliveryType,
        notes,
        customerName,
        ...(tenantMode ? { customerPhone: syntheticPhone } : {}),
        items: {
          create: session.cart.map((line) => ({
            menuItemId: line.menuItemId,
            menuItemName: line.name,
            qty: line.qty,
            unitPrice: line.unitPrice,
            notes: line.notes,
          })),
        },
      },
    });

    if (tenantMode) {
      // Sayaç hemen artar: yanıt döner dönmez model tekrar çağırsa bile ikinci
      // sipariş açılamaz (placedOrder guard'ı + bu sayaç birlikte korur).
      session.orderCount += 1;
      // Müşteriyi BEKLETME: sipariş DRAFT olarak yazıldı, numaralandırma ve
      // POS aktarımı arkaplanda tamamlanır. whatres'in iç sipariş numarası
      // müşteriye SÖYLENMEZ — POS kendi numarasını verir, ikisi farklıdır
      // (canlı testte "numaranız 2" dendi, POS'ta #2037 göründü).
      session.placedOrder = { orderId: draft.id, orderNumber: null, total };
      voiceLog(session, 'sistem', 'Sipariş DRAFT yazıldı, POS aktarımı arkaplanda', {
        orderId: draft.id,
        total,
      });
      void orderService
        .setPendingConfirmation(session.tenantId, draft.id, {
          deliveryAddress: address || undefined,
          paymentMethod,
          notes,
        })
        .then((placed) => {
          session.placedOrder = { orderId: placed.id, orderNumber: placed.orderNumber, total };
          voiceLog(session, 'sistem', 'Sipariş POS hattına iletildi', {
            orderNumber: placed.orderNumber,
          });
          logger.info(
            { sessionId: session.id, orderId: placed.id, orderNumber: placed.orderNumber, total, tenantId: session.tenantId },
            'Sesli asistan siparişi oluşturuldu (gerçek kiracı)',
          );
        })
        .catch((error) => {
          voiceLog(session, 'sistem', 'SİPARİŞ AKTARIMI BAŞARISIZ — DRAFT beklemede', {
            orderId: draft.id,
          });
          logger.error(
            { error, sessionId: session.id, orderId: draft.id, tenantId: session.tenantId },
            'Sesli asistan siparişi POS hattına AKTARILAMADI (DRAFT kaldı)',
          );
        });

      return {
        ok: true,
        mesaj: `Sipariş alındı, toplam ${total} TL. Müşteriye sipariş numarası söyleme; "siparişiniz alındı, hazırlanmaya başlıyor" diyerek kapat.`,
        siparis_no: null,
        toplam: total,
        sepet: cartView(session),
      };
    }

    // Sandbox: numara verir, mağaza atar, POS push'unu DENER (posApiUrl null
    // olduğu için erken döner), orderNotifyPhones boş olduğu için bildirimsiz.
    const placed = await orderService.setPendingConfirmation(session.tenantId, draft.id, {
      deliveryAddress: address || undefined,
      paymentMethod,
      notes,
    });

    session.placedOrder = { orderId: placed.id, orderNumber: placed.orderNumber, total };
    // Sandbox'ta sayaç başarıdan SONRA artar: senkron hat hata verirse müşteri
    // (demo kullanıcısı) ikinci kez deneyebilsin.
    session.orderCount += 1;

    logger.info(
      { sessionId: session.id, orderId: placed.id, orderNumber: placed.orderNumber, total, tenantId: session.tenantId },
      'Sesli demo siparişi oluşturuldu (izole sandbox tenant)',
    );

    return {
      ok: true,
      mesaj: `Sipariş alındı. Sipariş numarası ${placed.orderNumber}, toplam ${total} TL.`,
      siparis_no: placed.orderNumber,
      toplam: total,
      sepet: cartView(session),
    };
  }
}

export const voiceSandboxService = new VoiceSandboxService();
