import { getConfig } from '@whatres/config';
import { broadcastService } from '../../api/src/services/broadcast.service';
import { inactivityTimeoutService } from '../../api/src/services/inactivity-timeout.service';
import { billingService } from '../../api/src/services/billing.service';
import { posIntegrationService } from '../../api/src/services/pos-integration.service';
import prisma from '../../api/src/db/prisma';

const config = getConfig();

console.log('Worker starting...');
console.log(`Environment: ${config.server.nodeEnv}`);
console.log(`Redis: ${config.redis.host}:${config.redis.port}`);

// Campaign send processor: runs every 60 seconds
const SEND_INTERVAL_MS = 60_000;

async function processCampaignSends() {
  try {
    const result = await broadcastService.processPendingSends();
    if (result.sent > 0 || result.failed > 0) {
      console.log(
        `Campaign sends: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped`,
      );
    }
  } catch (err) {
    console.error('Campaign send processing error:', err);
  }
}

// Customer profile sync: runs every 6 hours
const SYNC_INTERVAL_MS = 6 * 60 * 60_000;

async function syncProfiles() {
  try {
    const tenants = await prisma.broadcastSettings.findMany({
      where: { isEnabled: true },
      select: { tenantId: true },
    });
    for (const t of tenants) {
      const result = await broadcastService.syncCustomerProfiles(t.tenantId);
      if (result.created > 0 || result.updated > 0) {
        console.log(
          `Profile sync [${t.tenantId}]: ${result.created} created, ${result.updated} updated`,
        );
      }
    }
  } catch (err) {
    console.error('Profile sync error:', err);
  }
}

// Inactivity timeout processor: runs every 30 seconds
const INACTIVITY_CHECK_INTERVAL_MS = 30_000;

async function processInactivityTimeouts() {
  try {
    const warnings = await inactivityTimeoutService.sendInactivityWarnings();
    const cancellations = await inactivityTimeoutService.cancelInactiveOrders();
    if (warnings.warned > 0 || cancellations.cancelled > 0) {
      console.log(
        `Inactivity timeout: ${warnings.warned} warned, ${cancellations.cancelled} cancelled`,
      );
    }
  } catch (err) {
    console.error('Inactivity timeout processing error:', err);
  }
}

// Subscription lifecycle: runs every 5 minutes
const SUBSCRIPTION_CHECK_INTERVAL_MS = 5 * 60_000;

async function processSubscriptionLifecycle() {
  try {
    const result = await billingService.processSubscriptionLifecycle();
    if (result.expired > 0 || result.warned > 0) {
      console.log(
        `Subscription lifecycle: ${result.expired} expired, ${result.warned} expiring soon`,
      );
    }
  } catch (err) {
    console.error('Subscription lifecycle error:', err);
  }
}

// POS menu sync: runs every 10 minutes.
// For every POS-connected tenant, compares the POS menu hash with the last
// synced hash and pulls the menu only when it changed. Errors on one tenant
// never block the others.
const POS_MENU_SYNC_INTERVAL_MS = 10 * 60_000;
let posMenuSyncRunning = false;

async function syncPosMenus() {
  if (posMenuSyncRunning) return; // avoid overlapping runs on slow syncs
  posMenuSyncRunning = true;
  try {
    const tenants = await prisma.tenant.findMany({
      where: { posApiUrl: { not: null }, posApiKey: { not: null } },
      select: { id: true, name: true },
    });

    for (const t of tenants) {
      try {
        const changed = await posIntegrationService.checkMenuChanged(t.id);
        if (!changed) continue;

        const result = await posIntegrationService.pullMenu(t.id);
        console.log(
          `POS menu sync [${t.id}] (${t.name}): ${result.itemsCreated} items, ` +
            `${result.optionGroupsCreated} option groups, ${result.categoriesFound} categories (version ${result.versionId})`,
        );
      } catch (err) {
        console.error(`POS menu sync error [${t.id}] (${t.name}):`, err);
        // continue with next tenant
      }
    }
  } catch (err) {
    console.error('POS menu sync loop error:', err);
  } finally {
    posMenuSyncRunning = false;
  }
}

async function main() {
  console.log('Worker is ready');

  // Start background loops
  setInterval(processCampaignSends, SEND_INTERVAL_MS);
  setInterval(syncProfiles, SYNC_INTERVAL_MS);
  setInterval(processInactivityTimeouts, INACTIVITY_CHECK_INTERVAL_MS);
  setInterval(processSubscriptionLifecycle, SUBSCRIPTION_CHECK_INTERVAL_MS);
  setInterval(syncPosMenus, POS_MENU_SYNC_INTERVAL_MS);

  // Run initial sync after 10 seconds
  setTimeout(syncProfiles, 10_000);
  // Run initial POS menu check after 30 seconds
  setTimeout(syncPosMenus, 30_000);

  process.on('SIGTERM', () => {
    console.log('Worker shutting down...');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('Worker shutting down...');
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Worker failed to start:', error);
  process.exit(1);
});
