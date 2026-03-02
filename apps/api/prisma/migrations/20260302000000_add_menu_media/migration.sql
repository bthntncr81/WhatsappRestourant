-- CreateTable
CREATE TABLE "menu_media" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "caption" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menu_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "menu_media_tenantId_sortOrder_idx" ON "menu_media"("tenantId", "sortOrder");

-- AddForeignKey
ALTER TABLE "menu_media" ADD CONSTRAINT "menu_media_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
