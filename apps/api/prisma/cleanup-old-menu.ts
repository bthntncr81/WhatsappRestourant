import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/whatres_db?schema=public';
const pool = new pg.Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function cleanup() {
  console.log('Cleaning up old menu items...');

  // Delete old demo category items that no longer exist in the new menu
  const oldCategories = ['Burgerler', 'Pizzalar', 'Dönerler', 'İçecekler', 'Tatlılar'];

  // Delete synonyms referencing old items first
  const oldItems = await prisma.menuItem.findMany({
    where: { category: { in: oldCategories } },
    select: { id: true, name: true },
  });

  if (oldItems.length > 0) {
    const oldItemIds = oldItems.map(i => i.id);

    // Delete synonyms for old items
    const deletedSynonyms = await prisma.menuSynonym.deleteMany({
      where: { mapsToItemId: { in: oldItemIds } },
    });
    console.log(`Deleted ${deletedSynonyms.count} old synonyms`);

    // Delete old items
    const deleted = await prisma.menuItem.deleteMany({
      where: { category: { in: oldCategories } },
    });
    console.log(`Deleted ${deleted.count} old menu items`);
  } else {
    console.log('No old items to delete');
  }

  // Delete old option groups (burger/pizza boyut)
  const oldOptionGroups = await prisma.menuOptionGroup.findMany({
    where: { id: { in: ['og-burger-boyut', 'og-pizza-boyut'] } },
  });

  for (const og of oldOptionGroups) {
    await prisma.menuOption.deleteMany({ where: { groupId: og.id } });
    await prisma.menuOptionGroup.delete({ where: { id: og.id } });
    console.log(`Deleted option group: ${og.name} (${og.id})`);
  }

  // Show remaining items
  const remaining = await prisma.menuItem.findMany({
    select: { name: true, category: true, basePrice: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });

  console.log(`\nRemaining menu: ${remaining.length} items`);
  let currentCat = '';
  for (const item of remaining) {
    if (item.category !== currentCat) {
      currentCat = item.category;
      console.log(`\n  ${currentCat}:`);
    }
    console.log(`    - ${item.name} (${Number(item.basePrice)} TL)`);
  }

  await prisma.$disconnect();
  console.log('\n✅ Cleanup done!');
}

cleanup().catch((e) => {
  console.error('Cleanup failed:', e);
  process.exit(1);
});
