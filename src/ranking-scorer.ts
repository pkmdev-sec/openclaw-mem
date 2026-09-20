/**
 * Ranking Scorer Module
 *
 * Pure scoring functions for each ranking component:
 * - Semantic similarity (distance to score conversion)
 * - Recency (time-based exponential decay)
 * - Project matching (exact and partial)
 * - Importance weighting
 *
 * All scores are normalized to 0-1 range.
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for scorer configuration
 */
export interface ScorerOptions {
  // Semantic scoring
  /** Distance beyond which score is 0 (default: 2.0) */
  maxDistance?: number;

  // Recency scoring
  /** How fast scores decay (default: 0.1) */
  decayFactor?: number;
  /** Memories older than this get minimum score (default: 365 days) */
  maxAgeDays?: number;

  // Project scoring
  /** Bonus for exact project match (default: 1.0) */
  exactMatchBonus?: number;
  /** Bonus for partial match (default: 0.5) */
  partialMatchBonus?: number;
}

/**
 * Default scorer options
 */
export const DEFAULT_SCORER_OPTIONS: Required<ScorerOptions> = {
  maxDistance: 2.0,
  decayFactor: 0.1,
  maxAgeDays: 365,
  exactMatchBonus: 1.0,
  partialMatchBonus: 0.5,
};

// ============================================================================
// SEMANTIC SCORING
// ============================================================================

/**
 * Convert distance to similarity score
 *
 * LanceDB uses L2 (Euclidean) distance where:
 * - 0 = identical vectors
 * - Higher values = less similar
 *
 * This converts to a similarity score where:
 * - 1.0 = identical (distance 0)
 * - 0.0 = completely different (distance >= maxDistance)
 *
 * @param distance L2 distance from vector search
 * @param options Scorer options
 * @returns Similarity score (0-1, higher is better)
 */
export function semanticScore(
  distance: number | undefined,
  options: ScorerOptions = {}
): number {
  if (distance === undefined) {
    return 0.5; // Default score when no distance available
  }

  const maxDistance = options.maxDistance ?? DEFAULT_SCORER_OPTIONS.maxDistance;

  // Linear conversion: score = 1 - (distance / maxDistance)
  // Clamped to [0, 1]
  const score = Math.max(0, 1 - distance / maxDistance);

  return score;
}

/**
 * Alternative: Inverse distance scoring
 * More gradual falloff for larger distances
 *
 * @param distance L2 distance
 * @returns Similarity score (0-1)
 */
export function semanticScoreInverse(distance: number | undefined): number {
  if (distance === undefined) {
    return 0.5;
  }

  // score = 1 / (1 + distance)
  // This gives a smoother curve than linear
  return 1 / (1 + distance);
}

/**
 * Alternative: Exponential decay scoring
 * Very sensitive to small distances
 *
 * @param distance L2 distance
 * @param scale Controls decay rate (default: 1.0)
 * @returns Similarity score (0-1)
 */
export function semanticScoreExponential(
  distance: number | undefined,
  scale: number = 1.0
): number {
  if (distance === undefined) {
    return 0.5;
  }

  // score = exp(-distance * scale)
  return Math.exp(-distance * scale);
}

// ============================================================================
// RECENCY SCORING
// ============================================================================

/**
 * Calculate recency score using exponential decay
 *
 * Recent memories get higher scores, older memories decay towards minimum.
 *
 * @param createdAt Unix timestamp (milliseconds) of memory creation
 * @param options Scorer options
 * @returns Recency score (0-1, higher is more recent)
 */
export function recencyScore(
  createdAt: number | undefined,
  options: ScorerOptions = {}
): number {
  if (createdAt === undefined) {
    return 0.5; // Default score when no timestamp
  }

  const decayFactor = options.decayFactor ?? DEFAULT_SCORER_OPTIONS.decayFactor;
  const maxAgeDays = options.maxAgeDays ?? DEFAULT_SCORER_OPTIONS.maxAgeDays;

  // Calculate days since creation
  const now = Date.now();
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysSince = (now - createdAt) / msPerDay;

  // If older than max age, return minimum score
  if (daysSince >= maxAgeDays) {
    return 0.1; // Minimum recency score
  }

  // Exponential decay: score = 1 / (1 + daysSince * decayFactor)
  // At day 0: score ≈ 1.0
  // At day 10 with decay 0.1: score ≈ 0.5
  // At day 100 with decay 0.1: score ≈ 0.09
  const score = 1 / (1 + daysSince * decayFactor);

  return Math.max(0.1, score); // Ensure minimum of 0.1
}

