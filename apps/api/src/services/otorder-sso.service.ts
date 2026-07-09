// ============================================================================
// OtOrder SSO + oto-provizyon — whatsapp.otorder.com girişini OtOrder'a delege eder.
// ============================================================================
// OtOrder'da "Pro AI" (whatsappAI feature) paketi olan restoran sahibi buraya
// POS e-posta+şifresiyle girer:
//   1. Yerel şifre tutmaz — kimlik her girişte OtOrder /api/auth/login'e sorulur.
//   2. İlk girişte tenant+user+membership+store otomatik açılır (provizyon).
//   3. OtOrder POS bağlantısı (IntegrationPartner + API key) otomatik kurulur,
//      menü senkronu arka planda başlar — "2 proje otomatik bağlanır".
// Şifre SAKLANMAZ; yalnız anlık doğrulama için OtOrder'a iletilir.

import bcrypt from 'bcrypt';
import crypto from 'crypto';
import prisma from '../db/prisma';
import { createLogger } from '../logger';
import { posIntegrationService } from './pos-integration.service';

const logger = createLogger();
const OTORDER_API = process.env.OTORDER_API_BASE || 'https://api.otorder.com';
const TIMEOUT = () => AbortSignal.timeout(12000);

export interface OtorderIdentity {
  token: string;
  tenantId: string; // OtOrder tenant id
  tenantName: string;
  subdomain: string;
  role: string;
  userName: string;
  email: string;
}

/** OtOrder'a e-posta+şifreyle giriş. Başarısızsa null (yerel hata mesajı korunur). */
export async function otorderLogin(email: string, password: string): Promise<OtorderIdentity | null> {
  let data: any;
  try {
    let res = await fetch(`${OTORDER_API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: TIMEOUT(),
    });
    data = await res.json().catch(() => ({}));
    // Çok üyelikli kullanıcı: ilk üyelikle tekrar dene
    if (data?.requiresTenantSelection && Array.isArray(data.memberships) && data.memberships.length > 0) {
      res = await fetch(`${OTORDER_API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, tenantId: data.memberships[0].tenantId }),
        signal: TIMEOUT(),
      });
      data = await res.json().catch(() => ({}));
    }
    if (!res.ok) return null;
  } catch {
    return null; // OtOrder'a ulaşılamadı — yerel giriş hatası aynen döner
  }
  const t = data?.user?.tenant;
  if (!data?.token || !t?.subdomain) return null;
  // Yalnız sahip/yönetici delege girişi yapabilir (garson PIN'leri buraya ait değil)
  if (!['OWNER', 'ADMIN'].includes(String(data.user.role))) return null;
  return {
    token: data.token,
    tenantId: t.tenantId,
    tenantName: t.tenantName || 'Restoran',
    subdomain: t.subdomain,
    role: data.user.role,
    userName: data.user.name || 'Restoran Sahibi',
    email: data.user.email,
  };
}

/** Tenant'ın OtOrder plan özellikleri (whatsappAI: Pro AI paneli; whatsappLink: modül bağlama izni). */
export async function otorderPlanFeatures(token: string): Promise<{ whatsappAI: boolean; whatsappLink: boolean; planKey?: string }> {
  try {
    const [subRes, plansRes] = await Promise.all([
      fetch(`${OTORDER_API}/api/platform/billing/subscription`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: TIMEOUT(),
      }),
      fetch(`${OTORDER_API}/api/platform/billing/plans`, { signal: TIMEOUT() }),
    ]);
    const sub = (await subRes.json().catch(() => ({}))) as any;
    const plans = (await plansRes.json().catch(() => ({}))) as any;
    const planKey = sub?.subscription?.plan?.key as string | undefined;
    const plan = (plans?.plans || []).find((p: any) => p.key === planKey);
    return { whatsappAI: !!plan?.features?.whatsappAI, whatsappLink: !!plan?.features?.whatsappLink, planKey };
  } catch {
    return { whatsappAI: false, whatsappLink: false };
  }
}

/** Tenant'ın OtOrder planında whatsappAI özelliği var mı? (SSO panel erişim kapısı) */
export async function otorderHasAIPlan(token: string): Promise<{ ok: boolean; planKey?: string }> {
  const f = await otorderPlanFeatures(token);
  return { ok: f.whatsappAI, planKey: f.planKey };
}

