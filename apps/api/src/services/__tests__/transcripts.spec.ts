/**
 * Regression specs reproducing the High Five (Akcakoca) production failures.
 *
 *   A 12.09 — "Sandvic istiyoruz, sade, icinde sadece mozerella olacak": the
 *             negative-constraint gate parked the chat in PENDING_AGENT, the bot
 *             went silent, nobody answered, the order was lost.
 *   B 30.08 — after Onayla → Paket Servis, "Hayalim kent e gidecek" and "Yanlis
 *             oldu" each ADDED a 2'li Pizza Menu; the IBAN question was ignored.
 *   C 28.08 — out-of-area pin, "Size cok yakin nasil yani" added a bundle again;
 *             the only way out was "farkli konum gonderin veya iptal yazin".
 * Plus the operator requirement: a written address instead of a pin must work.
 *
 * Everything runs against the real flow/orchestrator code with an in-memory
 * Prisma fake and stubbed WhatsApp/LLM services. Run: node scripts/test-api.mjs
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import prismaClient from '../../db/prisma';
import type { FakePrisma } from './fakes/prisma';
import { conversationFlowService } from '../conversation-flow.service';
import { nluOrchestratorService } from '../nlu/orchestrator.service';
import { inboxService } from '../inbox.service';
import { whatsappService } from '../whatsapp.service';
import { billingService } from '../billing.service';
import { storeService } from '../store.service';
import { geoService } from '../geo.service';
import { orderService } from '../order.service';
import { orderPaymentService } from '../order-payment.service';
import { savedAddressService } from '../saved-address.service';
import { menuCandidateService } from '../nlu/menu-candidate.service';
import { llmExtractorService } from '../nlu/llm-extractor.service';
import { preferencesService } from '../nlu/preferences.service';
import { intentAnalysisService } from '../nlu/intent-analysis.service';
import { modelRouterService } from '../ai/model-router.service';
import { claudeClientService } from '../ai/claude-client.service';
import { trainingCaptureService } from '../ai/training-capture.service';
import { TYPED_ADDRESS_NOTE } from '../message-templates';
import type { GeoCheckResult, MessageDto, WhatsAppWebhookPayload } from '@whatres/shared';

const fake = prismaClient as unknown as FakePrisma;

// ---------------------------------------------------------------- helpers

const restores: Array<() => void> = [];
function stub(obj: object, key: string, impl: (...args: any[]) => unknown): Array<any[]> {
  const target = obj as Record<string, unknown>;
  if (typeof target[key] !== 'function') throw new Error(`cannot stub ${key}`);
  const orig = target[key];
  const calls: Array<any[]> = [];
  target[key] = (...args: any[]) => {
    calls.push(args);
    return impl(...args);
  };
  restores.push(() => {
    target[key] = orig;
  });
  return calls;
}
afterEach(() => {
  while (restores.length) restores.pop()!();
  fake.__reset();
});

const TWO_PIZZA = {
  menuItemId: 'mi-2li',
  menuItemName: "2'li Pizza Menü",
  qty: 1,
  unitPrice: 1060,
  optionsJson: [{ groupName: '1. Pizza', optionName: 'Margarita', priceDelta: 0 }],
  extrasJson: null,
  notes: null,
};

type Sent = { method: string; body: string; buttons?: Array<{ id: string; title: string }> };

interface FlowSetup {
  phase: string;
  order?: any | null;
  conv?: Record<string, unknown>;
  geoCheck?: GeoCheckResult | null;
  checkServiceArea?: GeoCheckResult;
  lock?: unknown;
  assignment?: unknown;
  candidates?: Array<{ menuItemId: string; name: string; score: number }>;
  nlu?: (...args: any[]) => unknown;
  messageFindFirst?: (args: any) => unknown;
  tenant?: Record<string, unknown> | null;
}

function draftOrder(extra: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    tenantId: 't1',
    conversationId: 'c1',
    status: 'DRAFT',
    createdAt: new Date(Date.now() - 20 * 60 * 1000),
    deliveryType: 'DELIVERY',
    deliveryAddress: null,
    discountPercent: null,
    discountAmount: null,
    totalPrice: 1060,
    notes: null,
    items: [{ ...TWO_PIZZA }],
    ...extra,
  };
}

function setupFlow(s: FlowSetup) {
  const sent: Sent[] = [];
  const order = s.order === undefined ? draftOrder() : s.order;
  const conv: Record<string, any> = {
    id: 'c1',
    tenantId: 't1',
    phase: s.phase,
    status: 'OPEN',
    customerPhone: '905551112233',
    kvkkConsentAt: new Date(),
    activeOrderId: order ? order.id : null,
    flowSubState: null,
    flowMetadata: null,
    ...s.conv,
  };

  stub(inboxService, 'getConversationRaw', async () => conv);
  const phaseUpdates = stub(
    inboxService,
    'updateConversationPhase',
    async (_t: string, _c: string, phase: string, orderId?: string | null) => {
      conv.phase = phase;
      if (orderId !== undefined) conv.activeOrderId = orderId;
    }
  );
  stub(inboxService, 'getConversationGeoCheck', async () => s.geoCheck ?? null);
  stub(inboxService, 'updateConversationGeoCheck', async () => undefined);
  stub(billingService, 'isSubscriptionActive', async () => ({ active: true }));
  stub(storeService, 'areAllStoresClosed', async () => false);
  stub(orderService, 'findActiveOrderForConversation', async () => null);
  stub(savedAddressService, 'getByCustomerPhone', async () => []);
  stub(menuCandidateService, 'findCandidates', async () =>
    (s.candidates ?? []).map((c) => ({ category: 'x', basePrice: 50, synonymsMatched: [], ...c }))
  );
  stub(geoService, 'getTypedAddressTerms', async () => ({
    store: { id: 's1', name: 'High Five', phone: '03745550000' },
    deliveryFee: 0,
    minBasket: 100,
    maxRadiusKm: 3,
  }));
  if (s.checkServiceArea) stub(geoService, 'checkServiceArea', async () => s.checkServiceArea);

  stub(whatsappService, 'sendText', async (_t: string, _c: string, body: string) => {
    sent.push({ method: 'sendText', body });
  });
  stub(whatsappService, 'sendLocationRequest', async (_t: string, _c: string, body: string) => {
    sent.push({ method: 'sendLocationRequest', body });
  });
  stub(
    whatsappService,
    'sendInteractiveButtons',
    async (_t: string, _c: string, body: string, buttons: any) => {
      sent.push({ method: 'sendInteractiveButtons', body, buttons });
    }
  );
  stub(whatsappService, 'sendListMessage', async (_t: string, _c: string, body: string) => {
    sent.push({ method: 'sendListMessage', body });
  });

  const nluCalls = stub(
    nluOrchestratorService,
    'processMessage',
    s.nlu ??
      (async () => {
        // What production did for non-order text: another bundle in the cart.
        if (order) {
          order.items.push({ ...TWO_PIZZA });
          order.totalPrice += 1060;
        }
        return {
          success: true,
          draftOrderId: order?.id,
          itemsExtracted: true,
          confirmationMessage: 'Siparisiniz: ...',
        };
      })
  );

  fake.__handlers.conversationLock = { findUnique: async () => s.lock ?? null };
  fake.__handlers.conversationAssignment = { findUnique: async () => s.assignment ?? null };
  fake.__handlers.tenant = { findUnique: async () => s.tenant ?? null };
  fake.__handlers.message = {
    findFirst: async (a: any) => (s.messageFindFirst ? s.messageFindFirst(a) : null),
  };
  fake.__handlers.order = {
    findFirst: async (a: any) => {
      const st = a?.where?.status;
      if (!order || (st && typeof st === 'object')) return null;
      if (a?.where?.id && a.where.id !== order.id) return null;
      return !st || st === order.status ? order : null;
    },
    update: async (a: any) => {
      const { items, ...rest } = a.data;
      Object.assign(order, rest);
      if (items?.create) order.items = items.create.map((i: any) => ({ ...i }));
      return order;
    },
  };
  fake.__handlers.conversation = {
    update: async (a: any) => Object.assign(conv, a.data),
    updateMany: async (a: any) => {
      if (a.where?.status && a.where.status !== conv.status) return { count: 0 };
      Object.assign(conv, a.data);
      return { count: 1 };
    },
    findUnique: async () => ({ flowMetadata: conv.flowMetadata }),
  };

  return { sent, conv, order, nluCalls, phaseUpdates };
}

let msgSeq = 0;
function send(text: string, payload: Partial<WhatsAppWebhookPayload> = {}, kind = 'TEXT') {
  const message = { id: `m${++msgSeq}`, kind, text, direction: 'IN' } as unknown as MessageDto;
  return conversationFlowService.handleIncomingMessage(
    't1',
    'c1',
    message,
    payload as WhatsAppWebhookPayload
  );
}
function tap(buttonId: string, title: string) {
  return send(title, {
    interactive: { type: 'button_reply', buttonReply: { id: buttonId, title } },
  } as any);
}
const said = (sent: Sent[], re: RegExp) => sent.some((m) => re.test(m.body));
const bodies = (sent: Sent[]) => JSON.stringify(sent.map((m) => m.body));
const writes = (model: string, method: string) =>
  fake.__calls.filter((c) => c.model === model && c.method === method);

const OUT_OF_AREA: GeoCheckResult = {
  isWithinServiceArea: false,
  nearestStore: {
    id: 's1',
    tenantId: 't1',
    name: 'High Five',
    address: null,
    lat: 41.08,
    lng: 31.12,
    phone: '03745550000',
    isActive: true,
    isOpen: true,
    createdAt: '',
    updatedAt: '',
  },
  distance: 4.2,
  deliveryRule: null,
  alternativeStores: [],
  message: 'Maalesef bu bölgeye hizmet veremiyoruz.',
  reason: 'OUT_OF_RADIUS',
  maxRadiusKm: 3,
};
// A pin sent after the draft was created → the stored geo check is for THIS order
const freshPin = (a: any) => (a?.where?.kind === 'LOCATION' ? { createdAt: new Date() } : null);

// ---------------------------------------------------------------- B (30.08)

test('B: "Hayalim kent e gidecek" in LOCATION_REQUEST is taken as the written address, never as an order', async () => {
  const s = setupFlow({ phase: 'LOCATION_REQUEST' });
  await send('Hayalim kent e gidecek');
  assert.equal(s.nluCalls.length, 0, 'address text must not reach the NLU');
  assert.equal(s.order.items.length, 1, `items grew; bot said: ${bodies(s.sent)}`);
  assert.equal(s.order.deliveryAddress, 'Hayalim kent e gidecek');
  assert.ok(
    String(s.order.notes).startsWith(TYPED_ADDRESS_NOTE),
    'staff flag must be the first note'
  );
  assert.ok(said(s.sent, /Teslimat adresiniz/), bodies(s.sent));
  assert.ok(!said(s.sent, /Eklendi|Guncellendi/));
  assert.equal(s.conv.phase, 'ADDRESS_COLLECTION');
  assert.equal(s.conv.customerLat, null, 'stale pin coordinates are cleared');
});

test('B: "Yanlış oldu" shows the cart and re-asks the location — no NLU, no addition, no cancel', async () => {
  const s = setupFlow({ phase: 'LOCATION_REQUEST' });
  await send('Yanlış oldu');
  assert.equal(s.nluCalls.length, 0);
  assert.equal(s.order.items.length, 1);
  assert.equal(s.order.status, 'DRAFT');
  assert.ok(said(s.sent, /Siparisinizde su an bunlar var/), bodies(s.sent));
  assert.ok(s.sent.some((m) => m.method === 'sendLocationRequest'));
});

test('B: typed address confirmed → payment buttons, no save prompt (a written address has no coordinates)', async () => {
  const s = setupFlow({ phase: 'LOCATION_REQUEST' });
  await send('Hayalim kent e gidecek');
  await tap('address_confirm', 'Evet, Dogru');
  assert.equal(s.conv.phase, 'PAYMENT_METHOD_SELECTION');
  assert.ok(
    s.sent.some((m) => m.buttons?.some((b) => b.id === 'pay_cash')),
    bodies(s.sent)
  );
  assert.ok(!s.sent.some((m) => m.buttons?.some((b) => b.id === 'save_address_yes')));
});

test('B: first message with products AND "İban ve ödeyeceğim miktarı" gets the cart plus a payment answer', async () => {
  const s = setupFlow({
    phase: 'IDLE',
    order: null,
    nlu: async () => ({
      success: true,
      draftOrderId: 'o1',
      itemsExtracted: true,
      confirmationMessage: "Siparisiniz:\n\n  1x 2'li Pizza Menü",
    }),
  });
  const created = draftOrder();
  fake.__handlers.order.findFirst = async (a: any) =>
    a?.where?.id === 'o1' || a?.where?.status === 'DRAFT' ? created : null;
  await send("2'li pizza menü istiyorum. İban ve ödeyeceğim miktarı yazar mısınız");
  assert.ok(
    s.sent.some((m) => m.method === 'sendInteractiveButtons' && /Siparisiniz/.test(m.body))
  );
  assert.ok(said(s.sent, /Sepet tutariniz: 1060\.00 TL/), bodies(s.sent));
  assert.ok(said(s.sent, /IBAN \/ havale \/ EFT ile odeme almiyoruz/));
});

test('B: an explicit mid-flow addition still works and "geri al" restores the cart exactly', async () => {
  const s = setupFlow({
    phase: 'LOCATION_REQUEST',
    candidates: [{ menuItemId: 'mi-kola', name: 'Kola', score: 0.8 }],
  });
  s.nluCalls.length = 0;
  stub(nluOrchestratorService, 'processMessage', async () => {
    s.order.items.push({
      menuItemId: 'mi-kola',
      menuItemName: 'Kola',
      qty: 1,
      unitPrice: 50,
      optionsJson: null,
      extrasJson: null,
      notes: null,
    });
    s.order.totalPrice = 1110;
    return {
      success: true,
      draftOrderId: 'o1',
      itemsExtracted: true,
      confirmationMessage: 'Siparisiniz: ...',
    };
  });
  await send('bir de kola ekle');
  assert.equal(s.order.items.length, 2);
  assert.ok(said(s.sent, /Guncellendi/) && said(s.sent, /geri al/), bodies(s.sent));

  await send('Yanlış oldu');
  assert.equal(s.order.items.length, 1, bodies(s.sent));
  assert.equal(s.order.items[0].menuItemId, 'mi-2li');
  assert.equal(s.order.totalPrice, 1060);
  assert.ok(said(s.sent, /son degisiklik geri alindi/));
  assert.equal(s.conv.phase, 'LOCATION_REQUEST');
});

// ---------------------------------------------------------------- C (28.08)

test('C: out-of-area pin offers Gel Al / another pin / written address in one message', async () => {
  const s = setupFlow({
    phase: 'LOCATION_REQUEST',
    checkServiceArea: OUT_OF_AREA,
    tenant: { pickupDiscountPercent: 10 },
  });
  await send(
    'Location shared',
    { location: { latitude: 41.2, longitude: 31.3 } } as any,
    'LOCATION'
  );
  const msg = s.sent.find((m) => m.method === 'sendInteractiveButtons');
  assert.ok(msg, bodies(s.sent));
  assert.deepEqual(
    msg!.buttons!.map((b) => b.id),
    ['oos_pickup', 'oos_new_location', 'oos_type_address']
  );
  assert.match(msg!.body, /4\.2 km/);
  assert.ok(!/iptal.*yazin\.?$/.test(msg!.body.split('\n')[0]));
  assert.equal(s.nluCalls.length, 0);
});

test('C: "Size çok yakın nasıl yani" after an out-of-area pin gets an explanation + options, cart unchanged', async () => {
  const s = setupFlow({
    phase: 'LOCATION_REQUEST',
    geoCheck: OUT_OF_AREA,
    messageFindFirst: freshPin,
  });
  await send('Size çok yakın nasıl yani');
  assert.equal(s.nluCalls.length, 0);
  assert.equal(s.order.items.length, 1);
  const msg = s.sent.find((m) => m.method === 'sendInteractiveButtons');
  assert.ok(msg && /Haklisiniz/.test(msg.body), bodies(s.sent));
  assert.ok(msg!.buttons!.some((b) => b.id === 'oos_pickup'));
  assert.ok(!said(s.sent, /kabul edemiyoruz/));
});

test('C: "Gel Al\'a Gec" keeps the cart, applies the pickup discount once, goes to payment', async () => {
  const s = setupFlow({
    phase: 'LOCATION_REQUEST',
    geoCheck: OUT_OF_AREA,
    tenant: { pickupDiscountPercent: 10 },
  });
  await tap('oos_pickup', "Gel Al'a Gec");
  assert.equal(s.order.deliveryType, 'PICKUP');
  assert.equal(s.order.totalPrice, 954);
  assert.ok(said(s.sent, /Sepetiniz aynen korundu/));
  assert.equal(s.conv.phase, 'PAYMENT_METHOD_SELECTION');

  s.conv.phase = 'LOCATION_REQUEST';
  await tap('oos_pickup', "Gel Al'a Gec");
  assert.equal(s.order.totalPrice, 954, 'a second tap must not compound the discount');
});

test('C: disputed out-of-area pin + written address → accepted with a staff note', async () => {
  const s = setupFlow({
    phase: 'LOCATION_REQUEST',
    geoCheck: OUT_OF_AREA,
    messageFindFirst: freshPin,
  });
  await send('Tezel Konakları 3. blok daire 5');
  assert.equal(s.order.deliveryAddress, 'Tezel Konakları 3. blok daire 5');
  assert.match(String(s.order.notes), /servis alani disi/);
  assert.equal(s.conv.phase, 'ADDRESS_COLLECTION');
  assert.equal(s.nluCalls.length, 0);
});

// ---------------------------------------------------------------- written address / hazards

test('ADDR: "konum atmak istemiyorum" asks for the written address and never cancels', async () => {
  const s = setupFlow({ phase: 'LOCATION_REQUEST' });
  await send('konum atmak istemiyorum');
  assert.equal(s.order.status, 'DRAFT');
  assert.ok(said(s.sent, /Acik adresinizi yazar misiniz/), bodies(s.sent));
  assert.equal(s.nluCalls.length, 0);
});

test('ADDR: directions in LOCATION_REQUEST become a delivery note', async () => {
  const s = setupFlow({ phase: 'LOCATION_REQUEST' });
  await send('Konuma geldiğinizde çocuk çıkıp alacak');
  assert.match(String(s.order.notes), /Teslimat notu: Konuma geldiğinizde çocuk çıkıp alacak/);
  assert.equal(s.order.items.length, 1);
  assert.equal(s.nluCalls.length, 0);
});

test('hazard: "Silahtar Sokak No 4" typed as the address is stored, not a cancel', async () => {
  const s = setupFlow({ phase: 'ADDRESS_COLLECTION' });
  await send('Silahtar Sokak No 4');
  assert.equal(s.order.status, 'DRAFT');
  assert.equal(s.order.deliveryAddress, 'Silahtar Sokak No 4');
});

test('hazard: "kapıda kart geçer mi?" at the payment step is answered, not submitted as cash', async () => {
  const s = setupFlow({ phase: 'PAYMENT_METHOD_SELECTION' });
  const cash = stub(orderPaymentService, 'recordCashPayment', async () => undefined);
  await send('kapıda kart geçer mi?');
  assert.equal(cash.length, 0);
  assert.ok(said(s.sent, /kapida nakit veya kredi karti/), bodies(s.sent));
  assert.equal(s.conv.phase, 'PAYMENT_METHOD_SELECTION');
});

// ---------------------------------------------------------------- orchestrator root cause (B/C)

function setupOrchestrator(opts: {
  candidates?: Array<{ menuItemId: string; name: string; score: number; basePrice?: number }>;
  draft?: any;
  extraction: Record<string, unknown>;
  route?: { model: string; negativeConstraint: boolean };
  optionGroups?: Map<string, unknown>;
}) {
  stub(modelRouterService, 'isEnabled', () => !!opts.route);
  stub(
    modelRouterService,
    'route',
    () => opts.route ?? { model: 'local', negativeConstraint: false }
  );
  stub(intentAnalysisService, 'analyze', async () => null);
  stub(llmExtractorService, 'isAvailable', () => true);
  stub(menuCandidateService, 'findCandidates', async () =>
    (opts.candidates ?? []).map((c) => ({
      category: 'Sandvic',
      basePrice: 300,
      effectivePrice: c.basePrice ?? 300,
      synonymsMatched: [],
      ...c,
    }))
  );
  stub(menuCandidateService, 'getOptionGroupsForItems', async () => opts.optionGroups ?? new Map());
  stub(preferencesService, 'getPreferences', async () => null);
  const extractCalls = stub(llmExtractorService, 'extractOrder', async () =>
    JSON.parse(JSON.stringify(opts.extraction))
  );
  stub(claudeClientService, 'generateReply', async () => null);
  stub(trainingCaptureService, 'capture', () => undefined);

  let lastIntent: any = null;
  fake.__handlers.orderIntent = {
    findFirst: async () => lastIntent,
    create: async (a: any) => (lastIntent = { id: 'oi1', createdAt: new Date(), ...a.data }),
  };
  fake.__handlers.order = {
    findFirst: async () => opts.draft ?? null,
    create: async (a: any) => ({ id: 'o-new', ...a.data, items: a.data.items.create }),
    findUnique: async () => opts.draft,
  };
  return { extractCalls, setIntent: (i: any) => (lastIntent = i) };
}

const BUNDLE_GROUPS = new Map([
  [
    'mi-2li',
    [
      {
        id: 'g1',
        name: '1. Pizza',
        type: 'SINGLE',
        required: true,
        options: [{ id: 'op1', name: 'Margarita', priceDelta: 0, isDefault: false }],
      },
    ],
  ],
]);

for (const text of [
  'Hayalim kent e gidecek',
  'Yanlış oldu',
  'Size çok yakın nasıl yani',
  'İban ve ödeyeceğim miktarı yazar mısınız',
]) {
  test(`orchestrator: "${text}" never force-adds the bundle that is only in the cart`, async () => {
    setupOrchestrator({
      draft: {
        id: 'o1',
        status: 'DRAFT',
        totalPrice: 1060,
        notes: null,
        items: [{ id: 'oi1', ...TWO_PIZZA }],
      },
      extraction: { items: [], confidence: 0.3, clarificationQuestion: null, orderNotes: null },
      optionGroups: BUNDLE_GROUPS,
    });
    const r = await nluOrchestratorService.processMessage('t1', 'c1', 'm1', text);
    assert.ok(!r.pendingOptionSelection && !r.draftOrderId, JSON.stringify(r));
    assert.equal(writes('order', 'update').length + writes('order', 'create').length, 0);
  });
}

test('keep: orchestrator still force-adds a bundle the customer named in THIS message', async () => {
  setupOrchestrator({
    candidates: [{ menuItemId: 'mi-2li', name: "2'li Pizza Menü", score: 0.85, basePrice: 1060 }],
    extraction: { items: [], confidence: 0.3, clarificationQuestion: null, orderNotes: null },
    optionGroups: BUNDLE_GROUPS,
  });
  const r = await nluOrchestratorService.processMessage('t1', 'c1', 'm1', "2'li pizza menü");
  assert.equal(r.pendingOptionSelection?.itemName, "2'li Pizza Menü");
});

// ---------------------------------------------------------------- A (12.09)

const ITALIANO = [
  { menuItemId: 'mi-ital-y', name: 'İtaliano Yarım', score: 0.3, basePrice: 300 },
  { menuItemId: 'mi-ital-t', name: 'İtaliano Tam', score: 0.3, basePrice: 500 },
];
const A_TEXT = 'Sandviç istiyoruz, sade, içinde sadece mozerella olacak';

test('A: the special request is written onto the order — no PENDING_AGENT, no silence', async () => {
  setupOrchestrator({
    candidates: ITALIANO,
    route: { model: 'sonnet', negativeConstraint: true },
    extraction: {
      items: [
        {
          menuItemId: 'mi-ital-y',
          qty: 1,
          action: 'add',
          optionSelections: [],
          extras: [],
          notes: '',
          itemConfidence: 0.85,
        },
      ],
      confidence: 0.85,
      clarificationQuestion: null,
      orderNotes: null,
    },
  });
  const r = await nluOrchestratorService.processMessage('t1', 'c1', 'm1', A_TEXT);
  const flagged = fake.__calls.filter(
    (c) => c.model === 'conversation' && c.args?.data?.status === 'PENDING_AGENT'
  );
  assert.equal(flagged.length, 0);
  const created = writes('order', 'create')[0]?.args?.data;
  assert.equal(created?.items?.create?.[0]?.notes, 'Ozel istek: Sadece mozerella, sade');
  assert.match(String(r.confirmationMessage), /^Ozel isteginizi siparis notuna ekledim/);
  assert.equal(r.specialRequestNote, 'Sadece mozerella, sade');
});

test('A: when the product is ambiguous the bot asks Yarim/Tam, then "yarım" creates the order with the note', async () => {
  const o = setupOrchestrator({
    candidates: ITALIANO,
    route: { model: 'sonnet', negativeConstraint: true },
    extraction: { items: [], confidence: 0.4, clarificationQuestion: null, orderNotes: null },
  });
  const r1 = await nluOrchestratorService.processMessage('t1', 'c1', 'm1', A_TEXT);
  assert.equal(r1.weakClarification, false);
  assert.match(String(r1.clarificationQuestion), /Ozel isteginizi \(Sadece mozerella, sade\)/);
  assert.match(
    String(r1.clarificationQuestion),
    /İtaliano Yarım \(300\.00 TL\), İtaliano Tam \(500\.00 TL\)/
  );
  const intent = writes('orderIntent', 'create')[0].args.data.extractedJson;
  assert.equal(intent._pendingSpecialRequest.note, 'Sadece mozerella, sade');

  // turn 2: "yarım" — no constraint wording any more, the saved request is applied
  restores
    .splice(0)
    .reverse()
    .forEach((r) => r());
  const lastIntent = { id: 'oi1', createdAt: new Date(), extractedJson: intent };
  const o2 = setupOrchestrator({
    candidates: [ITALIANO[0]],
    route: { model: 'haiku', negativeConstraint: false },
    extraction: {
      items: [
        {
          menuItemId: 'mi-ital-y',
          qty: 1,
          action: 'add',
          optionSelections: [],
          extras: [],
          notes: '',
          itemConfidence: 0.9,
        },
      ],
      confidence: 0.9,
      clarificationQuestion: null,
      orderNotes: null,
    },
  });
  o2.setIntent(lastIntent);
  void o;
  const r2 = await nluOrchestratorService.processMessage('t1', 'c1', 'm2', 'yarım');
  const created = writes('order', 'create').pop()?.args?.data;
  assert.equal(created?.items?.create?.[0]?.notes, 'Ozel istek: Sadece mozerella, sade');
  assert.ok(r2.confirmationMessage);
});

test('A: "pizzada soğan istemiyorum" keeps the pizza and notes the request (no removal)', async () => {
  setupOrchestrator({
    candidates: [{ menuItemId: 'mi-marg', name: 'Margarita Pizza', score: 0.6, basePrice: 400 }],
    route: { model: 'sonnet', negativeConstraint: true },
    draft: {
      id: 'o1',
      status: 'DRAFT',
      totalPrice: 400,
      notes: null,
      items: [
        {
          id: 'oi1',
          menuItemId: 'mi-marg',
          menuItemName: 'Margarita Pizza',
          qty: 1,
          unitPrice: 400,
          optionsJson: null,
          extrasJson: null,
          notes: null,
        },
      ],
    },
    extraction: {
      items: [
        {
          menuItemId: 'mi-marg',
          qty: 1,
          action: 'remove',
          optionSelections: [],
          extras: [],
          notes: '',
          itemConfidence: 0.8,
        },
      ],
      confidence: 0.8,
      clarificationQuestion: null,
      orderNotes: null,
    },
  });
  await nluOrchestratorService.processMessage('t1', 'c1', 'm1', 'pizzada soğan istemiyorum');
  assert.equal(writes('order', 'delete').length, 0, 'the pizza must not be removed');
  const update = writes('order', 'update')[0]?.args?.data;
  assert.equal(update?.items?.create?.length, 1);
  assert.match(String(update?.items?.create?.[0]?.notes), /^Ozel istek: soğan istemiyorum/);
});

// ---------------------------------------------------------------- A: conversations held by the old gate

const GATE_TEXT = 'Özel isteğinizi görevlimiz kontrol edip size dönüş yapacağız.';
function holdMessages(opts: { gateAgeMs: number; humanAfter?: boolean }) {
  const gateAt = new Date(Date.now() - opts.gateAgeMs);
  return (a: any) => {
    const w = a?.where ?? {};
    if (w.direction === 'OUT' && w.kind === 'TEXT' && w.senderUserId === null)
      return { createdAt: gateAt, text: GATE_TEXT };
    if (w.direction === 'OUT' && Array.isArray(w.OR))
      return opts.humanAfter ? { id: 'staff-reply' } : null;
    if (w.direction === 'IN' && w.kind === 'TEXT' && w.createdAt?.lt)
      return { id: 'held-1', text: A_TEXT };
    return null;
  };
}

test('A: a fresh gate hold is resumed — the held order is replayed and the new message acknowledged', async () => {
  const s = setupFlow({
    phase: 'ORDER_COLLECTING',
    order: null,
    conv: { status: 'PENDING_AGENT' },
    messageFindFirst: holdMessages({ gateAgeMs: 10 * 60 * 1000 }),
    nlu: async () => ({
      success: true,
      clarificationQuestion:
        'Ozel isteginizi (Sadece mozerella, sade) siparis notuna ekleyecegim. Hangisini istersiniz: İtaliano Yarım (300.00 TL), İtaliano Tam (500.00 TL)?',
      weakClarification: false,
    }),
  });
  await send('Tezel konaklarındayız');
  assert.equal(s.conv.status, 'OPEN');
  assert.equal(s.nluCalls[0]?.[3], A_TEXT, 'the held message is replayed');
  assert.ok(said(s.sent, /Hangisini istersiniz/), bodies(s.sent));
  assert.ok(said(s.sent, /Adresinizi teslimat adiminda alacagim/));
});

test('A: a stale gate hold (2 days) restarts cleanly instead of staying silent', async () => {
  const s = setupFlow({
    phase: 'ORDER_COLLECTING',
    order: null,
    conv: { status: 'PENDING_AGENT' },
    messageFindFirst: holdMessages({ gateAgeMs: 2 * 24 * 60 * 60 * 1000 }),
    nlu: async () => ({
      success: true,
      clarificationQuestion: 'Hangi sandvici istersiniz?',
      weakClarification: false,
    }),
  });
  await send('merhaba sipariş vermek istiyorum');
  assert.equal(s.conv.status, 'OPEN');
  assert.equal(s.conv.phase === 'IDLE' || s.conv.phase === 'ORDER_COLLECTING', true);
  assert.ok(s.sent.length > 0, 'bot must answer');
  assert.ok(writes('order', 'updateMany').some((c) => c.args?.data?.status === 'CANCELLED'));
});

test('keep: PENDING_AGENT with a staff reply after the gate stays silent', async () => {
  const s = setupFlow({
    phase: 'ORDER_COLLECTING',
    conv: { status: 'PENDING_AGENT' },
    messageFindFirst: holdMessages({ gateAgeMs: 10 * 60 * 1000, humanAfter: true }),
  });
  await send('Tezel konaklarındayız');
  assert.equal(s.sent.length, 0);
  assert.equal(s.nluCalls.length, 0);
  assert.equal(s.conv.status, 'PENDING_AGENT');
});

test('keep: PENDING_AGENT with an assignment stays silent', async () => {
  const s = setupFlow({
    phase: 'ORDER_COLLECTING',
    conv: { status: 'PENDING_AGENT' },
    assignment: { id: 'as1', conversationId: 'c1' },
    messageFindFirst: holdMessages({ gateAgeMs: 10 * 60 * 1000 }),
  });
  await send('Tezel konaklarındayız');
  assert.equal(s.sent.length, 0);
});

test('keep: PENDING_AGENT set by a person (last bot message is not the gate reply) stays silent', async () => {
  const s = setupFlow({
    phase: 'ORDER_COLLECTING',
    conv: { status: 'PENDING_AGENT' },
    messageFindFirst: (a: any) =>
      a?.where?.direction === 'OUT'
        ? { createdAt: new Date(), text: 'Siparisiniz:\n\n1x Kola' }
        : null,
  });
  await send('Tezel konaklarındayız');
  assert.equal(s.sent.length, 0);
});

test('keep: a live agent lock silences the bot; an expired lock row does not', async () => {
  const live = setupFlow({
    phase: 'LOCATION_REQUEST',
    lock: { conversationId: 'c1', expiresAt: new Date(Date.now() + 60_000) },
  });
  await send('Tezel konaklarındayız');
  assert.equal(live.sent.length, 0);
  assert.equal(live.nluCalls.length, 0);

  restores
    .splice(0)
    .reverse()
    .forEach((r) => r());
  fake.__reset();
  const expired = setupFlow({
    phase: 'LOCATION_REQUEST',
    lock: { conversationId: 'c1', expiresAt: new Date(Date.now() - 60_000) },
  });
  await send('Tezel konaklarındayız');
  assert.ok(expired.sent.length > 0);
});

test('keep: an in-area pin proceeds to the address step without the NLU', async () => {
  const s = setupFlow({
    phase: 'LOCATION_REQUEST',
    checkServiceArea: {
      ...OUT_OF_AREA,
      isWithinServiceArea: true,
      distance: 1.2,
      reason: 'IN_AREA',
      deliveryRule: {
        id: 'r1',
        tenantId: 't1',
        storeId: 's1',
        radiusKm: 3,
        minBasket: 100,
        deliveryFee: 0,
        isActive: true,
        createdAt: '',
        updatedAt: '',
      },
    },
  });
  await send(
    'Location shared',
    { location: { latitude: 41.08, longitude: 31.12 } } as any,
    'LOCATION'
  );
  assert.equal(s.nluCalls.length, 0);
  assert.ok(said(s.sent, /subemizden teslimat yapilacak/), bodies(s.sent));
  assert.equal(s.conv.phase, 'ADDRESS_COLLECTION');
});

// ================================================================ repair round 2

const IN_AREA: GeoCheckResult = {
  ...OUT_OF_AREA,
  isWithinServiceArea: true,
  distance: 1.2,
  reason: 'IN_AREA' as any,
  deliveryRule: {
    id: 'r1',
    tenantId: 't1',
    storeId: 's1',
    radiusKm: 3,
    minBasket: 100,
    deliveryFee: 0,
    isActive: true,
    createdAt: '',
    updatedAt: '',
  } as any,
};

/** message.findFirst that knows what the bot already sent (ADDRESS_ASK_MARKER lookups). */
function historyAware(ref: { sent: Sent[] }, extra?: (a: any) => unknown) {
  return (a: any) => {
    const contains = a?.where?.text?.contains;
    if (contains) return ref.sent.some((m) => m.body.includes(contains)) ? { id: 'out-1' } : null;
    return extra ? extra(a) : null;
  };
}

