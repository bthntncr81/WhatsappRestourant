-- Message rating for AI feedback loop
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "rating" INTEGER;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "ratingNote" TEXT;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "ratedAt" TIMESTAMPTZ;
