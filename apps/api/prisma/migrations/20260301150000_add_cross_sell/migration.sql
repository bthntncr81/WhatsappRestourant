-- Create cross_sell_rules table
CREATE TABLE IF NOT EXISTS "cross_sell_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "triggerItemId" TEXT NOT NULL,
    "suggestItemId" TEXT NOT NULL,
    "message" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cross_sell_rules_pkey" PRIMARY KEY ("id")
);

-- Create upsell_events table
CREATE TABLE IF NOT EXISTS "upsell_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "suggestedItemId" TEXT NOT NULL,
    "suggestedName" TEXT NOT NULL,
    "accepted" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upsell_events_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "cross_sell_rules_tenantId_triggerItemId_idx" ON "cross_sell_rules"("tenantId", "triggerItemId");
CREATE INDEX IF NOT EXISTS "upsell_events_tenantId_createdAt_idx" ON "upsell_events"("tenantId", "createdAt");

-- Foreign keys
ALTER TABLE "cross_sell_rules" ADD CONSTRAINT "cross_sell_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cross_sell_rules" ADD CONSTRAINT "cross_sell_rules_triggerItemId_fkey" FOREIGN KEY ("triggerItemId") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cross_sell_rules" ADD CONSTRAINT "cross_sell_rules_suggestItemId_fkey" FOREIGN KEY ("suggestItemId") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "upsell_events" ADD CONSTRAINT "upsell_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "upsell_events" ADD CONSTRAINT "upsell_events_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add flowMetadata column to conversations
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "flowMetadata" TEXT;