test('ADDR: small-town written addresses without street keywords are accepted, not reminded forever', async () => {
  for (const text of ['Kepez 25 kat 2', 'Dilaverler köyü 12', 'Belediye karşısı 3. ev', 'Plaj yolu Akçakoca Otel karşısı']) {
    const s = setupFlow({ phase: 'LOCATION_REQUEST' });
    await send(text);
    assert.equal(s.order.deliveryAddress, text, `${text}: ${bodies(s.sent)}`);
    assert.equal(s.conv.phase, 'ADDRESS_COLLECTION', text);
    assert.equal(s.nluCalls.length, 0, text);
    restores.splice(0).reverse().forEach((r) => r());
    fake.__reset();
  }
});

test('ADDR: a 2-word address is asked for detail once, the same reply again is accepted', async () => {
  const ref = { sent: [] as Sent[] };
  const s = setupFlow({ phase: 'LOCATION_REQUEST', messageFindFirst: historyAware(ref) });
  ref.sent = s.sent;
  await send('Kepez merkez');
  assert.ok(s.sent.some((m) => m.buttons?.some((b) => b.id === 'use_typed_address')), bodies(s.sent));
  assert.equal(s.conv.phase, 'LOCATION_REQUEST');
  await send('Kepez merkez');
  assert.equal(s.order.deliveryAddress, 'Kepez merkez');
  assert.equal(s.conv.phase, 'ADDRESS_COLLECTION');
});

