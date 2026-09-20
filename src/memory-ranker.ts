/**
 * Memory Ranker Module
 *
 * Combines individual scores with configurable weights to produce
 * final rankings. Includes presets for common use cases.
 *
 * Features:
 * - Configurable weights (semantic, recency, project, importance)
 * - Presets for different ranking strategies
 * - Deduplication with score merging
 * - Explanation output for debugging
 */

import { Memory } from "./schema.js";
import {
  ScorerOptions,
  ScoreComponents,
  calculateScoreComponents,
  combinedScore,
  DEFAULT_SCORER_OPTIONS,
} from "./ranking-scorer.js";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Weights for ranking components
 */
export interface RankingWeights {
  /** Weight for semantic similarity (default: 0.50) */
  semantic: number;
  /** Weight for recency (default: 0.20) */
  recency: number;
  /** Weight for project match (default: 0.30) */
  project: number;
  /** Optional weight for importance (default: 0.00) */
  importance?: number;
}

/**
 * Memory with distance from search
 */
export interface MemoryWithDistance extends Memory {
  /** Distance from vector search (lower = more similar) */
  _distance?: number;
  /** Pre-calculated score from search */
  _score?: number;
}

/**
 * Ranked memory with final score and components
 */
export interface RankedMemory extends Memory {
  /** Final combined score */
  finalScore: number;
  /** Individual score components */
  scores: ScoreComponents;
  /** Source query that found this memory (for debugging) */
  source?: string;
  /** Original distance from search */
  _distance?: number;
}

/**
 * Options for ranking operation
 */
export interface RankingOptions {
  /** Weights for ranking (default: RANKING_PRESETS.default) */
  weights?: RankingWeights;
  /** Target project for project matching */
  targetProject?: string;
  /** How to deduplicate: by content hash or by id */
  deduplicateBy?: "content" | "id";
  /** When duplicate found, how to merge scores */
  mergeStrategy?: "max" | "avg";
  /** Scorer options for component calculation */
  scorerOptions?: ScorerOptions;
}

// ============================================================================
// PRESETS
// ============================================================================

/**
 * Pre-configured ranking weight presets
 */
export const RANKING_PRESETS = {
  /** Default: Balanced ranking (50% semantic, 20% recency, 30% project) */
  default: { semantic: 0.5, recency: 0.2, project: 0.3 } as RankingWeights,

  /** Recency-focused: Prioritize recent memories */
  recencyFocused: { semantic: 0.3, recency: 0.5, project: 0.2 } as RankingWeights,

  /** Project-focused: Prioritize same-project memories */
  projectFocused: { semantic: 0.3, recency: 0.2, project: 0.5 } as RankingWeights,

  /** Semantic-only: Pure similarity ranking */
  semanticOnly: { semantic: 1.0, recency: 0.0, project: 0.0 } as RankingWeights,

  /** Balanced with importance */
  withImportance: {
    semantic: 0.4,
    recency: 0.2,
    project: 0.2,
    importance: 0.2,
  } as RankingWeights,
} as const;

/** Type for preset names */
export type RankingPreset = keyof typeof RANKING_PRESETS;

// ============================================================================
// MEMORY RANKER
// ============================================================================

/**
 * Memory Ranker class
 *
 * Ranks memories by combining multiple scoring factors with configurable weights.
 */
export class MemoryRanker {
  private options: Required<Omit<RankingOptions, "targetProject" | "weights">> & {
    weights: RankingWeights;
  };

  constructor(options: RankingOptions = {}) {
    this.options = {
      weights: options.weights ?? RANKING_PRESETS.default,
      deduplicateBy: options.deduplicateBy ?? "content",
      mergeStrategy: options.mergeStrategy ?? "max",
      scorerOptions: options.scorerOptions ?? DEFAULT_SCORER_OPTIONS,
    };
  }

  /**
   * Rank memories and return sorted results
   *
   * @param memories Memories to rank (with optional _distance from search)
   * @param options Runtime options (override constructor options)
   * @returns Ranked memories sorted by final score (descending)
   */
  rank(
    memories: MemoryWithDistance[],
    options?: RankingOptions
  ): RankedMemory[] {
    if (memories.length === 0) {
      return [];
    }

    const weights = options?.weights ?? this.options.weights;
    const targetProject = options?.targetProject;
    const deduplicateBy = options?.deduplicateBy ?? this.options.deduplicateBy;
    const mergeStrategy = options?.mergeStrategy ?? this.options.mergeStrategy;
    const scorerOptions = options?.scorerOptions ?? this.options.scorerOptions;

    // Step 1: Calculate scores for each memory
    const scored = memories.map((memory) => this.scoreMemory(memory, weights, targetProject, scorerOptions));

    // Step 2: Deduplicate
    const deduplicated = this.deduplicate(scored, deduplicateBy, mergeStrategy);

    // Step 3: Sort by final score (descending)
    deduplicated.sort((a, b) => b.finalScore - a.finalScore);

    // Step 4: Secondary sort by createdAt when scores are equal
    deduplicated.sort((a, b) => {
      if (Math.abs(a.finalScore - b.finalScore) < 0.001) {
        return (b.createdAt ?? 0) - (a.createdAt ?? 0);
      }
      return 0;
    });

    return deduplicated;
  }

