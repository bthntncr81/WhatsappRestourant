-- Add new ConversationPhase enum values
ALTER TYPE "ConversationPhase" ADD VALUE IF NOT EXISTS 'ADDRESS_SELECTION';
ALTER TYPE "ConversationPhase" ADD VALUE IF NOT EXISTS 'ADDRESS_SAVE_PROMPT';

-- Add isOpen to stores
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "isOpen" BOOLEAN NOT NULL DEFAULT true;

-- Add flowSubState to conversations
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "flowSubState" TEXT;

-- Create saved_addresses table
CREATE TABLE IF NOT EXISTS "saved_addresses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "storeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_addresses_pkey" PRIMARY KEY ("id")
);

-- Create index on saved_addresses
CREATE INDEX IF NOT EXISTS "saved_addresses_tenantId_customerPhone_idx" ON "saved_addresses"("tenantId", "customerPhone");

-- Add foreign keys
ALTER TABLE "saved_addresses" ADD CONSTRAINT "saved_addresses_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "saved_addresses" ADD CONSTRAINT "saved_addresses_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