test('ADDR: "tamam yazıyorum" / "bir saniye" / a question are never stored as the address', async () => {
  const ref = { sent: [] as Sent[] };
  const s = setupFlow({ phase: 'LOCATION_REQUEST', messageFindFirst: historyAware(ref) });
  ref.sent = s.sent;
  await send('konum atmak istemiyorum');
  for (const t of ['tamam yazıyorum', 'bir saniye', 'Siparişim kaçta gelecek']) {
    await send(t);
    assert.equal(s.order.deliveryAddress, null, `${t}: ${bodies(s.sent)}`);
    assert.equal(s.conv.phase, 'LOCATION_REQUEST', t);
  }
  await send('Orhangazi Mah. Gül Sok. No:5');
  assert.equal(s.order.deliveryAddress, 'Orhangazi Mah. Gül Sok. No:5');
});

test('cancel: everyday wording cancels in the post-confirm steps, never becomes an address', async () => {
  const cases: Array<[string, string]> = [
    ['ADDRESS_COLLECTION', 'iptal edin'],
    ['LOCATION_REQUEST', 'siparişi iptal etmek istiyorum'],
    ['LOCATION_REQUEST', 'vazgeçtim'],
    ['PAYMENT_METHOD_SELECTION', 'vazgeçtim'],
    ['DELIVERY_TYPE_SELECTION', 'siparişimi iptal edin'],
  ];
  for (const [phase, text] of cases) {
    const s = setupFlow({ phase });
    await send(text);
    assert.ok(said(s.sent, /Siparisiniz iptal edildi/), `${phase} "${text}": ${bodies(s.sent)}`);
    assert.equal(s.conv.phase, 'IDLE', `${phase} "${text}"`);
    assert.equal(s.order.deliveryAddress, null);
    restores.splice(0).reverse().forEach((r) => r());
    fake.__reset();
  }
});

