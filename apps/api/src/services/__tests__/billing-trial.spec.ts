/**
 * 15 günlük deneme kapsamı (15.09.2026 işletmeci kararı): deneme YALNIZ kendisi
 * kaydolan işletmeye. OtOrder POS'a bağlı kiracı (Pro AI ödemesi OtOrder'da)
 * denemeye düşerse 15. günde abonelik EXPIRED olur ve WhatsApp botu kapanır.
 * Run: node scripts/test-api.mjs
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import prismaClient from '../../db/prisma';
import type { FakePrisma } from './fakes/prisma';
import { billingService } from '../billing.service';
import { provisionFromOtorder } from '../otorder-sso.service';

const fake = prismaClient as unknown as FakePrisma;
afterEach(() => fake.__reset());

function kur(posApiUrl: string | null) {
  let created: any = null;
  fake.__handlers.subscription = {
    findUnique: async () => created,
    upsert: async (a: any) => {
      const now = new Date();
      created = {
        id: 'sub-1',
        billingCycle: 'MONTHLY',
        ordersUsed: 0,
        messagesUsed: 0,
        usageResetAt: now,
        autoRenew: true,
        cancelAtPeriodEnd: false,
        cancelledAt: null,
        iyzicoSubscriptionRef: null,
        iyzicoCustomerRef: null,
        createdAt: now,
        updatedAt: now,
        ...a.create,
      };
      return created;
    },
  };
  fake.__handlers.tenant = { findUnique: async () => ({ posApiUrl }) };
  return () => created;
}

test('kendisi kaydolan işletme (POS bağlantısı yok): 15 günlük tam erişimli TRIAL', async () => {
  const al = kur(null);
  await billingService.getOrCreateSubscription('t-kendi');
  const s = al();
  assert.equal(s.plan, 'TRIAL');
  assert.ok(s.trialEndsAt instanceof Date, 'deneme bitiş tarihi olmalı');
  const gun = (s.trialEndsAt.getTime() - Date.now()) / 86400000;
  assert.ok(gun > 14.9 && gun <= 15.01, `deneme ~15 gün olmalı, ${gun.toFixed(2)} gün`);
});

test("OtOrder POS'a bağlı kiracı: süresiz SILVER, deneme YOK (bot 15. günde kapanmasın)", async () => {
  const al = kur('https://makti.otorder.com');
  await billingService.getOrCreateSubscription('t-otorder');
  const s = al();
  assert.equal(s.plan, 'SILVER');
  assert.equal(s.trialEndsAt, null);
  assert.equal(s.status, 'ACTIVE');
});

test('OtOrder SSO provizyonu aboneliği açılışta süresiz SILVER yazar', async () => {
  fake.__handlers.tenant = { findUnique: async () => null, create: async () => ({ id: 't-sso' }) };
  fake.__handlers.user = { create: async () => ({ id: 'u-sso' }) };
  await provisionFromOtorder({
    token: 'tok',
    tenantId: '',
    tenantName: 'Maktı',
    subdomain: 'makti',
    role: 'OWNER',
    userName: 'Sahip',
    email: 'sahip@example.com',
  });
  const c = fake.__calls.find((x) => x.model === 'subscription' && x.method === 'create');
  assert.ok(c, 'abonelik oluşturulmalı');
  assert.equal(c.args.data.tenantId, 't-sso');
  assert.equal(c.args.data.plan, 'SILVER');
  assert.equal(c.args.data.trialEndsAt, null);
});
