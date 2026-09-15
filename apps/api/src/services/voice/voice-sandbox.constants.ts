/**
 * OtOrder AI — "numarasız sesli sipariş" kanıt demosu (Adım 1).
 *
 * GÜVENLİK SINIRI — BU DOSYA TEK GERÇEK KAYNAKTIR:
 * Bu demonun ürettiği HER kayıt yalnızca izole sandbox tenant'ına yazılır.
 * Tenant id KODDA SABİTTİR ve hiçbir HTTP isteğinden okunmaz. Sandbox tenant'ı
 * posApiUrl/posApiKey alanları NULL olacak şekilde bootstrap edilir; böylece
 * pos-integration.service.ts -> pushOrder() erken döner ve sipariş hiçbir POS'a
 * (highfive dahil) gitmez. orderNotifyPhones da boş bırakılır; order.service.ts
 * -> sendOrderNotification() erken döner, WhatsApp'a tek mesaj bile çıkmaz.
 */
export const SANDBOX_TENANT_ID = 'ai-sandbox';
export const SANDBOX_TENANT_SLUG = 'ai-sandbox';
export const SANDBOX_TENANT_NAME = 'OtOrder AI Sandbox (Demo)';

/** Realtime her zaman gerçek OpenAI'a gider. config.openai.baseUrl yerel bir
 *  Ollama/Qwen adresi olabilir (llm-extractor bunu kullanıyor) — realtime için
 *  ASLA kullanılmaz. */
export const OPENAI_REALTIME_BASE_URL = 'https://api.openai.com/v1';
export const REALTIME_MODEL = process.env.VOICE_REALTIME_MODEL || 'gpt-realtime';
export const REALTIME_VOICE = process.env.VOICE_REALTIME_VOICE || 'marin';

/** Asistanın oturum başına RASTGELE seçilen adı için havuz. Varsayılan havuz
 *  seçili sesin cinsiyetine uyar (cedar erkek, marin kadın vb.);
 *  VOICE_ASSISTANT_NAMES="Elif,Emre,..." ile tamamen ezilebilir. */
const FEMALE_VOICES = ['marin', 'coral', 'sage', 'shimmer'];
const DEFAULT_ASSISTANT_NAMES = FEMALE_VOICES.includes(REALTIME_VOICE)
  ? ['Elif', 'Zeynep', 'Selin', 'Defne', 'Merve', 'Ece', 'İrem', 'Deniz']
  : ['Emre', 'Mert', 'Can', 'Kaan', 'Burak', 'Onur', 'Arda', 'Deniz'];
const envAssistantNames = (process.env.VOICE_ASSISTANT_NAMES || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
export const ASSISTANT_NAMES = envAssistantNames.length ? envAssistantNames : DEFAULT_ASSISTANT_NAMES;

// ==================== MALİYET FRENLERİ ====================

const num = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** Bir oturumun sunucu tarafında geçerli kaldığı süre. Süre dolunca tool
 *  çağrıları reddedilir -> model artık sepeti değiştiremez / sipariş veremez. */
export const MAX_SESSION_SECONDS = num(process.env.VOICE_MAX_SESSION_SECONDS, 180);
/** Ephemeral anahtarın kullanılabilir kalma süresi (oturum başlatmak için). */
export const CLIENT_SECRET_TTL_SECONDS = num(process.env.VOICE_CLIENT_SECRET_TTL, 60);
/** Oturum başına toplam fonksiyon çağrısı tavanı. */
export const MAX_TOOL_CALLS_PER_SESSION = num(process.env.VOICE_MAX_TOOL_CALLS, 40);
/** Oturum başına verilebilecek sipariş tavanı. */
export const MAX_ORDERS_PER_SESSION = 1;
/** Aynı anda açık olabilecek oturum sayısı (global). */
export const MAX_CONCURRENT_SESSIONS = num(process.env.VOICE_MAX_CONCURRENT, 20);
/** Günlük toplam oturum tavanı (global, UTC gününe göre sıfırlanır). */
export const MAX_SESSIONS_PER_DAY = num(process.env.VOICE_MAX_SESSIONS_PER_DAY, 200);
/** IP başına oturum açma limiti (rate limiter penceresi). */
export const SESSIONS_PER_IP_WINDOW_MS = num(process.env.VOICE_IP_WINDOW_MS, 10 * 60 * 1000);
export const SESSIONS_PER_IP_MAX = num(process.env.VOICE_IP_MAX_SESSIONS, 8);
/** Tek yanıtın token tavanı (uzun/pahalı monologları keser). */
export const MAX_OUTPUT_TOKENS = num(process.env.VOICE_MAX_OUTPUT_TOKENS, 700);
/** Sepette taşınabilecek en fazla kalem / adet. */
export const MAX_CART_LINES = 20;
export const MAX_QTY_PER_LINE = 20;

/**
 * Sesli asistanın GERÇEK sipariş alabileceği kiracılar (slug, virgülle ayrık).
 * Boşsa tenant modu tamamen kapalıdır; /demo her zaman izole sandbox'ta çalışır.
 * Örn: VOICE_TENANT_SLUGS="test,makti"
 */
export const VOICE_TENANT_SLUGS = (process.env.VOICE_TENANT_SLUGS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/** Gerçek restoran oturumunun süresi — canlı siparişte adres+telefon almak 3 dk'ya sığmıyor. */
export const TENANT_MAX_SESSION_SECONDS = num(process.env.VOICE_TENANT_MAX_SESSION_SECONDS, 420);
/** Restoran hattının kotaları demo kotalarından AYRIDIR: yoğun demo trafiği
 *  (ya da ucuz bir saldırı) gerçek sipariş hattını gün boyu kapatamamalı. */
export const TENANT_MAX_CONCURRENT_SESSIONS = num(process.env.VOICE_TENANT_MAX_CONCURRENT, 10);
export const TENANT_MAX_SESSIONS_PER_DAY = num(process.env.VOICE_TENANT_MAX_SESSIONS_PER_DAY, 500);
