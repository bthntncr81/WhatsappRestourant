-- Item-level discount support
ALTER TABLE "menu_items" ADD COLUMN IF NOT EXISTS "discountType" TEXT;
ALTER TABLE "menu_items" ADD COLUMN IF NOT EXISTS "discountValue" DECIMAL(10,2);
ALTER TABLE "menu_items" ADD COLUMN IF NOT EXISTS "discountStartAt" TIMESTAMPTZ;
ALTER TABLE "menu_items" ADD COLUMN IF NOT EXISTS "discountEndAt" TIMESTAMPTZ;
