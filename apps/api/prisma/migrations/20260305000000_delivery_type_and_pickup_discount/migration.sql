-- Add delivery type and discount fields to orders
ALTER TABLE "orders" ADD COLUMN "deliveryType" TEXT;
ALTER TABLE "orders" ADD COLUMN "discountPercent" INTEGER;
ALTER TABLE "orders" ADD COLUMN "discountAmount" DECIMAL(10,2);

-- Add pickup discount setting to tenants
ALTER TABLE "tenants" ADD COLUMN "pickupDiscountPercent" INTEGER;

-- Add DELIVERY_TYPE_SELECTION to ConversationPhase enum
ALTER TYPE "ConversationPhase" ADD VALUE 'DELIVERY_TYPE_SELECTION';
