-- Add missing ConversationPhase enum values
ALTER TYPE "ConversationPhase" ADD VALUE IF NOT EXISTS 'ADDITION_PROMPT';
ALTER TYPE "ConversationPhase" ADD VALUE IF NOT EXISTS 'ADDRESS_COLLECTION';
