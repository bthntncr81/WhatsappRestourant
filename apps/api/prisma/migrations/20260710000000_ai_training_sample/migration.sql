-- CreateTable
CREATE TABLE "ai_training_samples" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "language" TEXT,
    "intentJson" JSONB,
    "contextJson" JSONB NOT NULL,
    "userMessage" TEXT NOT NULL,
    "assistantReply" TEXT NOT NULL,

    CONSTRAINT "ai_training_samples_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_training_samples_tenantId_createdAt_idx" ON "ai_training_samples"("tenantId", "createdAt");
