-- Consent log table for legal compliance (register checkboxes)
CREATE TABLE IF NOT EXISTS "consent_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "consentType" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "acceptedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "consent_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE,
    CONSTRAINT "consent_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "consent_logs_tenantId_userId_idx" ON "consent_logs"("tenantId", "userId");
CREATE INDEX IF NOT EXISTS "consent_logs_tenantId_consentType_idx" ON "consent_logs"("tenantId", "consentType");

-- KVKK consent timestamp on conversations (WhatsApp customer consent)
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "kvkkConsentAt" TIMESTAMPTZ;

-- Marketing consent on customer profiles
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "marketingConsent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "marketingConsentAt" TIMESTAMPTZ;
