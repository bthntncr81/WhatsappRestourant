-- CreateEnum
CREATE TYPE "ConversationPhase" AS ENUM ('IDLE', 'ORDER_COLLECTING', 'ORDER_REVIEW', 'LOCATION_REQUEST', 'PAYMENT_METHOD_SELECTION', 'PAYMENT_PENDING', 'ORDER_CONFIRMED', 'AGENT_HANDOFF');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CREDIT_CARD');

-- CreateEnum
CREATE TYPE "OrderPaymentStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'EXPIRED');

-- AlterEnum
BEGIN;
CREATE TYPE "SubscriptionPlan_new" AS ENUM ('TRIAL', 'STARTER', 'PRO');
ALTER TABLE "public"."subscriptions" ALTER COLUMN "plan" DROP DEFAULT;
ALTER TABLE "subscriptions" ALTER COLUMN "plan" TYPE "SubscriptionPlan_new" USING ("plan"::text::"SubscriptionPlan_new");
ALTER TABLE "billing_transactions" ALTER COLUMN "plan" TYPE "SubscriptionPlan_new" USING ("plan"::text::"SubscriptionPlan_new");
ALTER TYPE "SubscriptionPlan" RENAME TO "SubscriptionPlan_old";
ALTER TYPE "SubscriptionPlan_new" RENAME TO "SubscriptionPlan";
DROP TYPE "public"."SubscriptionPlan_old";
ALTER TABLE "subscriptions" ALTER COLUMN "plan" SET DEFAULT 'TRIAL';
COMMIT;

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'ORDER_PAYMENT';

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "activeOrderId" TEXT,
ADD COLUMN     "phase" "ConversationPhase" NOT NULL DEFAULT 'IDLE';

-- CreateTable
CREATE TABLE "order_payments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "OrderPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "iyzicoToken" TEXT,
    "iyzicoPaymentId" TEXT,
    "iyzicoConversationId" TEXT,
    "checkoutFormUrl" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "expiresAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_payments_tenantId_orderId_idx" ON "order_payments"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "order_payments_iyzicoToken_idx" ON "order_payments"("iyzicoToken");

-- CreateIndex
CREATE INDEX "order_payments_tenantId_status_idx" ON "order_payments"("tenantId", "status");

-- CreateIndex
CREATE INDEX "conversations_tenantId_phase_idx" ON "conversations"("tenantId", "phase");

-- AddForeignKey
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
