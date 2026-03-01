-- Add preferencesJson to customer_profiles
ALTER TABLE "customer_profiles" ADD COLUMN "preferencesJson" JSONB;
