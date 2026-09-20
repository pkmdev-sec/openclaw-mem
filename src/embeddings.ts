import { Ollama } from "ollama";

/**
 * Interface for embedding providers - allows swapping between different models/services
 */
export interface EmbeddingProvider {
  /**
   * Generate embedding for a single text
   */
  embed(text: string): Promise<number[]>;

  /**
   * Generate embeddings for multiple texts efficiently
   */
  embedBatch(texts: string[]): Promise<number[][]>;

  /**
   * Get the dimensionality of embeddings produced by this provider
   */
  getDimensions(): number;

  /**
   * Get the name of the provider for logging/debugging
   */
  getProviderName(): string;
}

export interface EmbeddingConfig {
  model?: string;
  dimensions?: number;
  baseUrl?: string;
  batchSize?: number;
  maxConcurrency?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
}

export interface BatchProgress {
  completed: number;
  total: number;
  percentage: number;
}

/**
 * Implementation of EmbeddingProvider using Ollama's nomic-embed-text model
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private ollama: Ollama;
  private model: string;
  private dimensions: number;
  private batchSize: number;
  private maxConcurrency: number;
  private retryAttempts: number;
  private retryDelayMs: number;

  constructor(config: EmbeddingConfig = {}) {
    this.model = config.model || "nomic-embed-text";
    this.dimensions = config.dimensions || 768;
    this.batchSize = config.batchSize || 10;
    this.maxConcurrency = config.maxConcurrency || 3;
    this.retryAttempts = config.retryAttempts || 3;
    this.retryDelayMs = config.retryDelayMs || 1000;

    this.ollama = new Ollama({
      host: config.baseUrl || "http://localhost:11434",
    });
  }

  getProviderName(): string {
    return `Ollama (${this.model})`;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  /**
   * Generate embedding for a single text with retry logic
   */
  async embed(text: string): Promise<number[]> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.retryAttempts; attempt++) {
      try {
        const response = await this.ollama.embed({
          model: this.model,
          input: text,
        });

        if (!response.embeddings || response.embeddings.length === 0) {
          throw new Error("No embeddings returned from Ollama");
        }

        return response.embeddings[0];
      } catch (error) {
        lastError = error as Error;

        // Check if it's a connection error
        if (this.isConnectionError(error)) {
          throw new Error(
            `Ollama is not available at the configured endpoint. ` +
              `Please ensure Ollama is running and the model '${this.model}' is installed. ` +
              `Original error: ${(error as Error).message}`
          );
        }

        // Retry for transient errors
        if (attempt < this.retryAttempts - 1) {
          await this.delay(this.retryDelayMs * (attempt + 1));
        }
      }
    }

    throw new Error(
      `Failed to generate embedding after ${this.retryAttempts} attempts: ${lastError?.message}`
    );
  }

  /**
   * Generate embeddings for multiple texts with batching and concurrency control
   */
  async embedBatch(
    texts: string[],
    onProgress?: (progress: BatchProgress) => void
  ): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    // Split into batches
    const batches: string[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      batches.push(texts.slice(i, i + this.batchSize));
    }

    const results: number[][] = [];
    let completed = 0;

    // Process batches with concurrency control
    for (let i = 0; i < batches.length; i += this.maxConcurrency) {
      const batchGroup = batches.slice(i, i + this.maxConcurrency);

      // Process this group of batches in parallel
      const batchPromises = batchGroup.map(async (batch) => {
        const batchResults: number[][] = [];

        for (const text of batch) {
          const embedding = await this.embed(text);
          batchResults.push(embedding);
          completed++;

          if (onProgress) {
            onProgress({
              completed,
              total: texts.length,
              percentage: Math.round((completed / texts.length) * 100),
            });
          }
        }

        return batchResults;
      });

      const groupResults = await Promise.all(batchPromises);
      results.push(...groupResults.flat());
    }

    return results;
  }

  /**
   * Check if the error is a connection error
   */
  private isConnectionError(error: unknown): boolean {
    const errorMessage = (error as Error).message.toLowerCase();
    return (
      errorMessage.includes("econnrefused") ||
      errorMessage.includes("connect") ||
      errorMessage.includes("network") ||
      errorMessage.includes("fetch failed")
    );
  }

  /**
   * Delay helper for retry logic
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Test if Ollama is available and the model is installed
   */
  async testConnection(): Promise<{ available: boolean; error?: string }> {
    try {
      await this.embed("test");
      return { available: true };
    } catch (error) {
      return {
        available: false,
        error: (error as Error).message,
      };
    }
  }
}

/**
 * Factory function to create an embedding provider
 */
export function createEmbeddingProvider(
  config?: EmbeddingConfig
): EmbeddingProvider {
  return new OllamaEmbeddingProvider(config);
}

/**
 * Helper to validate embedding dimensions
 */
export function validateEmbedding(
  embedding: number[],
  expectedDimensions: number
): void {
  if (!Array.isArray(embedding)) {
    throw new Error("Embedding must be an array");
  }

  if (embedding.length !== expectedDimensions) {
    throw new Error(
      `Expected embedding of ${expectedDimensions} dimensions, got ${embedding.length}`
    );
  }

  if (!embedding.every((val) => typeof val === "number" && !isNaN(val))) {
    throw new Error("Embedding contains invalid values");
  }
}
