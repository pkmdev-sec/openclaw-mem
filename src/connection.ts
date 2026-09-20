import * as lancedb from "@lancedb/lancedb";
import { Memory, MemoryCategory, generateMemoryId } from "./schema.js";

/**
 * Custom error types for better error handling
 */
export class DatabaseError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "DatabaseError";
  }
}

export class ConnectionNotInitializedError extends DatabaseError {
  constructor() {
    super("Database connection not initialized. Call connect() first.");
    this.name = "ConnectionNotInitializedError";
  }
}

export class TableNotFoundError extends DatabaseError {
  constructor(tableName: string) {
    super(`Table '${tableName}' not found`);
    this.name = "TableNotFoundError";
  }
}

/**
 * Configuration options for the database connection
 */
export interface ConnectionConfig {
  dbPath: string;
  tableName: string;
  vectorDimensions?: number; // Default: 768 (nomic-embed-text)
}

/**
 * Singleton LanceDB Connection Manager
 * Manages database connection lifecycle with proper error handling
 */
class ConnectionManager {
  private static instance: ConnectionManager | null = null;
  private db: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;
  private config: ConnectionConfig | null = null;

  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor() {}

  /**
   * Get the singleton instance of the ConnectionManager
   */
  public static getInstance(): ConnectionManager {
    if (!ConnectionManager.instance) {
      ConnectionManager.instance = new ConnectionManager();
    }
    return ConnectionManager.instance;
  }

  /**
   * Connect to the database with the given configuration
   */
  public async connect(config: ConnectionConfig): Promise<void> {
    try {
      this.config = config;
      this.db = await lancedb.connect(config.dbPath);
      console.log(`Connected to LanceDB at: ${config.dbPath}`);
    } catch (error) {
      throw new DatabaseError(
        `Failed to connect to database at ${config.dbPath}`,
        error
      );
    }
  }

  /**
   * Open an existing table or create a new one
   */
  public async openTable(tableName: string): Promise<lancedb.Table> {
    if (!this.db) {
      throw new ConnectionNotInitializedError();
    }

    try {
      const tables = await this.db.tableNames();
      if (tables.includes(tableName)) {
        this.table = await this.db.openTable(tableName);
        console.log(`Opened existing table: ${tableName}`);
      } else {
        throw new TableNotFoundError(tableName);
      }
      return this.table;
    } catch (error) {
      if (error instanceof TableNotFoundError) {
        throw error;
      }
      throw new DatabaseError(`Failed to open table: ${tableName}`, error);
    }
  }

  /**
   * Create a new table with the given schema
   */
  public async createTable<T>(
    tableName: string,
    data: T[]
  ): Promise<lancedb.Table> {
    if (!this.db) {
      throw new ConnectionNotInitializedError();
    }

    try {
      this.table = await this.db.createTable(tableName, data);
      console.log(`Created new table: ${tableName}`);
      return this.table;
    } catch (error) {
      throw new DatabaseError(`Failed to create table: ${tableName}`, error);
    }
  }

  /**
   * Get the current table instance
   */
  public getTable(): lancedb.Table {
    if (!this.table) {
      throw new DatabaseError("No table is currently open");
    }
    return this.table;
  }

  /**
   * Get the current database connection
   */
  public getConnection(): lancedb.Connection {
    if (!this.db) {
      throw new ConnectionNotInitializedError();
    }
    return this.db;
  }

  /**
   * Check if the connection is healthy
   */
  public async healthCheck(): Promise<{
    connected: boolean;
    tableOpen: boolean;
    tableName?: string;
    dbPath?: string;
  }> {
    const connected = this.db !== null;
    const tableOpen = this.table !== null;

    let tableName: string | undefined;
    if (tableOpen && this.table) {
      try {
        tableName = this.table.name;
      } catch (error) {
        // Table name might not be accessible
      }
    }

    return {
      connected,
      tableOpen,
      tableName,
      dbPath: this.config?.dbPath,
    };
  }

  /**
   * Check if a table exists
   */
  public async tableExists(tableName: string): Promise<boolean> {
    if (!this.db) {
      throw new ConnectionNotInitializedError();
    }

    try {
      const tables = await this.db.tableNames();
      return tables.includes(tableName);
    } catch (error) {
      throw new DatabaseError("Failed to check table existence", error);
    }
  }

  /**
   * Get all table names in the database
   */
  public async getTableNames(): Promise<string[]> {
    if (!this.db) {
      throw new ConnectionNotInitializedError();
    }

    try {
      return await this.db.tableNames();
    } catch (error) {
      throw new DatabaseError("Failed to get table names", error);
    }
  }

  /**
   * Initialize table with auto-creation if it doesn't exist
   * This is the main method to use for setting up the memory table
   */
  public async initializeTable(
    tableName: string,
    dummyEmbedding: number[]
  ): Promise<lancedb.Table> {
    if (!this.db) {
      throw new ConnectionNotInitializedError();
    }

    try {
      const exists = await this.tableExists(tableName);

      if (exists) {
        this.table = await this.openTable(tableName);
      } else {
        // Create table with initial schema record
        const initMemory: Memory = {
          id: generateMemoryId(),
          content: "Memory system initialized",
          category: MemoryCategory.CONTEXT,
          project: "system",
          importance: 0,
          vector: dummyEmbedding,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        this.table = await this.createTable(tableName, [initMemory]);

        // Create vector index for efficient similarity search
        await this.createVectorIndex();
      }

      return this.table;
    } catch (error) {
      throw new DatabaseError(`Failed to initialize table: ${tableName}`, error);
    }
  }

  /**
   * Create a vector index on the vectors field for faster similarity search
   * Note: Vector index creation is optional and may not work with all LanceDB versions
   */
  public async createVectorIndex(columnName: string = "vector"): Promise<void> {
    if (!this.table) {
      throw new DatabaseError("No table is currently open");
    }

    try {
      // Try to create index - API may vary by LanceDB version
      await this.table.createIndex(columnName);
      console.log(`Created vector index on column: ${columnName}`);
    } catch (error) {
      // Index creation is optional - table will work without it (just slower for large datasets)
      // Index might already exist, or API might not support it in this version
      console.log(
        `Note: Vector index creation skipped (table will still work). Reason: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Gracefully close the database connection
   */
  public async shutdown(): Promise<void> {
    try {
      if (this.table) {
        this.table = null;
        console.log("Closed table connection");
      }

      if (this.db) {
        // LanceDB doesn't require explicit close, but we null the reference
        this.db = null;
        console.log("Closed database connection");
      }

      this.config = null;
    } catch (error) {
      throw new DatabaseError("Failed to shutdown database connection", error);
    }
  }

  /**
   * Reset the singleton instance (mainly for testing)
   */
  public static reset(): void {
    if (ConnectionManager.instance) {
      ConnectionManager.instance.db = null;
      ConnectionManager.instance.table = null;
      ConnectionManager.instance.config = null;
      ConnectionManager.instance = null;
    }
  }
}

/**
 * Export singleton instance getter
 */
export const getConnectionManager = (): ConnectionManager => {
  return ConnectionManager.getInstance();
};