test('address confirm: "tamam doğru" / "Tamamdır" confirm the typed address, never extend it', async () => {
  for (const reply of ['tamam doğru', 'Tamamdır', 'adres doğru']) {
    const s = setupFlow({ phase: 'LOCATION_REQUEST' });
    await send('Hayalim kent e gidecek');
    await send(reply);
    assert.equal(s.order.deliveryAddress, 'Hayalim kent e gidecek', reply);
    assert.equal(s.conv.phase, 'PAYMENT_METHOD_SELECTION', `${reply}: ${bodies(s.sent)}`);
    restores.splice(0).reverse().forEach((r) => r());
    fake.__reset();
  }
});

test('mid-flow: "yanına bir ayran alırım" reaches the NLU instead of becoming the address', async () => {
  const s = setupFlow({
    phase: 'LOCATION_REQUEST',
    candidates: [{ menuItemId: 'mi-ayran', name: 'Ayran', score: 0.8 }],
  });
  await send('yanına bir ayran alırım');
  assert.equal(s.nluCalls.length, 1, bodies(s.sent));
  assert.equal(s.order.deliveryAddress, null);
});

test('mid-flow: a product mention without add wording is asked about, then added on "Evet"', async () => {
  const s = setupFlow({
    phase: 'LOCATION_REQUEST',
    candidates: [{ menuItemId: 'mi-marg', name: 'Margarita', score: 0.8 }],
  });
  await send('o margarita çok güzel görünüyor');
  assert.equal(s.nluCalls.length, 0);
  assert.ok(s.sent.some((m) => m.buttons?.some((b) => b.id === 'mid_add_yes')), bodies(s.sent));
  assert.equal(s.order.deliveryAddress, null);
  await tap('mid_add_yes', 'Evet, ekle');
  assert.equal(s.nluCalls.length, 1, bodies(s.sent));
  assert.match(String(s.nluCalls[0][3]), /margarita/);
});

