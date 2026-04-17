-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "orderNotifyPhones" TEXT[] DEFAULT ARRAY[]::TEXT[];
