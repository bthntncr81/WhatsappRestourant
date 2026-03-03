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
    // Pizza
    { name: 'Margherita', category: 'Pizza', basePrice: 300, description: 'Domates sos, mozzarella, taze fesleğen. İtalyan klasiği!' },
    { name: 'Marinara', category: 'Pizza', basePrice: 250, description: 'Domates sos, sarımsak. Peynir sevmeyenler için sade lezzet!' },
    { name: 'Acılı', category: 'Pizza', basePrice: 400, description: 'Domates sos, mozzarella, sucuk, jalapeno, kırmızı biber. Cesurlar için!' },
    { name: 'Dört Peynirli', category: 'Pizza', basePrice: 350, description: 'Domates sos, mozzarella, cheddar, parmesan, gorgonzola. Peynir cenneti!' },
    { name: 'Karışık', category: 'Pizza', basePrice: 400, description: 'Domates sos, mozzarella, sucuk, salam, mantar. Her şeyden biraz!' },
    { name: 'Pepperoni', category: 'Pizza', basePrice: 400, description: 'Domates sosu, mozarella, sucuk, parmesan' },
    { name: 'Kavurmalı', category: 'Pizza', basePrice: 550, description: 'Domates sos, mozzarella, kavurma, mısır. Türk damak tadına özel!' },
    { name: 'Füme Mantar', category: 'Pizza', basePrice: 550, description: 'Domates sos, mozzarella, füme et, mantar. Duman aroması!' },
    { name: 'Et Partisi', category: 'Pizza', basePrice: 550, description: 'Domates sos, mozzarella, ıslı et, sucuk, acı sos. Protein şöleni!' },
    { name: 'High Five Özel', category: 'Pizza', basePrice: 450, description: 'Domates sos, mozzarella, sucuk, füme et, biber. Şefin imzası!' },

    // Makarna
    { name: 'Kremalı Mantarlı', category: 'Makarna', basePrice: 200, description: 'Krema sos, taze mantar. Hafif ve lezzetli!' },
    { name: 'Napolitan', category: 'Makarna', basePrice: 200, description: 'Domates sos, parmesan.' },
    { name: 'Arabiatta', category: 'Makarna', basePrice: 200, description: 'Acılı domates sos' },
    { name: 'Köz Biberli', category: 'Makarna', basePrice: 200, description: 'Krema sos, kaşar, köz biber. Hafif tütsü aroması!' },
    { name: 'Köz Patlıcanlı', category: 'Makarna', basePrice: 200, description: 'Domates sos, köz patlıcan. Türk mutfağı esintisi!' },
    { name: 'Pesto', category: 'Makarna', basePrice: 250, description: 'Pesto soslu parmesan krema' },
    { name: 'Beşamel Soslu', category: 'Makarna', basePrice: 275, description: 'Beşamel sos, kaşar peyniri. Kremsi lezzet!' },
    { name: '4 Peynirli Makarna', category: 'Makarna', basePrice: 300, description: 'Peynir sos, krema, 4 çeşit peynir. Peynir tutkunlarına!' },
    { name: 'Acılı Sosisli', category: 'Makarna', basePrice: 350, description: 'Domates sos, sosis' },
    { name: 'Etli Mantarlı', category: 'Makarna', basePrice: 450, description: 'Özel sos, füme et, mantar. Doyurucu lezzet!' },
    { name: 'High Five Makarna', category: 'Makarna', basePrice: 450, description: 'Özel sos, füme et, parmesan, kaşar. Şefin imzası!' },

    // İçecek
    { name: 'Ayran', category: 'İçecek', basePrice: 20, description: 'Geleneksel, köpüklü', isReadyFood: true },
    { name: 'Limonata', category: 'İçecek', basePrice: 35, description: 'Taze sıkılmış, ev yapımı', isReadyFood: true },
    { name: 'Damla Su', category: 'İçecek', basePrice: 40, description: '', isReadyFood: true },
    { name: 'Coca Cola Şişe', category: 'İçecek', basePrice: 80, description: '', isReadyFood: true },
    { name: 'Coca Cola Zero Şişe', category: 'İçecek', basePrice: 80, description: '', isReadyFood: true },
    { name: 'Fanta Şişe', category: 'İçecek', basePrice: 80, description: '', isReadyFood: true },
    { name: 'Sprite Şişe', category: 'İçecek', basePrice: 80, description: '', isReadyFood: true },
    { name: 'Cappy Vişne', category: 'İçecek', basePrice: 80, description: '', isReadyFood: true },
    { name: 'Cappy Şeftali', category: 'İçecek', basePrice: 80, description: '', isReadyFood: true },
    { name: 'Cappy Karışık', category: 'İçecek', basePrice: 80, description: '', isReadyFood: true },
    { name: 'Fusetea Şeftali', category: 'İçecek', basePrice: 80, description: '', isReadyFood: true },
    { name: 'Fusetea Limon', category: 'İçecek', basePrice: 80, description: '', isReadyFood: true },
    { name: 'Fusetea Mango', category: 'İçecek', basePrice: 80, description: '', isReadyFood: true },

    // Tatlı
    { name: 'Tiramisu', category: 'Tatlı', basePrice: 75, description: 'İtalyan klasiği, kahve ve mascarpone' },
    { name: 'Çikolatalı Sufle', category: 'Tatlı', basePrice: 85, description: 'Sıcak servis, akan çikolata' },
  ];

  for (const item of menuItems) {
    const itemId = `item-${item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')}`;
    await prisma.menuItem.upsert({
      where: { id: itemId },
      update: {
        name: item.name,
        description: item.description || '',
        category: item.category,
        basePrice: item.basePrice,
        isActive: true,
        isReadyFood: (item as any).isReadyFood || false,
      },
      create: {
        id: itemId,
        tenantId: tenant.id,
        versionId: menuVersion.id,
        name: item.name,
        description: item.description || '',
        category: item.category,
        basePrice: item.basePrice,
        isActive: true,
        isReadyFood: (item as any).isReadyFood || false,
      },
    });
  }
  console.log(`✓ Menu: ${menuItems.length} items created`);

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
    { direction: 'IN', kind: 'TEXT', text: '1 adet karışık pizza ve 1 coca cola istiyorum' },
    { direction: 'OUT', kind: 'TEXT', text: 'Tabii! 1x Karışık Pizza (400 TL) ve 1x Coca Cola Şişe (80 TL) - Toplam: 480 TL. Onaylıyor musunuz?' },
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

