import { Ollama } from "ollama";

/**
 * Configuration for LLM provider
 */
export interface LLMConfig {
  model: string;
  temperature?: number;
  timeout?: number; // milliseconds
  maxRetries?: number;
  retryDelay?: number; // milliseconds
}

/**
 * Request parameters for LLM generation
 */
export interface GenerateRequest {
  prompt: string;
  systemPrompt?: string;
  format?: "json" | "text";
  maxTokens?: number;
}

/**
 * Response from LLM generation
 */
export interface GenerateResponse {
  text: string;
  duration: number; // milliseconds
  model: string;
}

/**
 * Generic LLM provider interface
 * Allows swapping between different LLM providers (Ollama, OpenAI, etc.)
 */
export interface LLMProvider {
  /**
   * Generate text using the LLM
   */
  generate(request: GenerateRequest): Promise<GenerateResponse>;

  /**
   * Check if the provider is available and healthy
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get the model name being used
   */
  getModelName(): string;
}

/**
 * Exponential backoff utility for retries
 */
async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ollama implementation of LLMProvider
 * Uses local Ollama instance for inference
 */
export class OllamaProvider implements LLMProvider {
  private client: Ollama;
  private config: Required<LLMConfig>;

  constructor(config: LLMConfig) {
    this.client = new Ollama();
    this.config = {
      model: config.model,
      temperature: config.temperature ?? 0.1, // Low temperature for extraction
      timeout: config.timeout ?? 30000, // 30 seconds default
      maxRetries: config.maxRetries ?? 3,
      retryDelay: config.retryDelay ?? 1000, // 1 second base delay
    };
  }

  /**
   * Generate text with retry logic and exponential backoff
   */
  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const startTime = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        // Build the full prompt
        const fullPrompt = request.systemPrompt
          ? `${request.systemPrompt}\n\n${request.prompt}`
          : request.prompt;

        // Call Ollama
        const response = await this.client.generate({
          model: this.config.model,
          prompt: fullPrompt,
          format: request.format,
          stream: false,
          options: {
            temperature: this.config.temperature,
            num_predict: request.maxTokens,
          },
        });

        const duration = Date.now() - startTime;

        return {
          text: response.response,
          duration,
          model: this.config.model,
        };
      } catch (error) {
        lastError =
          error instanceof Error ? error : new Error(String(error));

        // Don't retry on last attempt
        if (attempt === this.config.maxRetries - 1) {
          break;
        }

        // Exponential backoff: delay * 2^attempt
        const delay = this.config.retryDelay * Math.pow(2, attempt);
        console.warn(
          `LLM generation failed (attempt ${attempt + 1}/${this.config.maxRetries}), retrying in ${delay}ms...`
        );
        await sleep(delay);
      }
    }

    // All retries exhausted
    throw new Error(
      `LLM generation failed after ${this.config.maxRetries} attempts: ${lastError?.message}`
    );
  }

  /**
   * Check if Ollama is available and the model exists
   */
  async isAvailable(): Promise<boolean> {
    try {
      // Try to list models to check if Ollama is running
      const models = await this.client.list();

      // Check if our specific model is available
      const modelExists = models.models.some(
        (m: any) => m.name === this.config.model || m.name.startsWith(this.config.model)
      );

      if (!modelExists) {
        console.warn(
          `Model '${this.config.model}' not found in Ollama. Available models:`,
          models.models.map((m: any) => m.name)
        );
        return false;
      }

      return true;
    } catch (error) {
      console.warn("Ollama health check failed:", error);
      return false;
    }
  }

  /**
   * Get the model name
   */
  getModelName(): string {
    return this.config.model;
  }
}

/**
 * Factory function to create an Ollama provider with default config
 */
export function createOllamaProvider(
  model: string = "qwen2.5:7b",
  overrides?: Partial<LLMConfig>
): OllamaProvider {
  return new OllamaProvider({
    model,
    temperature: 0.1,
    timeout: 30000,
    maxRetries: 3,
    retryDelay: 1000,
    ...overrides,
  });
}

/**
 * Null provider that returns empty responses (for testing or fallback)
 */
export class NullProvider implements LLMProvider {
  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    return {
      text: request.format === "json" ? '{"facts": []}' : "",
      duration: 0,
      model: "null",
    };
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  getModelName(): string {
    return "null";
  }
}