/**
 * Alternative: Linear decay recency scoring
 *
 * @param createdAt Unix timestamp (milliseconds)
 * @param maxAgeDays Maximum age before score reaches minimum
 * @returns Recency score (0-1)
 */
export function recencyScoreLinear(
  createdAt: number | undefined,
  maxAgeDays: number = 365
): number {
  if (createdAt === undefined) {
    return 0.5;
  }

  const now = Date.now();
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysSince = (now - createdAt) / msPerDay;

  // Linear: score = 1 - (daysSince / maxAgeDays)
  const score = 1 - daysSince / maxAgeDays;

  return Math.max(0.1, Math.min(1.0, score));
}

// ============================================================================
// PROJECT SCORING
// ============================================================================

/**
 * Calculate project matching score
 *
 * @param memoryProject Project of the memory (can be undefined)
 * @param targetProject Target project to match against (can be undefined)
 * @param options Scorer options
 * @returns Project score (0-1)
 */
export function projectScore(
  memoryProject: string | undefined,
  targetProject: string | undefined,
  options: ScorerOptions = {}
): number {
  const exactMatchBonus =
    options.exactMatchBonus ?? DEFAULT_SCORER_OPTIONS.exactMatchBonus;
  const partialMatchBonus =
    options.partialMatchBonus ?? DEFAULT_SCORER_OPTIONS.partialMatchBonus;

  // No target project specified - no bonus
  if (!targetProject) {
    return 0;
  }

  // Memory has no project - no bonus
  if (!memoryProject) {
    return 0;
  }

  // Normalize for comparison (lowercase, trim)
  const normalizedMemory = memoryProject.toLowerCase().trim();
  const normalizedTarget = targetProject.toLowerCase().trim();

  // Exact match
  if (normalizedMemory === normalizedTarget) {
    return exactMatchBonus;
  }

  // Partial match (one contains the other)
  if (
    normalizedMemory.includes(normalizedTarget) ||
    normalizedTarget.includes(normalizedMemory)
  ) {
    return partialMatchBonus;
  }

  // No match
  return 0;
}

// ============================================================================
// IMPORTANCE SCORING
// ============================================================================

/**
 * Normalize importance score to 0-1 range
 *
 * Importance is typically stored as 1-10, this normalizes to 0-1.
 *
 * @param importance Memory importance (1-10)
 * @returns Normalized importance score (0-1)
 */
export function importanceScore(importance: number | undefined): number {
  if (importance === undefined) {
    return 0.5; // Default middle importance
  }

  // Clamp to 1-10 range and normalize
  const clamped = Math.max(1, Math.min(10, importance));
  return (clamped - 1) / 9; // Maps 1->0, 10->1
}

// ============================================================================
// COMBINED SCORING
// ============================================================================

/**
 * Individual score components
 */
export interface ScoreComponents {
  semantic: number;
  recency: number;
  project: number;
  importance: number;
}

/**
 * Calculate all score components for a memory
 *
 * @param params Memory parameters
 * @param targetProject Target project for matching
 * @param options Scorer options
 * @returns All score components
 */
export function calculateScoreComponents(
  params: {
    distance?: number;
    createdAt?: number;
    project?: string;
    importance?: number;
  },
  targetProject?: string,
  options: ScorerOptions = {}
): ScoreComponents {
  return {
    semantic: semanticScore(params.distance, options),
    recency: recencyScore(params.createdAt, options),
    project: projectScore(params.project, targetProject, options),
    importance: importanceScore(params.importance),
  };
}

/**
 * Calculate final combined score from components
 *
 * @param components Individual score components
 * @param weights Weights for each component (should sum to 1.0)
 * @returns Combined score (0-1)
 */
export function combinedScore(
  components: ScoreComponents,
  weights: {
    semantic: number;
    recency: number;
    project: number;
    importance?: number;
  }
): number {
  const importanceWeight = weights.importance ?? 0;

  // Calculate weighted sum
  let score =
    components.semantic * weights.semantic +
    components.recency * weights.recency +
    components.project * weights.project +
    components.importance * importanceWeight;

  // Normalize by total weights (in case they don't sum to 1)
  const totalWeight =
    weights.semantic + weights.recency + weights.project + importanceWeight;

  if (totalWeight > 0) {
    score = score / totalWeight;
  }

  return Math.max(0, Math.min(1, score));
}
