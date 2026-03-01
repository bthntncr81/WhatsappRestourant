-- Add new ConversationPhase enum values
ALTER TYPE "ConversationPhase" ADD VALUE IF NOT EXISTS 'ADDRESS_SELECTION';
ALTER TYPE "ConversationPhase" ADD VALUE IF NOT EXISTS 'ADDRESS_SAVE_PROMPT';

-- Add isOpen to stores
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "is_open" BOOLEAN NOT NULL DEFAULT true;

-- Add flowSubState to conversations
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "flow_sub_state" TEXT;

-- Create saved_addresses table
CREATE TABLE IF NOT EXISTS "saved_addresses" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "store_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_addresses_pkey" PRIMARY KEY ("id")
);

-- Create index on saved_addresses
CREATE INDEX IF NOT EXISTS "saved_addresses_tenant_id_customer_phone_idx" ON "saved_addresses"("tenant_id", "customer_phone");

-- Add foreign keys
ALTER TABLE "saved_addresses" ADD CONSTRAINT "saved_addresses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "saved_addresses" ADD CONSTRAINT "saved_addresses_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