test('DELIVERY_TYPE: "kapıya getirin" saves the note AND continues with delivery', async () => {
  const s = setupFlow({ phase: 'DELIVERY_TYPE_SELECTION' });
  await send('kapıya getirin');
  assert.equal(s.order.deliveryType, 'DELIVERY');
  assert.match(String(s.order.notes), /Teslimat notu: kapıya getirin/);
  assert.equal(s.conv.phase, 'LOCATION_REQUEST', bodies(s.sent));
});

test('pin before Onayla: reused at the address step, never asked again', async () => {
  const s = setupFlow({
    phase: 'DELIVERY_TYPE_SELECTION',
    order: draftOrder({ deliveryType: null, deliveryAddress: 'Tezel konaklarındayız' }),
    geoCheck: IN_AREA,
    conv: { customerLat: 41.08, customerLng: 31.12 },
    // the pin came 30 min ago, BEFORE the draft (20 min ago)
    messageFindFirst: (a: any) =>
      a?.where?.kind === 'LOCATION' ? { createdAt: new Date(Date.now() - 30 * 60 * 1000) } : null,
  });
  await tap('delivery_type_delivery', 'Paket Servis');
  assert.ok(said(s.sent, /Daha once paylastiginiz konumu/), bodies(s.sent));
  assert.ok(!s.sent.some((m) => m.method === 'sendLocationRequest'));
  assert.ok(said(s.sent, /Tezel konaklarındayız/));
  assert.equal(s.conv.phase, 'ADDRESS_COLLECTION');
});

