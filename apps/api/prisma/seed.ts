import { PrismaClient, MemberRole } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import * as bcrypt from 'bcrypt';

const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/whatres_db?schema=public';

const pool = new pg.Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Seeding database...\n');

  // ==================== TENANT ====================
  console.log('Creating tenant...');
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo-restaurant' },
    update: {},
    create: {
      name: 'Demo Restaurant',
      slug: 'demo-restaurant',
    },
  });
  console.log(`✓ Tenant: ${tenant.name} (${tenant.id})\n`);

  // ==================== USERS ====================
  console.log('Creating users...');
  const passwordHash = await bcrypt.hash('password123', 12);

  const users = [
    { email: 'owner@demo.com', name: 'Ali Yılmaz', role: MemberRole.OWNER },
    { email: 'admin@demo.com', name: 'Ayşe Demir', role: MemberRole.ADMIN },
    { email: 'agent@demo.com', name: 'Mehmet Kaya', role: MemberRole.AGENT },
    { email: 'staff@demo.com', name: 'Fatma Öz', role: MemberRole.STAFF },
  ];

  for (const userData of users) {
    const user = await prisma.user.upsert({
      where: { email: userData.email },
      update: {},
      create: {
        email: userData.email,
        name: userData.name,
        passwordHash,
      },
    });

    await prisma.membership.upsert({
      where: {
        tenantId_userId: { tenantId: tenant.id, userId: user.id },
      },
      update: { role: userData.role },
      create: {
        tenantId: tenant.id,
        userId: user.id,
        role: userData.role,
      },
    });

    console.log(`✓ User: ${userData.email} (${userData.role})`);
  }

  // ==================== STORES ====================
  console.log('\nCreating stores...');
  
  const storesData = [
    {
      name: 'Merkez Şube',
      address: 'İstiklal Cad. No:123, Beyoğlu, İstanbul',
      lat: 41.0336,
      lng: 28.9770,
      phone: '0212 555 1234',
      radiusKm: 5,
      minBasket: 50,
      deliveryFee: 15,
    },
    {
      name: 'Kadıköy Şube',
      address: 'Bağdat Cad. No:456, Kadıköy, İstanbul',
      lat: 40.9906,
      lng: 29.0297,
      phone: '0216 555 5678',
      radiusKm: 4,
      minBasket: 60,
      deliveryFee: 12,
    },
    {
      name: 'Beşiktaş Şube',
      address: 'Barbaros Bulvarı No:789, Beşiktaş, İstanbul',
      lat: 41.0422,
      lng: 29.0067,
      phone: '0212 555 9012',
      radiusKm: 3,
      minBasket: 75,
      deliveryFee: 10,
    },
  ];

  for (const storeData of storesData) {
    const store = await prisma.store.upsert({
      where: {
        id: `store-${storeData.name.toLowerCase().replace(/\s+/g, '-')}`,
      },
      update: {},
      create: {
        id: `store-${storeData.name.toLowerCase().replace(/\s+/g, '-')}`,
        tenantId: tenant.id,
        name: storeData.name,
        address: storeData.address,
        lat: storeData.lat,
        lng: storeData.lng,
        phone: storeData.phone,
        isActive: true,
      },
    });

    await prisma.deliveryRule.upsert({
      where: {
        id: `rule-${store.id}`,
      },
      update: {},
      create: {
        id: `rule-${store.id}`,
        tenantId: tenant.id,
        storeId: store.id,
        radiusKm: storeData.radiusKm,
        minBasket: storeData.minBasket,
        deliveryFee: storeData.deliveryFee,
        isActive: true,
      },
    });

    console.log(`✓ Store: ${storeData.name} (${storeData.radiusKm}km radius)`);
  }

  // ==================== MENU ====================
  console.log('\nCreating menu...');
  
  const menuVersion = await prisma.menuVersion.upsert({
    where: { id: 'menu-v1' },
    update: {},
    create: {
      id: 'menu-v1',
      tenantId: tenant.id,
      version: 1,
      publishedAt: new Date(),
    },
  });

  const menuItems = [
    // Burgerler
    { name: 'Klasik Burger', category: 'Burgerler', basePrice: 120, description: 'Dana köfte, marul, domates, turşu, özel sos' },
    { name: 'Cheese Burger', category: 'Burgerler', basePrice: 135, description: 'Dana köfte, cheddar peyniri, marul, domates' },
    { name: 'Double Burger', category: 'Burgerler', basePrice: 165, description: 'Çift dana köfte, çift cheddar, özel sos' },
    { name: 'Tavuk Burger', category: 'Burgerler', basePrice: 110, description: 'Izgara tavuk, marul, domates, mayonez' },
    
    // Pizzalar
    { name: 'Margarita Pizza', category: 'Pizzalar', basePrice: 140, description: 'Domates sos, mozzarella, fesleğen' },
    { name: 'Karışık Pizza', category: 'Pizzalar', basePrice: 170, description: 'Sucuk, sosis, mantar, biber, mozzarella' },
    { name: 'Pepperoni Pizza', category: 'Pizzalar', basePrice: 160, description: 'Pepperoni, mozzarella, domates sos' },
    
    // Dönerler
    { name: 'Tavuk Döner', category: 'Dönerler', basePrice: 95, description: 'Tavuk döner, pilav veya ekmek arası' },
    { name: 'Et Döner', category: 'Dönerler', basePrice: 130, description: 'Dana döner, pilav veya ekmek arası' },
    { name: 'İskender', category: 'Dönerler', basePrice: 180, description: 'Dana döner, tereyağı, yoğurt, domates sos' },
    
    // İçecekler
    { name: 'Kola', category: 'İçecekler', basePrice: 25, description: '330ml' },
    { name: 'Ayran', category: 'İçecekler', basePrice: 15, description: '300ml' },
    { name: 'Su', category: 'İçecekler', basePrice: 10, description: '500ml' },
    { name: 'Limonata', category: 'İçecekler', basePrice: 30, description: 'Ev yapımı, 300ml' },
    
    // Tatlılar
    { name: 'Künefe', category: 'Tatlılar', basePrice: 85, description: 'Antep fıstıklı künefe' },
    { name: 'Sütlaç', category: 'Tatlılar', basePrice: 45, description: 'Fırın sütlaç' },
    { name: 'Baklava', category: 'Tatlılar', basePrice: 95, description: '4 dilim fıstıklı baklava' },
  ];

  for (const item of menuItems) {
    await prisma.menuItem.upsert({
      where: { id: `item-${item.name.toLowerCase().replace(/\s+/g, '-')}` },
      update: {},
      create: {
        id: `item-${item.name.toLowerCase().replace(/\s+/g, '-')}`,
        tenantId: tenant.id,
        versionId: menuVersion.id,
        name: item.name,
        description: item.description,
        category: item.category,
        basePrice: item.basePrice,
        isActive: true,
      },
    });
  }
  console.log(`✓ Menu: ${menuItems.length} items created`);

  // Menu Option Groups
  const burgerOptionGroup = await prisma.menuOptionGroup.upsert({
    where: { id: 'og-burger-boyut' },
    update: {},
    create: {
      id: 'og-burger-boyut',
      tenantId: tenant.id,
      versionId: menuVersion.id,
      name: 'Boyut',
      type: 'SINGLE',
    },
  });

  await prisma.menuOption.createMany({
    skipDuplicates: true,
    data: [
      { id: 'opt-normal', tenantId: tenant.id, versionId: menuVersion.id, groupId: burgerOptionGroup.id, name: 'Normal', priceDelta: 0 },
      { id: 'opt-buyuk', tenantId: tenant.id, versionId: menuVersion.id, groupId: burgerOptionGroup.id, name: 'Büyük', priceDelta: 25 },
      { id: 'opt-mega', tenantId: tenant.id, versionId: menuVersion.id, groupId: burgerOptionGroup.id, name: 'Mega', priceDelta: 45 },
    ],
  });

  const pizzaOptionGroup = await prisma.menuOptionGroup.upsert({
    where: { id: 'og-pizza-boyut' },
    update: {},
    create: {
      id: 'og-pizza-boyut',
      tenantId: tenant.id,
      versionId: menuVersion.id,
      name: 'Boyut',
      type: 'SINGLE',
    },
  });

  await prisma.menuOption.createMany({
    skipDuplicates: true,
    data: [
      { id: 'opt-pizza-kucuk', tenantId: tenant.id, versionId: menuVersion.id, groupId: pizzaOptionGroup.id, name: 'Küçük', priceDelta: 0 },
      { id: 'opt-pizza-orta', tenantId: tenant.id, versionId: menuVersion.id, groupId: pizzaOptionGroup.id, name: 'Orta', priceDelta: 30 },
      { id: 'opt-pizza-buyuk', tenantId: tenant.id, versionId: menuVersion.id, groupId: pizzaOptionGroup.id, name: 'Büyük', priceDelta: 50 },
    ],
  });

  console.log('✓ Option groups created');

  // ==================== SAMPLE CONVERSATION ====================
  console.log('\nCreating sample conversation...');
  
  const conversation = await prisma.conversation.upsert({
    where: {
      tenantId_customerPhone: {
        tenantId: tenant.id,
        customerPhone: '905551234567',
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      customerPhone: '905551234567',
      customerName: 'Ahmet Müşteri',
      status: 'OPEN',
      customerLat: 41.0285,
      customerLng: 28.9745,
      isWithinService: true,
    },
  });

  const messages = [
    { direction: 'IN', kind: 'TEXT', text: 'Merhaba, sipariş vermek istiyorum' },
    { direction: 'OUT', kind: 'TEXT', text: 'Merhaba! Size nasıl yardımcı olabilirim? Menümüzü görmek ister misiniz?' },
    { direction: 'IN', kind: 'TEXT', text: '1 adet cheese burger ve 1 kola istiyorum' },
    { direction: 'OUT', kind: 'TEXT', text: 'Tabii! 1x Cheese Burger (135 TL) ve 1x Kola (25 TL) - Toplam: 160 TL. Onaylıyor musunuz?' },
    { direction: 'IN', kind: 'TEXT', text: 'Evet onaylıyorum' },
  ];

  for (let i = 0; i < messages.length; i++) {
    await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        direction: messages[i].direction as 'IN' | 'OUT',
        kind: messages[i].kind as 'TEXT',
        text: messages[i].text,
        createdAt: new Date(Date.now() - (messages.length - i) * 60000), // 1 minute apart
      },
    });
  }

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  });

  console.log(`✓ Conversation with ${messages.length} messages`);

  // ==================== SUMMARY ====================
  console.log('\n' + '='.repeat(50));
  console.log('✅ SEED COMPLETED!');
  console.log('='.repeat(50));
  console.log('\n📋 TEST KULLANICILARI:\n');
  console.log('┌─────────────────────┬──────────────┬──────────┐');
  console.log('│ Email               │ Şifre        │ Rol      │');
  console.log('├─────────────────────┼──────────────┼──────────┤');
  console.log('│ owner@demo.com      │ password123  │ OWNER    │');
  console.log('│ admin@demo.com      │ password123  │ ADMIN    │');
  console.log('│ agent@demo.com      │ password123  │ AGENT    │');
  console.log('│ staff@demo.com      │ password123  │ STAFF    │');
  console.log('└─────────────────────┴──────────────┴──────────┘');
  console.log(`\n🏢 Tenant ID: ${tenant.id}`);
  console.log('\n📍 Test Koordinatları (İstanbul):');
  console.log('   Taksim:   41.0336, 28.9770');
  console.log('   Kadıköy:  40.9906, 29.0297');
  console.log('   Beşiktaş: 41.0422, 29.0067');
  console.log('\n🔗 Giriş: http://localhost:4200/login');
  console.log('');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

