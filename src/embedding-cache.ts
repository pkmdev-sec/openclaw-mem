import * as crypto from "crypto";

/**
 * Cache entry for embeddings
 */
interface CacheEntry {
  embedding: number[];
  timestamp: number;
  accessCount: number;
}

/**
 * Cache statistics for monitoring performance
 */
export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  maxSize: number;
  hitRate: number;
  evictions: number;
}

/**
 * LRU (Least Recently Used) cache for embeddings
 */
export class EmbeddingCache {
  private cache: Map<string, CacheEntry>;
  private maxSize: number;
  private hits: number = 0;
  private misses: number = 0;
  private evictions: number = 0;

  constructor(maxSize: number = 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  /**
   * Generate a cache key from text using SHA-256 hash
   */
  private generateKey(text: string): string {
    return crypto.createHash("sha256").update(text).digest("hex");
  }

  /**
   * Get an embedding from the cache
   */
  get(text: string): number[] | null {
    const key = this.generateKey(text);
    const entry = this.cache.get(key);

    if (entry) {
      // Update access information for LRU
      entry.timestamp = Date.now();
      entry.accessCount++;

      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, entry);

      this.hits++;
      return entry.embedding;
    }

    this.misses++;
    return null;
  }

  /**
   * Store an embedding in the cache
   */
  set(text: string, embedding: number[]): void {
    const key = this.generateKey(text);

    // If at capacity, remove least recently used item
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    // Add or update entry
    this.cache.set(key, {
      embedding: [...embedding], // Clone to prevent external mutations
      timestamp: Date.now(),
      accessCount: 1,
    });
  }

  /**
   * Remove least recently used item
   */
  private evictLRU(): void {
    // First entry is the least recently used (Map maintains insertion order)
    const firstKey = this.cache.keys().next().value;
    if (firstKey) {
      this.cache.delete(firstKey);
      this.evictions++;
    }
  }

  /**
   * Check if text exists in cache
   */
  has(text: string): boolean {
    return this.cache.has(this.generateKey(text));
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const totalRequests = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: totalRequests > 0 ? this.hits / totalRequests : 0,
      evictions: this.evictions,
    };
  }

  /**
   * Get current cache size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Remove a specific entry from cache
   */
  delete(text: string): boolean {
    return this.cache.delete(this.generateKey(text));
  }

  /**
   * Get all cache keys (for debugging)
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Prune old entries (older than maxAge milliseconds)
   */
  pruneOld(maxAge: number): number {
    const now = Date.now();
    let pruned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > maxAge) {
        this.cache.delete(key);
        pruned++;
      }
    }

    return pruned;
  }

  /**
   * Export cache statistics as a formatted string
   */
  formatStats(): string {
    const stats = this.getStats();
    return [
      `Cache Statistics:`,
      `  Size: ${stats.size}/${stats.maxSize}`,
      `  Hits: ${stats.hits}`,
      `  Misses: ${stats.misses}`,
      `  Hit Rate: ${(stats.hitRate * 100).toFixed(2)}%`,
      `  Evictions: ${stats.evictions}`,
    ].join("\n");
  }
}

/**
 * Cached embedding provider wrapper
 */
import { EmbeddingProvider, BatchProgress } from "./embeddings.js";

export class CachedEmbeddingProvider implements EmbeddingProvider {
  private provider: EmbeddingProvider;
  private cache: EmbeddingCache;

  constructor(provider: EmbeddingProvider, cacheSize: number = 1000) {
    this.provider = provider;
    this.cache = new EmbeddingCache(cacheSize);
  }

  async embed(text: string): Promise<number[]> {
    // Check cache first
    const cached = this.cache.get(text);
    if (cached) {
      return cached;
    }

    // Generate and cache
    const embedding = await this.provider.embed(text);
    this.cache.set(text, embedding);
    return embedding;
  }

  async embedBatch(
    texts: string[],
    onProgress?: (progress: BatchProgress) => void
  ): Promise<number[][]> {
    const results: number[][] = [];
    const uncachedTexts: string[] = [];
    const uncachedIndices: number[] = [];

    // Check cache for each text
    for (let i = 0; i < texts.length; i++) {
      const cached = this.cache.get(texts[i]);
      if (cached) {
        results[i] = cached;
      } else {
        uncachedTexts.push(texts[i]);
        uncachedIndices.push(i);
      }
    }

    // Generate embeddings for uncached texts
    if (uncachedTexts.length > 0) {
      const newEmbeddings = await this.provider.embedBatch(
        uncachedTexts,
        onProgress
      );

      // Cache and place results
      for (let i = 0; i < newEmbeddings.length; i++) {
        const embedding = newEmbeddings[i];
        const originalIndex = uncachedIndices[i];
        this.cache.set(uncachedTexts[i], embedding);
        results[originalIndex] = embedding;
      }
    }

    return results;
  }

  getDimensions(): number {
    return this.provider.getDimensions();
  }

  getProviderName(): string {
    return `Cached(${this.provider.getProviderName()})`;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    return this.cache.getStats();
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Format cache statistics for display
   */
  formatCacheStats(): string {
    return this.cache.formatStats();
  }
}