  /**
   * Score a single memory
   */
  private scoreMemory(
    memory: MemoryWithDistance,
    weights: RankingWeights,
    targetProject?: string,
    scorerOptions?: ScorerOptions
  ): RankedMemory {
    const scores = calculateScoreComponents(
      {
        distance: memory._distance,
        createdAt: memory.createdAt,
        project: memory.project,
        importance: memory.importance,
      },
      targetProject,
      scorerOptions
    );

    const finalScore = combinedScore(scores, weights);

    return {
      ...memory,
      finalScore,
      scores,
      _distance: memory._distance,
    };
  }

  /**
   * Deduplicate memories
   */
  private deduplicate(
    memories: RankedMemory[],
    by: "content" | "id",
    mergeStrategy: "max" | "avg"
  ): RankedMemory[] {
    const seen = new Map<string, RankedMemory[]>();

    // Group by key
    for (const memory of memories) {
      const key = by === "content" ? this.contentKey(memory.content) : memory.id;
      const existing = seen.get(key) ?? [];
      existing.push(memory);
      seen.set(key, existing);
    }

    // Merge duplicates
    const results: RankedMemory[] = [];

    for (const group of seen.values()) {
      if (group.length === 1) {
        results.push(group[0]);
      } else {
        // Merge duplicates
        results.push(this.mergeDuplicates(group, mergeStrategy));
      }
    }

    return results;
  }

  /**
   * Generate a key from content for deduplication
   */
  private contentKey(content: string): string {
    // Normalize: lowercase, trim, remove extra whitespace
    return content.toLowerCase().trim().replace(/\s+/g, " ");
  }

  /**
   * Merge duplicate memories
   */
  private mergeDuplicates(
    group: RankedMemory[],
    strategy: "max" | "avg"
  ): RankedMemory {
    if (strategy === "max") {
      // Keep the one with highest score
      return group.reduce((best, current) =>
        current.finalScore > best.finalScore ? current : best
      );
    } else {
      // Average scores - keep first memory's data but update scores
      const avgScore =
        group.reduce((sum, m) => sum + m.finalScore, 0) / group.length;

      const avgComponents: ScoreComponents = {
        semantic:
          group.reduce((sum, m) => sum + m.scores.semantic, 0) / group.length,
        recency:
          group.reduce((sum, m) => sum + m.scores.recency, 0) / group.length,
        project:
          group.reduce((sum, m) => sum + m.scores.project, 0) / group.length,
        importance:
          group.reduce((sum, m) => sum + m.scores.importance, 0) / group.length,
      };

      return {
        ...group[0],
        finalScore: avgScore,
        scores: avgComponents,
      };
    }
  }

  /**
   * Get explanation of why a memory ranked where it did
   *
   * @param memory Ranked memory to explain
   * @returns Human-readable explanation
   */
  explain(memory: RankedMemory): string {
    const { scores, finalScore } = memory;
    const weights = this.options.weights;

    const lines = [
      `Memory: "${memory.content.slice(0, 50)}..."`,
      `Final Score: ${finalScore.toFixed(3)}`,
      "",
      "Score Components:",
      `  Semantic:   ${scores.semantic.toFixed(3)} × ${weights.semantic} = ${(scores.semantic * weights.semantic).toFixed(3)}`,
      `  Recency:    ${scores.recency.toFixed(3)} × ${weights.recency} = ${(scores.recency * weights.recency).toFixed(3)}`,
      `  Project:    ${scores.project.toFixed(3)} × ${weights.project} = ${(scores.project * weights.project).toFixed(3)}`,
    ];

    if (weights.importance) {
      lines.push(
        `  Importance: ${scores.importance.toFixed(3)} × ${weights.importance} = ${(scores.importance * weights.importance).toFixed(3)}`
      );
    }

    // Add context
    lines.push("");
    if (memory.project) {
      lines.push(`Project: ${memory.project}`);
    }
    if (memory._distance !== undefined) {
      lines.push(`Search Distance: ${memory._distance.toFixed(3)}`);
    }
    const age = Math.floor(
      (Date.now() - (memory.createdAt ?? Date.now())) / (1000 * 60 * 60 * 24)
    );
    lines.push(`Age: ${age} days`);

    return lines.join("\n");
  }

  /**
   * Update weights dynamically
   */
  setWeights(weights: RankingWeights): void {
    this.options.weights = weights;
  }

  /**
   * Get current weights
   */
  getWeights(): RankingWeights {
    return { ...this.options.weights };
  }

  /**
   * Apply a preset
   */
  applyPreset(preset: RankingPreset): void {
    this.options.weights = { ...RANKING_PRESETS[preset] };
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a memory ranker with default options
 */
export function createMemoryRanker(options?: RankingOptions): MemoryRanker {
  return new MemoryRanker(options);
}

/**
 * Create a memory ranker with a specific preset
 */
export function createRankerWithPreset(preset: RankingPreset): MemoryRanker {
  return new MemoryRanker({ weights: RANKING_PRESETS[preset] });
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Quick rank function for simple use cases
 */
export function rankMemories(
  memories: MemoryWithDistance[],
  options?: RankingOptions
): RankedMemory[] {
  const ranker = new MemoryRanker();
  return ranker.rank(memories, options);
}

/**
 * Get the top N memories by score
 */
export function topMemories(
  memories: MemoryWithDistance[],
  n: number,
  options?: RankingOptions
): RankedMemory[] {
  return rankMemories(memories, options).slice(0, n);
}

/**
 * Filter memories by minimum score
 */
export function filterByMinScore(
  memories: RankedMemory[],
  minScore: number
): RankedMemory[] {
  return memories.filter((m) => m.finalScore >= minScore);
}
