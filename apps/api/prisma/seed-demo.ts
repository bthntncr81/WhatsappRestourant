import { PrismaClient, MemberRole, OrderStatus, ConversationStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import * as bcrypt from 'bcrypt';

const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/whatres_db?schema=public';
const pool = new pg.Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function hoursAgo(h: number) { return new Date(Date.now() - h * 3600000); }
function minsAgo(m: number) { return new Date(Date.now() - m * 60000); }
function daysAgo(d: number) { return new Date(Date.now() - d * 86400000); }

async function main() {
  console.log('🎬 Demo hesabı oluşturuluyor...\n');

  // ==================== TENANT ====================
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo-satis' },
    update: {},
    create: {
      name: 'Lezzet Durağı',
      slug: 'demo-satis',
      onboardingStep: 6,
      onboardingCompletedAt: daysAgo(30),
      workingHours: {
        mon: { open: '10:00', close: '23:00' },
        tue: { open: '10:00', close: '23:00' },
        wed: { open: '10:00', close: '23:00' },
        thu: { open: '10:00', close: '23:00' },
        fri: { open: '10:00', close: '00:00' },
        sat: { open: '11:00', close: '00:00' },
        sun: { open: '11:00', close: '22:00' },
      },
      pickupDiscountPercent: 10,
      orderNotifyPhones: ['905321234567'],
    },
  });
  console.log(`✓ Tenant: ${tenant.name}`);

  // ==================== USER ====================
  const passwordHash = await bcrypt.hash('demo2026', 12);
  const owner = await prisma.user.upsert({
    where: { email: 'demo@superpersonel.com' },
    update: {},
    create: { email: 'demo@superpersonel.com', name: 'Demo Yönetici', passwordHash },
  });
  await prisma.membership.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId: owner.id } },
    update: { role: MemberRole.OWNER },
    create: { tenantId: tenant.id, userId: owner.id, role: MemberRole.OWNER },
  });

  const agent = await prisma.user.upsert({
    where: { email: 'garson@superpersonel.com' },
    update: {},
    create: { email: 'garson@superpersonel.com', name: 'Ayşe Garson', passwordHash },
  });
  await prisma.membership.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId: agent.id } },
    update: { role: MemberRole.AGENT },
    create: { tenantId: tenant.id, userId: agent.id, role: MemberRole.AGENT },
  });
  console.log('✓ Kullanıcılar oluşturuldu');

  // ==================== STORES ====================
  const store1 = await prisma.store.upsert({
    where: { id: 'demo-store-merkez' },
    update: {},
    create: {
      id: 'demo-store-merkez', tenantId: tenant.id,
      name: 'Merkez Şube', address: 'Atatürk Cad. No:42, Şişli, İstanbul',
      lat: 41.0602, lng: 28.9877, phone: '0212 444 5678', isActive: true, isOpen: true,
    },
  });
  await prisma.deliveryRule.upsert({
    where: { id: 'demo-rule-merkez' },
    update: {},
    create: {
      id: 'demo-rule-merkez', tenantId: tenant.id, storeId: store1.id,
      radiusKm: 5, minBasket: 100, deliveryFee: 20, isActive: true,
    },
  });
  const store2 = await prisma.store.upsert({
    where: { id: 'demo-store-kadikoy' },
    update: {},
    create: {
      id: 'demo-store-kadikoy', tenantId: tenant.id,
      name: 'Kadıköy Şube', address: 'Bağdat Cad. No:156, Kadıköy, İstanbul',
      lat: 40.9906, lng: 29.0297, phone: '0216 444 9012', isActive: true, isOpen: true,
    },
  });
  await prisma.deliveryRule.upsert({
    where: { id: 'demo-rule-kadikoy' },
    update: {},
    create: {
      id: 'demo-rule-kadikoy', tenantId: tenant.id, storeId: store2.id,
      radiusKm: 4, minBasket: 80, deliveryFee: 15, isActive: true,
    },
  });
  console.log('✓ 2 şube oluşturuldu');

  // ==================== SUBSCRIPTION ====================
  await prisma.subscription.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: {
      tenantId: tenant.id, plan: 'GOLD', status: 'ACTIVE', billingCycle: 'MONTHLY',
      monthlyOrderLimit: 1000, monthlyMessageLimit: 5000, maxStores: 3, maxUsers: 10,
      ordersUsed: 347, messagesUsed: 2180,
      currentPeriodStart: daysAgo(15),
      currentPeriodEnd: new Date(Date.now() + 15 * 86400000),
    },
  });
  console.log('✓ Gold abonelik oluşturuldu');

  // ==================== MENU ====================
  const mv = await prisma.menuVersion.upsert({
    where: { id: 'demo-menu-v1' },
    update: {},
    create: { id: 'demo-menu-v1', tenantId: tenant.id, version: 1, publishedAt: daysAgo(30) },
  });
  await prisma.tenant.update({ where: { id: tenant.id }, data: { activeMenuVersionId: mv.id } });

  const items = [
    // Kebap & Izgara
    { id: 'di-adana', name: 'Adana Kebap', cat: 'Kebap & Izgara', price: 320, desc: 'El kıyması, acılı, közde pişirilir. Lavaş ve közlenmiş domates ile servis edilir.' },
    { id: 'di-urfa', name: 'Urfa Kebap', cat: 'Kebap & Izgara', price: 320, desc: 'El kıyması, acısız, közde pişirilir.' },
    { id: 'di-iskender', name: 'İskender', cat: 'Kebap & Izgara', price: 380, desc: 'Tereyağlı domates sos, yoğurt, pideli. Efsane lezzet!' },
    { id: 'di-tavuk-sis', name: 'Tavuk Şiş', cat: 'Kebap & Izgara', price: 280, desc: 'Marine edilmiş tavuk göğüs, sebzeli.' },
    { id: 'di-kofte', name: 'Izgara Köfte', cat: 'Kebap & Izgara', price: 260, desc: 'Dana kıyma, özel baharatlarla. 4 adet.' },
    { id: 'di-kanat', name: 'Tavuk Kanat', cat: 'Kebap & Izgara', price: 220, desc: 'Izgara tavuk kanat, 8 adet. Acılı veya sade.' },
    // Pide & Lahmacun
    { id: 'di-kasarli', name: 'Kaşarlı Pide', cat: 'Pide & Lahmacun', price: 180, desc: 'Bol kaşar peynirli.' },
    { id: 'di-kiymali-pide', name: 'Kıymalı Pide', cat: 'Pide & Lahmacun', price: 220, desc: 'Dana kıyma, domates, biber.' },
    { id: 'di-kusbasi-pide', name: 'Kuşbaşılı Pide', cat: 'Pide & Lahmacun', price: 280, desc: 'Dana kuşbaşı, kaşar peyniri.' },
    { id: 'di-lahmacun', name: 'Lahmacun', cat: 'Pide & Lahmacun', price: 120, desc: 'İnce hamur, kıymalı. Limon ve maydanoz ile servis.' },
    // Döner
    { id: 'di-doner-ekmek', name: 'Döner Ekmek', cat: 'Döner', price: 160, desc: 'Yarım ekmek arası döner.' },
    { id: 'di-doner-durum', name: 'Döner Dürüm', cat: 'Döner', price: 180, desc: 'Lavaş dürüm, soslu.' },
    { id: 'di-iskender-doner', name: 'İskender Döner', cat: 'Döner', price: 350, desc: 'Döner, tereyağlı sos, yoğurt.' },
    { id: 'di-porsiyon', name: 'Porsiyon Döner', cat: 'Döner', price: 280, desc: 'Pilav ve salata ile.' },
    // Çorbalar
    { id: 'di-mercimek', name: 'Mercimek Çorbası', cat: 'Çorbalar', price: 80, desc: 'Geleneksel kırmızı mercimek.' },
    { id: 'di-ezogelin', name: 'Ezogelin Çorbası', cat: 'Çorbalar', price: 80, desc: 'Bulgur ve mercimekli.' },
    // İçecekler
    { id: 'di-ayran', name: 'Ayran', cat: 'İçecekler', price: 30, desc: '', rf: true },
    { id: 'di-kola', name: 'Coca Cola', cat: 'İçecekler', price: 60, desc: '330ml kutu', rf: true },
    { id: 'di-su', name: 'Su', cat: 'İçecekler', price: 15, desc: '0.5L', rf: true },
    { id: 'di-cay', name: 'Çay', cat: 'İçecekler', price: 25, desc: 'Demlik çay, ince bel bardak.', rf: true },
    { id: 'di-salgam', name: 'Şalgam', cat: 'İçecekler', price: 40, desc: 'Acılı veya acısız.', rf: true },
    // Tatlılar
    { id: 'di-kunefe', name: 'Künefe', cat: 'Tatlılar', price: 180, desc: 'Antep fıstıklı, sıcak servis.', disc: { type: 'PERCENTAGE', value: 15 } },
    { id: 'di-baklava', name: 'Baklava', cat: 'Tatlılar', price: 200, desc: 'Antep fıstıklı, 6 dilim.' },
    { id: 'di-sutlac', name: 'Sütlaç', cat: 'Tatlılar', price: 90, desc: 'Fırında sütlaç.' },
  ];

  for (const it of items) {
    await prisma.menuItem.upsert({
      where: { id: it.id },
      update: { name: it.name, basePrice: it.price, description: it.desc, category: it.cat },
      create: {
        id: it.id, tenantId: tenant.id, versionId: mv.id,
        name: it.name, description: it.desc, category: it.cat,
        basePrice: it.price, isActive: true, isReadyFood: (it as any).rf || false,
        discountType: (it as any).disc?.type || null,
        discountValue: (it as any).disc?.value || null,
      },
    });
  }
  console.log(`✓ ${items.length} menü ürünü oluşturuldu`);

  // ==================== CONVERSATIONS & ORDERS ====================
  const customers = [
    { phone: '905321112233', name: 'Mehmet Yıldız', lat: 41.055, lng: 28.99 },
    { phone: '905332223344', name: 'Zeynep Arslan', lat: 41.048, lng: 28.985 },
    { phone: '905343334455', name: 'Emre Çelik', lat: 40.992, lng: 29.025 },
    { phone: '905354445566', name: 'Fatma Şahin', lat: 41.062, lng: 28.978 },
    { phone: '905365556677', name: 'Ali Kara', lat: 41.043, lng: 28.993 },
    { phone: '905376667788', name: 'Selin Demir', lat: 41.058, lng: 28.982 },
    { phone: '905387778899', name: 'Burak Öztürk', lat: 40.988, lng: 29.030 },
    { phone: '905398889900', name: 'Elif Yılmaz', lat: 41.065, lng: 28.975 },
    { phone: '905301110022', name: 'Hakan Koç', lat: 41.050, lng: 28.995 },
    { phone: '905312221133', name: 'Ayşe Güneş', lat: 41.057, lng: 28.988 },
    { phone: '905323332244', name: 'Serkan Aydın', lat: 41.045, lng: 28.980 },
    { phone: '905334443355', name: 'Deniz Aktaş', lat: 40.995, lng: 29.028 },
  ];

  // Conversations with varied statuses and phases
  const convData: Array<{
    custIdx: number; status: ConversationStatus; msgs: Array<{ dir: 'IN' | 'OUT'; text: string; ago: number }>;
    order?: { status: OrderStatus; items: Array<{ id: string; name: string; qty: number; price: number }>; total: number; ago: number; payment?: string; delivery?: string };
  }> = [
    // 1) Active order - just confirmed, preparing
    {
      custIdx: 0, status: 'OPEN',
      msgs: [
        { dir: 'IN', text: 'Merhaba, sipariş vermek istiyorum', ago: 25 },
        { dir: 'OUT', text: 'Merhaba Mehmet Bey! 😊 Size nasıl yardımcı olabilirim? Menümüzü görmek ister misiniz yoksa direkt sipariş vermek mi istersiniz?', ago: 24 },
        { dir: 'IN', text: '2 adana kebap 1 ayran 1 lahmacun', ago: 22 },
        { dir: 'OUT', text: '📋 Siparişiniz:\n\n• 2x Adana Kebap — 640 ₺\n• 1x Lahmacun — 120 ₺\n• 1x Ayran — 30 ₺\n\n💰 Toplam: 790 ₺\n\nOnaylıyor musunuz?', ago: 21 },
        { dir: 'IN', text: 'evet', ago: 20 },
        { dir: 'OUT', text: 'Siparişiniz onaylandı! 🎉 Teslimat mı yoksa gel al mı tercih edersiniz?', ago: 19 },
        { dir: 'IN', text: 'teslimat', ago: 18 },
        { dir: 'OUT', text: 'Konumunuzu paylaşır mısınız? 📍', ago: 17 },
        { dir: 'IN', text: '📍 Konum paylaşıldı', ago: 15 },
        { dir: 'OUT', text: 'Ödeme yönteminizi seçin:\n\n💵 Nakit\n💳 Kredi Kartı', ago: 14 },
        { dir: 'IN', text: 'nakit', ago: 12 },
        { dir: 'OUT', text: '✅ Siparişiniz alındı!\n\n🏪 Merkez Şube\n📋 Sipariş #347\n💰 790 ₺ (Nakit)\n🚗 Tahmini teslimat: 30-40 dk\n\nAfiyet olsun! 🍽️', ago: 10 },
      ],
      order: {
        status: 'PREPARING', total: 790, ago: 10, payment: 'CASH', delivery: 'DELIVERY',
        items: [
          { id: 'di-adana', name: 'Adana Kebap', qty: 2, price: 320 },
          { id: 'di-lahmacun', name: 'Lahmacun', qty: 1, price: 120 },
          { id: 'di-ayran', name: 'Ayran', qty: 1, price: 30 },
        ],
      },
    },
    // 2) Pending confirmation
    {
      custIdx: 1, status: 'OPEN',
      msgs: [
        { dir: 'IN', text: 'merhabalar menüyü görebilir miyim', ago: 8 },
        { dir: 'OUT', text: 'Tabii! İşte menümüz 📋\n\n🔥 Kebap & Izgara\n• Adana Kebap — 320 ₺\n• İskender — 380 ₺\n• Tavuk Şiş — 280 ₺\n\n🫓 Pide & Lahmacun\n• Kaşarlı Pide — 180 ₺\n• Lahmacun — 120 ₺\n\n🥙 Döner\n• Döner Dürüm — 180 ₺\n\nSipariş vermek ister misiniz?', ago: 7 },
        { dir: 'IN', text: '1 iskender 1 mercimek çorbası 2 ayran', ago: 5 },
        { dir: 'OUT', text: '📋 Siparişiniz:\n\n• 1x İskender — 380 ₺\n• 1x Mercimek Çorbası — 80 ₺\n• 2x Ayran — 60 ₺\n\n💰 Toplam: 520 ₺\n\nOnaylıyor musunuz?', ago: 4 },
      ],
      order: {
        status: 'PENDING_CONFIRMATION', total: 520, ago: 4,
        items: [
          { id: 'di-iskender', name: 'İskender', qty: 1, price: 380 },
          { id: 'di-mercimek', name: 'Mercimek Çorbası', qty: 1, price: 80 },
          { id: 'di-ayran', name: 'Ayran', qty: 2, price: 30 },
        ],
      },
    },
    // 3) Delivered - completed order
    {
      custIdx: 2, status: 'CLOSED',
      msgs: [
        { dir: 'IN', text: 'selam 3 lahmacun 1 şalgam', ago: 180 },
        { dir: 'OUT', text: '📋 Siparişiniz:\n\n• 3x Lahmacun — 360 ₺\n• 1x Şalgam — 40 ₺\n\n💰 Toplam: 400 ₺\n\nOnaylıyor musunuz?', ago: 179 },
        { dir: 'IN', text: 'onay', ago: 178 },
        { dir: 'OUT', text: '✅ Siparişiniz teslim edildi! Afiyet olsun 🍽️\nBizi değerlendirmenizi rica ederiz.', ago: 120 },
      ],
      order: {
        status: 'DELIVERED', total: 400, ago: 120, payment: 'CASH', delivery: 'DELIVERY',
        items: [
          { id: 'di-lahmacun', name: 'Lahmacun', qty: 3, price: 120 },
          { id: 'di-salgam', name: 'Şalgam', qty: 1, price: 40 },
        ],
      },
    },
    // 4) Agent handoff - customer complaint
    {
      custIdx: 3, status: 'PENDING_AGENT',
      msgs: [
        { dir: 'IN', text: 'siparişim 1 saat oldu hala gelmedi!', ago: 45 },
        { dir: 'OUT', text: 'Çok üzgünüz Fatma Hanım! Siparişiniz ile ilgili bilgi almak için sizi bir temsilcimize yönlendiriyorum. Lütfen bekleyiniz...', ago: 44 },
        { dir: 'IN', text: 'bekliyorum ama çok kızgınım', ago: 40 },
      ],
    },
    // 5) Ready for pickup (gel al)
    {
      custIdx: 4, status: 'OPEN',
      msgs: [
        { dir: 'IN', text: '2 döner dürüm 1 kola', ago: 35 },
        { dir: 'OUT', text: '📋 Siparişiniz:\n\n• 2x Döner Dürüm — 360 ₺\n• 1x Coca Cola — 60 ₺\n\n💰 Toplam: 420 ₺\n🎁 Gel Al İndirimi (%10): -42 ₺\n💰 Ödenecek: 378 ₺\n\nOnaylıyor musunuz?', ago: 34 },
        { dir: 'IN', text: 'evet onay', ago: 33 },
        { dir: 'OUT', text: '✅ Siparişiniz hazır! 🎉\n\n🏪 Merkez Şube - Atatürk Cad. No:42\n📋 Sipariş #345\n💰 378 ₺ (Nakit)\n\nGeldiğinizde sipariş numaranızı söylemeniz yeterli.', ago: 20 },
      ],
      order: {
        status: 'READY', total: 378, ago: 20, payment: 'CASH', delivery: 'PICKUP',
        items: [
          { id: 'di-doner-durum', name: 'Döner Dürüm', qty: 2, price: 180 },
          { id: 'di-kola', name: 'Coca Cola', qty: 1, price: 60 },
        ],
      },
    },
    // 6-12) More delivered orders for stats
    ...([5, 6, 7, 8, 9, 10, 11] as number[]).map((idx, i) => ({
      custIdx: idx, status: 'CLOSED' as ConversationStatus,
      msgs: [
        { dir: 'IN' as const, text: 'sipariş vermek istiyorum', ago: 300 + i * 200 },
        { dir: 'OUT' as const, text: 'Siparişiniz alındı, afiyet olsun!', ago: 280 + i * 200 },
      ],
      order: {
        status: 'DELIVERED' as OrderStatus,
        total: [450, 680, 320, 560, 290, 840, 410][i],
        ago: 280 + i * 200,
        payment: i % 2 === 0 ? 'CASH' : 'CREDIT_CARD',
        delivery: i % 3 === 0 ? 'PICKUP' : 'DELIVERY',
        items: [
          [
            { id: 'di-iskender', name: 'İskender', qty: 1, price: 380 },
            { id: 'di-ayran', name: 'Ayran', qty: 2, price: 30 },
          ],
          [
            { id: 'di-adana', name: 'Adana Kebap', qty: 2, price: 320 },
            { id: 'di-ayran', name: 'Ayran', qty: 1, price: 30 },
          ],
          [
            { id: 'di-kofte', name: 'Izgara Köfte', qty: 1, price: 260 },
            { id: 'di-su', name: 'Su', qty: 2, price: 15 },
          ],
          [
            { id: 'di-kusbasi-pide', name: 'Kuşbaşılı Pide', qty: 2, price: 280 },
          ],
          [
            { id: 'di-doner-ekmek', name: 'Döner Ekmek', qty: 1, price: 160 },
            { id: 'di-cay', name: 'Çay', qty: 3, price: 25 },
          ],
          [
            { id: 'di-kunefe', name: 'Künefe', qty: 2, price: 180 },
            { id: 'di-baklava', name: 'Baklava', qty: 2, price: 200 },
          ],
          [
            { id: 'di-tavuk-sis', name: 'Tavuk Şiş', qty: 1, price: 280 },
            { id: 'di-mercimek', name: 'Mercimek Çorbası', qty: 1, price: 80 },
          ],
        ][i],
      },
    })),
  ];

  let orderNum = 340;
  for (const cd of convData) {
    const c = customers[cd.custIdx];
    const conv = await prisma.conversation.upsert({
      where: { tenantId_customerPhone: { tenantId: tenant.id, customerPhone: c.phone } },
      update: { status: cd.status, customerName: c.name, lastMessageAt: minsAgo(cd.msgs[cd.msgs.length - 1].ago) },
      create: {
        tenantId: tenant.id, customerPhone: c.phone, customerName: c.name,
        status: cd.status, customerLat: c.lat, customerLng: c.lng,
        isWithinService: true, nearestStoreId: store1.id,
        kvkkConsentAt: daysAgo(Math.floor(Math.random() * 30) + 1),
        lastMessageAt: minsAgo(cd.msgs[cd.msgs.length - 1].ago),
      },
    });

    // Clear old messages for this conversation
    await prisma.message.deleteMany({ where: { conversationId: conv.id } });
    for (const m of cd.msgs) {
      await prisma.message.create({
        data: {
          tenantId: tenant.id, conversationId: conv.id,
          direction: m.dir, kind: 'TEXT', text: m.text,
          createdAt: minsAgo(m.ago),
        },
      });
    }

    if (cd.order) {
      orderNum++;
      // Delete existing orders for this conversation
      await prisma.orderItem.deleteMany({ where: { order: { conversationId: conv.id } } });
      await prisma.order.deleteMany({ where: { conversationId: conv.id } });
      const order = await prisma.order.create({
        data: {
          tenantId: tenant.id, conversationId: conv.id, storeId: store1.id,
          orderNumber: orderNum, status: cd.order.status,
          totalPrice: cd.order.total, paymentMethod: cd.order.payment || null,
          deliveryType: cd.order.delivery || null,
          customerPhone: c.phone, customerName: c.name,
          deliveryAddress: cd.order.delivery === 'DELIVERY' ? `${c.name} - İstanbul` : null,
          createdAt: minsAgo(cd.order.ago),
          confirmedAt: ['PREPARING', 'READY', 'DELIVERED'].includes(cd.order.status) ? minsAgo(cd.order.ago - 2) : null,
          items: {
            create: cd.order.items.map(it => ({
              menuItemId: it.id, menuItemName: it.name, qty: it.qty, unitPrice: it.price,
            })),
          },
        },
      });
      // Link active order to conversation
      if (['PENDING_CONFIRMATION', 'PREPARING', 'READY'].includes(cd.order.status)) {
        await prisma.conversation.update({ where: { id: conv.id }, data: { activeOrderId: order.id } });
      }
    }
  }
  console.log(`✓ ${convData.length} konuşma ve sipariş oluşturuldu`);

  // ==================== CUSTOMER PROFILES ====================
  for (const c of customers) {
    await prisma.customerProfile.upsert({
      where: { tenantId_customerPhone: { tenantId: tenant.id, customerPhone: c.phone } },
      update: {},
      create: {
        tenantId: tenant.id, customerPhone: c.phone, customerName: c.name,
        segment: ['ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE', 'SLEEPING', 'NEW', 'ACTIVE', 'SLEEPING', 'ACTIVE', 'NEW', 'ACTIVE', 'ACTIVE'][customers.indexOf(c)] as any,
        broadcastOptIn: customers.indexOf(c) < 8 ? 'OPTED_IN' : 'PENDING',
        marketingConsent: customers.indexOf(c) < 8,
        orderCount: Math.floor(Math.random() * 15) + 1,
        totalSpent: Math.floor(Math.random() * 5000) + 200,
        lastOrderAt: daysAgo(Math.floor(Math.random() * 14)),
      },
    });
  }
  console.log('✓ 12 müşteri profili oluşturuldu');

  // ==================== SURVEYS ====================
  const convList = await prisma.conversation.findMany({ where: { tenantId: tenant.id }, take: 5 });
  const orderList = await prisma.order.findMany({ where: { tenantId: tenant.id, status: 'DELIVERED' }, take: 5 });
  for (let i = 0; i < Math.min(orderList.length, 4); i++) {
    const o = orderList[i];
    await prisma.satisfactionSurvey.create({
      data: {
        tenantId: tenant.id,
        conversationId: convList[i % convList.length].id,
        orderId: o.id,
        customerPhone: o.customerPhone || customers[i].phone,
        customerName: o.customerName || customers[i].name,
        rating: [5, 4, 2, 5][i],
        comment: [null, 'Harika lezzetler!', 'Sipariş geç geldi, soğumuştu.', null][i],
        isComplaint: i === 2,
        createdAt: daysAgo(i + 1),
      },
    });
  }
  console.log('✓ 4 anket/geri bildirim oluşturuldu');

  // ==================== DONE ====================
  console.log('\n' + '='.repeat(50));
  console.log('✅ DEMO HESABI HAZIR!');
  console.log('='.repeat(50));
  console.log('\n📋 GİRİŞ BİLGİLERİ:\n');
  console.log('   E-posta: demo@superpersonel.com');
  console.log('   Şifre:   demo2026');
  console.log(`\n🏢 Tenant: ${tenant.name} (${tenant.id})`);
  console.log('   Plan: Gold | Şube: 2 | Ürün: 24 | Sipariş: 12');
  console.log('');
}

main()
  .catch((e) => { console.error('❌ Seed failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
