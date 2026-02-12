-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "storeId" TEXT;

-- CreateIndex
CREATE INDEX "orders_tenantId_storeId_idx" ON "orders"("tenantId", "storeId");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