/**
 * OtOrder POS bağlantısını kur: partner + API key üret, tenant'a yaz.
 * Menü senkronu ARKA PLANDA başlar (girişi bekletmez). connect-otorder
 * route'u ile aynı çekirdek — token zaten elimizde olduğundan şifre gerekmez.
 */
export async function connectOtorderWithToken(
  whatresTenantId: string,
  subdomain: string,
  otorderToken: string,
): Promise<void> {
  const base = `https://${subdomain}.otorder.com`;
  const webhookUrl = `${process.env.APP_BASE_URL || ''}${process.env.API_PREFIX || '/api'}/webhooks/pos/${whatresTenantId}`;
  const connectRes = await fetch(`${base}/api/integrations/whatsapp/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${otorderToken}` },
    body: JSON.stringify({ webhookUrl }),
    signal: TIMEOUT(),
  });
  const connectData = (await connectRes.json().catch(() => ({}))) as any;
  if (!connectRes.ok || !connectData?.config?.posApiKey) {
    throw new Error(connectData?.error || 'OtOrder bağlantısı kurulamadı');
  }
  // posApiUrl BASE olmalı — pos-integration.service "/api/external/..." kendisi ekler
  const posBaseUrl = String(connectData.config.posApiUrl || '').replace(/\/api\/external\/?$/, '');
  await prisma.tenant.update({
    where: { id: whatresTenantId },
    data: { posApiUrl: posBaseUrl, posApiKey: connectData.config.posApiKey },
  });
  logger.info({ whatresTenantId, subdomain }, 'OtOrder bağlantısı kuruldu (SSO)');
  // İlk menü senkronu — girişi bekletme, hata bağlantıyı bozmaz
  posIntegrationService
    .pullMenu(whatresTenantId)
    .then(() => logger.info({ whatresTenantId }, 'OtOrder ilk menü senkronu tamam'))
    .catch((e) => logger.warn({ error: e, whatresTenantId }, 'OtOrder ilk menü senkronu başarısız — sonra tekrar denenebilir'));
}

/** Türkçe karakterleri sadeleştirip benzersiz slug üret. */
async function uniqueSlug(nameOrSub: string): Promise<string> {
  const turkishMap: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', İ: 'i', Ö: 'o', Ş: 's', Ü: 'u' };
  let base = nameOrSub
    .replace(/[çğıöşüÇĞİÖŞÜ]/g, (ch) => turkishMap[ch] || ch)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
  if (base.length < 2) base = 'isletme';
  let slug = base;
  let attempt = 0;
  while (await prisma.tenant.findUnique({ where: { slug } })) {
    attempt++;
    slug = `${base}-${attempt}`;
  }
  return slug;
}

/**
 * İlk giriş provizyonu: user + tenant + OWNER membership + varsayılan mağaza.
 * Yerel şifre rastgeledir ve kullanılmaz (giriş her zaman OtOrder'a delege).
 * SILVER aboneliği billing getOrCreateSubscription ile lazily açılır.
 */
export async function provisionFromOtorder(identity: OtorderIdentity): Promise<{ userId: string; tenantId: string }> {
  const slug = await uniqueSlug(identity.subdomain || identity.tenantName);
  const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 12);

  const result = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: { name: identity.tenantName, slug },
    });
    const user = await tx.user.create({
      data: { email: identity.email, passwordHash, name: identity.userName },
    });
    await tx.membership.create({
      data: { tenantId: tenant.id, userId: user.id, role: 'OWNER' },
    });
    // Varsayılan mağaza — yoksa areAllStoresClosed tüm siparişleri bloklar
    await tx.store.create({
      data: {
        tenantId: tenant.id,
        name: `${identity.tenantName} Merkez`,
        address: 'Merkez',
        lat: 41.0082,
        lng: 28.9784,
        isActive: true,
        isOpen: true,
      },
    });
    return { userId: user.id, tenantId: tenant.id };
  });
  logger.info({ ...result, subdomain: identity.subdomain }, 'OtOrder SSO provizyonu tamam');
  return result;
}