test('pin before Onayla + "Bu adresle devam": the in-area pin is kept, no written-address flag', async () => {
  const s = setupFlow({
    phase: 'LOCATION_REQUEST',
    order: draftOrder({ deliveryAddress: 'Tezel konaklarındayız' }),
    geoCheck: IN_AREA,
    conv: { customerLat: 41.08, customerLng: 31.12 },
    messageFindFirst: freshPin,
  });
  await tap('use_typed_address', 'Bu adresle devam');
  assert.equal(s.conv.customerLat, 41.08);
  assert.ok(!String(s.order.notes ?? '').startsWith(TYPED_ADDRESS_NOTE), String(s.order.notes));
  assert.equal(s.conv.phase, 'ADDRESS_COLLECTION', bodies(s.sent));
});

test('ORDER_REVIEW: a pin is acknowledged and the confirm buttons come back (no silence)', async () => {
  const s = setupFlow({ phase: 'ORDER_REVIEW' });
  await send('Location shared', { location: { latitude: 41.08, longitude: 31.12 } } as any, 'LOCATION');
  assert.ok(said(s.sent, /Konumunuzu aldim/), bodies(s.sent));
  assert.ok(s.sent.some((m) => m.buttons?.some((b) => b.id === 'confirm_order')));
  assert.equal(s.conv.phase, 'ORDER_REVIEW');
});

