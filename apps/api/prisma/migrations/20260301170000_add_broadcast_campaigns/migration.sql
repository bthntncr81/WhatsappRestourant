-- CreateEnum
CREATE TYPE "CustomerSegment" AS ENUM ('ACTIVE', 'SLEEPING', 'NEW');
CREATE TYPE "BroadcastOptInStatus" AS ENUM ('PENDING', 'OPTED_IN', 'OPTED_OUT');
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'COMPLETED', 'CANCELLED');
CREATE TYPE "CampaignSendStatus" AS ENUM ('PENDING_SEND', 'SENT', 'DELIVERED', 'OPENED', 'CONVERTED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "customer_profiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerName" TEXT,
    "segment" "CustomerSegment" NOT NULL DEFAULT 'NEW',
    "broadcastOptIn" "BroadcastOptInStatus" NOT NULL DEFAULT 'PENDING',
    "optInAskedAt" TIMESTAMP(3),
    "optInChangedAt" TIMESTAMP(3),
    "avgOrderHour" INTEGER,
    "lastOrderAt" TIMESTAMP(3),
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "totalSpent" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_profiles_tenantId_customerPhone_key" ON "customer_profiles"("tenantId", "customerPhone");
CREATE INDEX "customer_profiles_tenantId_segment_idx" ON "customer_profiles"("tenantId", "segment");
CREATE INDEX "customer_profiles_tenantId_broadcastOptIn_idx" ON "customer_profiles"("tenantId", "broadcastOptIn");

ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetSegments" TEXT[],
    "maxDiscountPct" INTEGER NOT NULL DEFAULT 10,
    "messageTemplate" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "usePersonalTime" BOOLEAN NOT NULL DEFAULT true,
    "scheduledAt" TIMESTAMP(3),
    "totalRecipients" INTEGER NOT NULL DEFAULT 0,
    "totalSent" INTEGER NOT NULL DEFAULT 0,
    "totalOpened" INTEGER NOT NULL DEFAULT 0,
    "totalConverted" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "campaigns_tenantId_status_idx" ON "campaigns"("tenantId", "status");
CREATE INDEX "campaigns_tenantId_createdAt_idx" ON "campaigns"("tenantId", "createdAt");

ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "campaign_send_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "customerProfileId" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "status" "CampaignSendStatus" NOT NULL DEFAULT 'PENDING_SEND',
    "scheduledSendAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "messageText" TEXT,
    "discountPct" INTEGER,
    "suggestedItems" JSONB,
    "externalMessageId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "campaign_send_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "campaign_send_logs_tenantId_campaignId_status_idx" ON "campaign_send_logs"("tenantId", "campaignId", "status");
CREATE INDEX "campaign_send_logs_tenantId_scheduledSendAt_status_idx" ON "campaign_send_logs"("tenantId", "scheduledSendAt", "status");
CREATE INDEX "campaign_send_logs_tenantId_customerPhone_idx" ON "campaign_send_logs"("tenantId", "customerPhone");

ALTER TABLE "campaign_send_logs" ADD CONSTRAINT "campaign_send_logs_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_send_logs" ADD CONSTRAINT "campaign_send_logs_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "broadcast_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maxDiscountPct" INTEGER NOT NULL DEFAULT 15,
    "minDaysBetweenSends" INTEGER NOT NULL DEFAULT 3,
    "dailySendLimit" INTEGER NOT NULL DEFAULT 200,
    "activeThresholdDays" INTEGER NOT NULL DEFAULT 14,
    "sleepingThresholdDays" INTEGER NOT NULL DEFAULT 60,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "broadcast_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "broadcast_settings_tenantId_key" ON "broadcast_settings"("tenantId");

ALTER TABLE "broadcast_settings" ADD CONSTRAINT "broadcast_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
