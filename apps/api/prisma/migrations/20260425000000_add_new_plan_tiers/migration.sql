-- Add new plan tiers to SubscriptionPlan enum
ALTER TYPE "SubscriptionPlan" ADD VALUE IF NOT EXISTS 'SILVER';
ALTER TYPE "SubscriptionPlan" ADD VALUE IF NOT EXISTS 'GOLD';
ALTER TYPE "SubscriptionPlan" ADD VALUE IF NOT EXISTS 'PLATINUM';
