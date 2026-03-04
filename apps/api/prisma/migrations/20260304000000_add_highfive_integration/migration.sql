-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "highfiveApiUrl" TEXT;
ALTER TABLE "tenants" ADD COLUMN "highfiveApiKey" TEXT;
ALTER TABLE "tenants" ADD COLUMN "highfiveLocationId" TEXT;
ALTER TABLE "tenants" ADD COLUMN "highfiveWebhookSecret" TEXT;
ALTER TABLE "tenants" ADD COLUMN "highfiveLastMenuSync" TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN "highfiveMenuHash" TEXT;

-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN "externalItemId" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "externalOrderId" TEXT;
