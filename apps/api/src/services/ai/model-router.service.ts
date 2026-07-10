import type { IntentAnalysis } from '../nlu/intent-analysis.service';

/**
 * Stage-2 reply-model router.
 *
 * Decides which model generates the customer-facing reply TEXT based on the
 * stage-1 intent analysis. Order extraction (product matching) always stays
 * on the existing local path — this router only affects reply generation.
 *
 * Rules:
 *  - AI_ROUTER_ENABLED === 'false'  → 'local' (kill switch, default 'true')
 *  - no ANTHROPIC_API_KEY           → 'local' (behavior identical to today)
 *  - actionableIntentCount >= 2 OR negativeConstraint → 'sonnet'
 *  - otherwise                      → 'haiku'
 */

export type ReplyModelChoice = 'local' | 'haiku' | 'sonnet';

export interface RouteDecision {
  model: ReplyModelChoice;
  /** Combined (regex OR LLM) negative-constraint verdict */
  negativeConstraint: boolean;
}

/**
 * Pure routing rule — dependency-free so it can be smoke-tested without
 * any LLM or SDK (see scripts/smoke-intent.mjs).
 */
export function decideReplyModel(input: {
  hasAnthropicKey: boolean;
  routerEnabled: boolean;
  actionableIntentCount: number;
  negativeConstraint: boolean;
}): ReplyModelChoice {
  if (!input.routerEnabled || !input.hasAnthropicKey) return 'local';
  if (input.actionableIntentCount >= 2 || input.negativeConstraint) return 'sonnet';
  return 'haiku';
}

export class ModelRouterService {
  /** True when the hybrid router may pick a Claude model at all. */
  isEnabled(): boolean {
    const enabled = (process.env.AI_ROUTER_ENABLED ?? 'true') !== 'false';
    return enabled && !!process.env.ANTHROPIC_API_KEY;
  }

  route(analysis: IntentAnalysis | null, regexNegativeConstraint: boolean): RouteDecision {
    const negativeConstraint =
      regexNegativeConstraint || analysis?.negativeConstraint === true;

    const model = decideReplyModel({
      hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
      routerEnabled: (process.env.AI_ROUTER_ENABLED ?? 'true') !== 'false',
      actionableIntentCount: analysis?.actionableIntentCount ?? 0,
      negativeConstraint,
    });

    return { model, negativeConstraint };
  }
}

export const modelRouterService = new ModelRouterService();
