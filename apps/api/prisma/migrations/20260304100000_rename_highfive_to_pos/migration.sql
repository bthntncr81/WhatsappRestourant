-- RenameColumns
ALTER TABLE "tenants" RENAME COLUMN "highfiveApiUrl" TO "posApiUrl";
ALTER TABLE "tenants" RENAME COLUMN "highfiveApiKey" TO "posApiKey";
ALTER TABLE "tenants" RENAME COLUMN "highfiveLocationId" TO "posLocationId";
ALTER TABLE "tenants" RENAME COLUMN "highfiveWebhookSecret" TO "posWebhookSecret";
ALTER TABLE "tenants" RENAME COLUMN "highfiveLastMenuSync" TO "posLastMenuSync";
ALTER TABLE "tenants" RENAME COLUMN "highfiveMenuHash" TO "posMenuHash";