test('ORDER_COLLECTING: "tamam başka bir şey istemiyorum" shows the cart, never the NLU', async () => {
  const s = setupFlow({ phase: 'ORDER_COLLECTING' });
  await send('tamam başka bir şey istemiyorum');
  assert.equal(s.nluCalls.length, 0);
  assert.ok(s.sent.some((m) => m.buttons?.some((b) => b.id === 'confirm_order')), bodies(s.sent));
  assert.equal(s.conv.phase, 'ORDER_REVIEW');
});

const OPTION_SELECTION = {
  itemName: "2'li Pizza Menü",
  groupName: '1. Pizza',
  stepNumber: 1,
  options: [{ id: 'opt_0_Margarita', name: 'Margarita', priceDelta: 0 }],
};

test('B: bundle with required options + IBAN question in the first message → list AND payment answer', async () => {
  const s = setupFlow({
    phase: 'IDLE',
    order: null,
    nlu: async () => ({
      success: true,
      draftOrderId: 'o1',
      itemsExtracted: true,
      pendingOptionSelection: OPTION_SELECTION,
      clarificationQuestion: '1. 1. Pizza seçin:',
    }),
  });
  const created = draftOrder({ items: [{ ...TWO_PIZZA, optionsJson: [] }] });
  fake.__handlers.order.findFirst = async (a: any) =>
    a?.where?.id === 'o1' || a?.where?.status === 'DRAFT' ? created : null;
  await send("2'li pizza menü istiyorum. İban ve ödeyeceğim miktarı yazar mısınız");
  assert.ok(s.sent.some((m) => m.method === 'sendListMessage'), bodies(s.sent));
  assert.ok(said(s.sent, /IBAN \/ havale \/ EFT ile odeme almiyoruz/), bodies(s.sent));
});

test('OPTION_SELECTION: a payment question is answered and the option list comes back', async () => {
  const s = setupFlow({ phase: 'ORDER_COLLECTING', conv: { flowSubState: 'OPTION_SELECTION' } });
  fake.__handlers.orderItem = {
    findFirst: async () => ({ id: 'oi1', menuItemId: 'mi-2li', optionsJson: [], unitPrice: 1060 }),
  };
  fake.__handlers.menuItem = {
    findUnique: async () => ({
      id: 'mi-2li',
      name: "2'li Pizza Menü",
      optionGroups: [
        {
          group: {
            name: '1. Pizza',
            required: true,
            minSelect: 1,
            maxSelect: 1,
            options: [{ name: 'Margarita', priceDelta: 0 }],
          },
        },
      ],
    }),
  };
  await send('İban ve ödeyeceğim miktarı yazar mısınız');
  assert.ok(said(s.sent, /IBAN \/ havale/), bodies(s.sent));
  assert.ok(s.sent.some((m) => m.method === 'sendListMessage'), bodies(s.sent));
  assert.ok(!said(s.sent, /Seçiminizi anlayamadım/));
});

test('legacy hold race: the losing concurrent message is processed, not dropped', async () => {
  const s = setupFlow({
    phase: 'ORDER_COLLECTING',
    order: null,
    conv: { status: 'PENDING_AGENT' },
    messageFindFirst: holdMessages({ gateAgeMs: 10 * 60 * 1000 }),
    nlu: async () => ({ success: true, clarificationQuestion: 'Hangi sandvici istersiniz?', weakClarification: false }),
  });
  // the other webhook already reopened the chat
  fake.__handlers.conversation.updateMany = async () => {
    s.conv.status = 'OPEN';
    return { count: 0 };
  };
  await send('yarım olsun');
  assert.ok(s.sent.length > 0, 'the message must be answered');
  // the flow hands the NLU normalizeTr() text (ı → i)
  assert.equal(s.nluCalls[0]?.[3], 'yarim olsun', 'the loser does not replay the held message');
});

// ---------------------------------------------------------------- orchestrator: special request lifetime

const EMPTY_EXTRACTION = { items: [], confidence: 0.3, clarificationQuestion: null, orderNotes: null };
const addItem = (menuItemId: string) => ({
  items: [
    { menuItemId, qty: 1, action: 'add', optionSelections: [], extras: [], notes: '', itemConfidence: 0.9 },
  ],
  confidence: 0.9,
  clarificationQuestion: null,
  orderNotes: null,
});

function scriptedOrchestrator() {
  setupOrchestrator({ extraction: EMPTY_EXTRACTION });
  let turn: { candidates: any[]; extraction: any } = { candidates: [], extraction: EMPTY_EXTRACTION };
  stub(menuCandidateService, 'findCandidates', async () =>
    turn.candidates.map((c) => ({
      category: 'Sandvic',
      basePrice: 300,
      effectivePrice: c.basePrice ?? 300,
      synonymsMatched: [],
      ...c,
    }))
  );
  stub(llmExtractorService, 'extractOrder', async () => JSON.parse(JSON.stringify(turn.extraction)));
  // carried-over candidate ids resolve to menu rows, as in production
  fake.__handlers.menuItem = {
    findMany: async () =>
      ITALIANO.map((c) => ({
        id: c.menuItemId,
        name: c.name,
        description: null,
        category: 'Sandvic',
        basePrice: c.basePrice,
        discountType: null,
        discountValue: null,
        discountStartAt: null,
        discountEndAt: null,
      })),
  };
  return async (id: string, text: string, candidates: any[], extraction: any) => {
    turn = { candidates, extraction };
    return nluOrchestratorService.processMessage('t1', 'c1', id, text);
  };
}

