import type { DreamCategory } from "./dream-miner.js";

export type PromotionDecision = boolean | "review";

export interface PromotionCandidate {
  category: DreamCategory;
  body: string;
  confidence: number;
  metadata?: { confirmed_by?: number };
}

export interface PromotionResult {
  promote: PromotionDecision;
  reason: string;
  promotionScore: number;
  silentMergeEligible: boolean;
}

const PERSONAL_PREFERENCE =
  /(?:\b(vim|emacs|neovim|font|theme|keybind|terminal\s*theme)\b|キーバインド)/i;
const EPHEMERAL_DEBUG =
  /(?:\b(console\.log|debugger|TODO:\s*fix|tmp\/|\/tmp\/)\b|試しに|一旦)/i;
const PROJECT_ARTIFACT =
  /\b(src\/|package\.json|pnpm-lock|tsconfig|\.claude\/|Dockerfile)\b/i;
const TEAM_WIDE = /(?:\b(CI|production|deploy)\b|デプロイ|本番|認証|全員)/i;

export function mentionsProjectArtifacts(body: string): boolean {
  return PROJECT_ARTIFACT.test(body);
}

export function matchesPersonalPreference(body: string): boolean {
  return PERSONAL_PREFERENCE.test(body);
}

export function isEphemeralDebug(body: string): boolean {
  return EPHEMERAL_DEBUG.test(body);
}

export function affectsWholeTeam(body: string): boolean {
  return TEAM_WIDE.test(body);
}

export function shouldPromoteToTeam(candidate: PromotionCandidate): PromotionResult {
  const confirmedBy = candidate.metadata?.confirmed_by ?? 1;

  if (confirmedBy >= 2) {
    return {
      promote: true,
      reason: "duplicate_learners",
      promotionScore: 0.85,
      silentMergeEligible: true,
    };
  }
  if (candidate.category === "decision" && mentionsProjectArtifacts(candidate.body)) {
    return {
      promote: true,
      reason: "project_scope",
      promotionScore: 0.8,
      silentMergeEligible: true,
    };
  }
  if (candidate.category === "warning" && affectsWholeTeam(candidate.body)) {
    return {
      promote: true,
      reason: "team_wide",
      promotionScore: 0.78,
      silentMergeEligible: true,
    };
  }

  if (matchesPersonalPreference(candidate.body)) {
    return {
      promote: false,
      reason: "editor_preference",
      promotionScore: 0.2,
      silentMergeEligible: false,
    };
  }
  if (candidate.category === "discovery" && isEphemeralDebug(candidate.body)) {
    return {
      promote: false,
      reason: "ephemeral",
      promotionScore: 0.25,
      silentMergeEligible: false,
    };
  }

  return {
    promote: "review",
    reason: "ambiguous",
    promotionScore: 0.45,
    silentMergeEligible: false,
  };
}
