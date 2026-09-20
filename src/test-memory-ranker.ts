/**
 * Memory Ranker Quick Tests
 *
 * Verifies the ranking scorer and memory ranker work correctly.
 */

import {
  semanticScore,
  recencyScore,
  projectScore,
  importanceScore,
  calculateScoreComponents,
  combinedScore,
} from "./ranking-scorer.js";
import {
  MemoryRanker,
  RANKING_PRESETS,
  createMemoryRanker,
  rankMemories,
} from "./memory-ranker.js";
import { MemoryCategory } from "./schema.js";

console.log("╔════════════════════════════════════════╗");
console.log("║     Memory Ranker Quick Tests          ║");
console.log("╚════════════════════════════════════════╝\n");

// Test semantic scoring
console.log("--- Semantic Scoring ---");
console.log(`Distance 0.0 → Score ${semanticScore(0.0).toFixed(3)} (expected ~1.0)`);
console.log(`Distance 0.5 → Score ${semanticScore(0.5).toFixed(3)} (expected ~0.75)`);
console.log(`Distance 1.0 → Score ${semanticScore(1.0).toFixed(3)} (expected ~0.5)`);
console.log(`Distance 2.0 → Score ${semanticScore(2.0).toFixed(3)} (expected ~0.0)`);
console.log();

// Test recency scoring
console.log("--- Recency Scoring ---");
const now = Date.now();
const day = 24 * 60 * 60 * 1000;
console.log(`Today → Score ${recencyScore(now).toFixed(3)} (expected ~1.0)`);
console.log(`1 day ago → Score ${recencyScore(now - day).toFixed(3)}`);
console.log(`7 days ago → Score ${recencyScore(now - 7 * day).toFixed(3)}`);
console.log(`30 days ago → Score ${recencyScore(now - 30 * day).toFixed(3)}`);
console.log(`365 days ago → Score ${recencyScore(now - 365 * day).toFixed(3)} (expected ~0.1)`);
console.log();

// Test project scoring
console.log("--- Project Scoring ---");
console.log(`Exact match → Score ${projectScore("backend", "backend").toFixed(3)} (expected 1.0)`);
console.log(`Partial match → Score ${projectScore("backend-api", "backend").toFixed(3)} (expected 0.5)`);
console.log(`No match → Score ${projectScore("frontend", "backend").toFixed(3)} (expected 0.0)`);
console.log(`No target → Score ${projectScore("backend", undefined).toFixed(3)} (expected 0.0)`);
console.log();

// Test importance scoring
console.log("--- Importance Scoring ---");
console.log(`Importance 1 → Score ${importanceScore(1).toFixed(3)} (expected ~0.0)`);
console.log(`Importance 5 → Score ${importanceScore(5).toFixed(3)} (expected ~0.44)`);
console.log(`Importance 10 → Score ${importanceScore(10).toFixed(3)} (expected ~1.0)`);
console.log();

// Test memory ranker
console.log("--- Memory Ranker ---");
const testMemories = [
  {
    id: "1",
    content: "Use PostgreSQL for the database",
    category: MemoryCategory.DECISION,
    project: "backend",
    importance: 8,
    vector: [],
    createdAt: now - 2 * day,
    updatedAt: now - 2 * day,
    _distance: 0.3,
  },
  {
    id: "2",
    content: "Redis for caching",
    category: MemoryCategory.DECISION,
    project: "backend",
    importance: 7,
    vector: [],
    createdAt: now - 30 * day,
    updatedAt: now - 30 * day,
    _distance: 0.5,
  },
  {
    id: "3",
    content: "React for frontend",
    category: MemoryCategory.FACT,
    project: "frontend",
    importance: 6,
    vector: [],
    createdAt: now - 1 * day,
    updatedAt: now - 1 * day,
    _distance: 0.4,
  },
];

const ranker = createMemoryRanker();
const ranked = ranker.rank(testMemories, { targetProject: "backend" });

console.log("\nRanked memories (target project: backend):");
ranked.forEach((m, i) => {
  console.log(`  ${i + 1}. ${m.content}`);
  console.log(`     Final: ${m.finalScore.toFixed(3)} | Semantic: ${m.scores.semantic.toFixed(2)} | Recency: ${m.scores.recency.toFixed(2)} | Project: ${m.scores.project.toFixed(2)}`);
});

// Test presets
console.log("\n--- Ranking Presets ---");
for (const [name, weights] of Object.entries(RANKING_PRESETS)) {
  console.log(`  ${name}: semantic=${weights.semantic}, recency=${weights.recency}, project=${weights.project}${weights.importance ? `, importance=${weights.importance}` : ""}`);
}

// Benchmark
console.log("\n--- Performance Benchmark ---");
const largeSet = Array.from({ length: 1000 }, (_, i) => ({
  id: String(i),
  content: `Memory ${i}`,
  category: MemoryCategory.FACT,
  project: ["A", "B", "C"][i % 3],
  importance: (i % 10) + 1,
  vector: [],
  createdAt: now - Math.random() * 365 * day,
  updatedAt: now - Math.random() * 365 * day,
  _distance: Math.random() * 2,
}));

const start = performance.now();
const largeRanked = ranker.rank(largeSet, { targetProject: "A" });
const duration = performance.now() - start;

console.log(`Ranked 1000 memories in ${duration.toFixed(2)}ms`);
console.log(`Target: <50ms | Result: ${duration < 50 ? "✓ PASS" : "✗ FAIL"}`);

console.log("\n✓ All ranking tests complete!");