test('A replay: the request survives the address + directions turns and lands on "yarım"', async () => {
  const run = scriptedOrchestrator();
  const r1 = await run('m1', A_TEXT, ITALIANO, EMPTY_EXTRACTION);
  assert.match(String(r1.clarificationQuestion), /Hangisini istersiniz/);
  await run('m2', 'Tezel konaklarındayız', [], EMPTY_EXTRACTION);
  assert.match(
    String(await nluOrchestratorService.getOpenSpecialRequestQuestion('t1', 'c1')),
    /İtaliano Yarım.*İtaliano Tam/
  );
  await run('m3', 'Konuma geldiğinizde çocuk çıkıp alacak', [], EMPTY_EXTRACTION);
  const r4 = await run('m4', 'yarım', [ITALIANO[0]], addItem('mi-ital-y'));
  const created = writes('order', 'create').pop()?.args?.data;
  assert.equal(created?.items?.create?.[0]?.notes, 'Ozel istek: Sadece mozerella, sade');
  assert.ok(r4.confirmationMessage);
});

test('A: an open request is not written onto an unrelated product ("2 kola")', async () => {
  const run = scriptedOrchestrator();
  await run('m1', A_TEXT, ITALIANO, EMPTY_EXTRACTION);
  const r2 = await run('m2', '2 kola', [{ menuItemId: 'mi-kola', name: 'Kola', score: 0.8, basePrice: 50 }], addItem('mi-kola'));
  const created = writes('order', 'create').pop()?.args?.data;
  assert.equal(created?.items?.create?.[0]?.notes ?? null, null);
  assert.match(String(r2.confirmationMessage), /Hangisini istersiniz/);
  const lastIntent = writes('orderIntent', 'create').pop()?.args?.data?.extractedJson;
  assert.equal(lastIntent?._pendingSpecialRequest?.note, 'Sadece mozerella, sade');
});

const PIZZA_LINE = {
  id: 'oi1',
  menuItemId: 'mi-marg',
  menuItemName: 'Margarita Pizza',
  qty: 1,
  unitPrice: 400,
  optionsJson: null,
  extrasJson: null,
  notes: null,
};
const COLA_LINE = { ...PIZZA_LINE, id: 'oi2', menuItemId: 'mi-cola', menuItemName: 'Coca Cola', unitPrice: 50 };
const REMOVE_COLA = {
  items: [
    { menuItemId: 'mi-cola', qty: 1, action: 'remove', optionSelections: [], extras: [], notes: '', itemConfidence: 0.9 },
  ],
  confidence: 0.9,
  clarificationQuestion: null,
  orderNotes: null,
};

for (const withSynonymMatch of [true, false]) {
  test(`remove-guard: "kolayı istemiyorum" removes the cola (${withSynonymMatch ? 'synonym match' : 'cart only'})`, async () => {
    setupOrchestrator({
      candidates: withSynonymMatch
        ? [{ menuItemId: 'mi-cola', name: 'Coca Cola', score: 0.7, basePrice: 50, synonymsMatched: ['kola'] } as any]
        : [],
      draft: { id: 'o1', status: 'DRAFT', totalPrice: 450, notes: null, items: [PIZZA_LINE, COLA_LINE] },
      extraction: REMOVE_COLA,
    });
    const r = await nluOrchestratorService.processMessage('t1', 'c1', 'm1', 'kolayı istemiyorum');
    const update = writes('order', 'update')[0]?.args?.data;
    assert.deepEqual(
      update?.items?.create?.map((i: any) => i.menuItemId),
      ['mi-marg'],
      JSON.stringify(r)
    );
    assert.ok(!r.specialRequestNote);
  });
}

test('customer summary never shows the written-address staff flag', () => {
  const text = nluOrchestratorService.generateConfirmationMessage({
    items: [{ menuItemName: 'Kola', qty: 1, unitPrice: 50, optionsJson: null, notes: null }],
    totalPrice: 50,
    notes: `${TYPED_ADDRESS_NOTE} - paylasilan konum 20.3 km (servis alani disi)`,
  });
  assert.ok(!/Konum paylasilmadi/.test(text), text);
});

// ---- Doğrulama bulguları (14.09): gerçek akış kodu üzerinde ----

test('LOCATION_REQUEST: "Açık adresim: Orhangazi Mah. Gül Sok. No 5" is taken as the address, not re-asked', async () => {
  const s = setupFlow({ phase: 'LOCATION_REQUEST' });
  await send('Açık adresim: Orhangazi Mah. Gül Sok. No 5');
  assert.equal(s.nluCalls.length, 0);
  assert.equal(s.order.deliveryAddress, 'Açık adresim: Orhangazi Mah. Gül Sok. No 5', bodies(s.sent));
  assert.ok(!said(s.sent, /Acik adresinizi yazar misiniz/i), bodies(s.sent));
});

test('LOCATION_REQUEST: "adres vereyim Gül sokak no 5" and "Konum yok adres: ..." are addresses', async () => {
  for (const text of ['adres vereyim Gül sokak no 5', 'Konum yok adres: Tezel konakları B blok daire 4']) {
    const s = setupFlow({ phase: 'LOCATION_REQUEST' });
    await send(text);
    assert.equal(s.order.deliveryAddress, text, `${text} → ${bodies(s.sent)}`);
    restores.splice(0).reverse().forEach((r) => r());
    fake.__reset();
  }
});

test('LOCATION_REQUEST: "konum atmayı bilmiyorum" / "Olmuyor" ask for a written address, never stored as it', async () => {
  for (const text of ['konum atmayı bilmiyorum', 'Ben konumu bulamadım', 'Olmuyor']) {
    const s = setupFlow({ phase: 'LOCATION_REQUEST' });
    await send(text);
    assert.equal(s.nluCalls.length, 0);
    assert.ok(!s.order.deliveryAddress, `${text} must not become the address: ${s.order.deliveryAddress}`);
    assert.equal(s.conv.phase, 'LOCATION_REQUEST');
    restores.splice(0).reverse().forEach((r) => r());
    fake.__reset();
  }
});

test('ADDRESS_COLLECTION after an in-area pin: "Camiye yakın Gül sokak no 3" is accepted (no regression)', async () => {
  const s = setupFlow({ phase: 'ADDRESS_COLLECTION' });
  await send('Camiye yakın Gül sokak no 3');
  assert.equal(s.order.deliveryAddress, 'Camiye yakın Gül sokak no 3', bodies(s.sent));
});
