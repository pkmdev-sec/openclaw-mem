/**
 * Memory category types for organizing different kinds of memories
 */
export enum MemoryCategory {
  DECISION = "decision",
  FACT = "fact",
  PREFERENCE = "preference",
  SOLUTION = "solution",
  CONTEXT = "context",
}

/**
 * Core Memory interface with all required fields
 * Matches original storage.ts schema for compatibility
 */
export interface Memory {
  id: string;
  content: string;
  category: MemoryCategory;
  project?: string;
  importance: number; // 0-10 scale
  vector: number[]; // Renamed from 'vector' for LanceDB compatibility
  createdAt: number; // Unix timestamp in milliseconds
  updatedAt: number; // Unix timestamp in milliseconds
}

/**
 * Input type for creating new memories (excludes auto-generated fields)
 */
export type CreateMemoryInput = {
  content: string;
  category: MemoryCategory;
  importance: number;
  project?: string;
};

/**
 * Input type with optional fields for partial memory creation
 */
export type PartialMemoryInput = Partial<CreateMemoryInput> &
  Pick<CreateMemoryInput, "content" | "category">;

/**
 * Validation error for memory schema
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Validate memory content
 */
export function validateContent(content: string): void {
  if (!content || typeof content !== "string") {
    throw new ValidationError("Content must be a non-empty string");
  }
  if (content.trim().length === 0) {
    throw new ValidationError("Content cannot be empty or whitespace only");
  }
  if (content.length > 10000) {
    throw new ValidationError(
      "Content exceeds maximum length of 10000 characters"
    );
  }
}

/**
 * Validate memory category
 */
export function validateCategory(category: unknown): category is MemoryCategory {
  if (typeof category !== "string") {
    throw new ValidationError("Category must be a string");
  }
  const validCategories = Object.values(MemoryCategory);
  if (!validCategories.includes(category as MemoryCategory)) {
    throw new ValidationError(
      `Invalid category. Must be one of: ${validCategories.join(", ")}`
    );
  }
  return true;
}

/**
 * Validate importance score
 */
export function validateImportance(importance: number): void {
  if (typeof importance !== "number") {
    throw new ValidationError("Importance must be a number");
  }
  if (!Number.isFinite(importance)) {
    throw new ValidationError("Importance must be a finite number");
  }
  if (importance < 0 || importance > 10) {
    throw new ValidationError("Importance must be between 0 and 10");
  }
}

/**
 * Validate vector vector
 */
export function validateEmbedding(vector: number[]): void {
  if (!Array.isArray(vector)) {
    throw new ValidationError("Embedding must be an array");
  }
  if (vector.length === 0) {
    throw new ValidationError("Embedding cannot be empty");
  }
  // Common vector dimensions: 768 (nomic-embed-text), 384, 512, 1024, 1536
  const validDimensions = [384, 512, 768, 1024, 1536];
  if (!validDimensions.includes(vector.length)) {
    console.warn(
      `Unusual vector dimension: ${vector.length}. Expected one of: ${validDimensions.join(", ")}`
    );
  }
  // Validate all values are numbers
  if (!vector.every((val) => typeof val === "number" && Number.isFinite(val))) {
    throw new ValidationError("All vector values must be finite numbers");
  }
}

/**
 * Validate project name
 */
export function validateProject(project?: string): void {
  if (project !== undefined && project !== "") {
    if (typeof project !== "string") {
      throw new ValidationError("Project must be a string");
    }
    if (project.trim().length === 0) {
      throw new ValidationError("Project cannot be whitespace only");
    }
    if (project.length > 200) {
      throw new ValidationError(
        "Project name exceeds maximum length of 200 characters"
      );
    }
  }
}


/**
 * Validate timestamp
 */
export function validateTimestamp(timestamp: number): void {
  if (typeof timestamp !== "number") {
    throw new ValidationError("Timestamp must be a number");
  }
  if (!Number.isInteger(timestamp) || timestamp < 0) {
    throw new ValidationError(
      "Timestamp must be a non-negative integer (Unix timestamp in milliseconds)"
    );
  }
}

/**
 * Validate a complete Memory object
 */
export function validateMemory(memory: Memory): void {
  validateContent(memory.content);
  validateCategory(memory.category);
  validateImportance(memory.importance);
  validateEmbedding(memory.vector);
  validateProject(memory.project);
  validateTimestamp(memory.createdAt);
  validateTimestamp(memory.updatedAt);

  if (typeof memory.id !== "string" || memory.id.trim().length === 0) {
    throw new ValidationError("Memory ID must be a non-empty string");
  }

  if (memory.updatedAt < memory.createdAt) {
    throw new ValidationError("updatedAt cannot be earlier than createdAt");
  }
}

/**
 * Validate CreateMemoryInput (before auto-generated fields are added)
 */
export function validateCreateMemoryInput(input: CreateMemoryInput): void {
  validateContent(input.content);
  validateCategory(input.category);
  validateImportance(input.importance);
  validateProject(input.project);
}

/**
 * Validate PartialMemoryInput (only required fields are mandatory)
 */
export function validatePartialMemoryInput(input: PartialMemoryInput): void {
  validateContent(input.content);
  validateCategory(input.category);

  if (input.importance !== undefined) {
    validateImportance(input.importance);
  }
  if (input.project !== undefined) {
    validateProject(input.project);
  }
}

/**
 * Generate a unique memory ID
 */
export function generateMemoryId(): string {
  const timestamp = Date.now();
  const randomPart = Math.random().toString(36).substring(2, 8);
  return `mem_${timestamp}_${randomPart}`;
}

/**
 * Helper to create default values for optional fields
 */
export function getDefaultMemoryValues(): Pick<Memory, "importance"> {
  return {
    importance: 5, // Default medium importance
  };
}

/**
 * Type guard to check if a value is a valid MemoryCategory
 */
export function isMemoryCategory(value: unknown): value is MemoryCategory {
  return (
    typeof value === "string" &&
    Object.values(MemoryCategory).includes(value as MemoryCategory)
  );
}

/**
 * Convert string to MemoryCategory with validation
 */
export function toMemoryCategory(value: string): MemoryCategory {
  if (isMemoryCategory(value)) {
    return value;
  }
  throw new ValidationError(
    `Invalid category: ${value}. Must be one of: ${Object.values(MemoryCategory).join(", ")}`
  );
}
