-- Create satisfaction_surveys table
CREATE TABLE IF NOT EXISTS "satisfaction_surveys" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerName" TEXT,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "isComplaint" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "satisfaction_surveys_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "satisfaction_surveys_tenantId_isComplaint_createdAt_idx" ON "satisfaction_surveys"("tenantId", "isComplaint", "createdAt");
CREATE INDEX IF NOT EXISTS "satisfaction_surveys_tenantId_createdAt_idx" ON "satisfaction_surveys"("tenantId", "createdAt");

-- Foreign keys
ALTER TABLE "satisfaction_surveys" ADD CONSTRAINT "satisfaction_surveys_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "satisfaction_surveys" ADD CONSTRAINT "satisfaction_surveys_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
