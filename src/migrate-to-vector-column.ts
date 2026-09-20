/**
 * Migration script to rename 'embedding' column to 'vector' for LanceDB compatibility
 * LanceDB's vectorSearch() expects a column named 'vector' by default
 */

import * as lancedb from "@lancedb/lancedb";

async function migrateTable() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║  Migration: Rename 'embedding' column to 'vector'          ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  try {
    // Connect to database
    console.log("1. Connecting to database...");
    const db = await lancedb.connect("./memory-store");
    console.log("✅ Connected");

    // Open existing table
    console.log("\n2. Opening existing table...");
    const oldTable = await db.openTable("memories");
    const count = await oldTable.countRows();
    console.log(`✅ Found table with ${count} rows`);

    // Read all data
    console.log("\n3. Reading all existing data...");
    const data = await oldTable.query().toArray();
    console.log(`✅ Read ${data.length} memories`);

    // Transform data: rename 'embedding' to 'vector'
    console.log("\n4. Transforming data (embedding -> vector)...");
    const transformedData = data.map((row: any) => {
      // Ensure embedding is a proper array
      const embedding = row.embedding;
      const vectorArray = Array.isArray(embedding)
        ? embedding
        : Array.from(embedding);

      return {
        id: row.id,
        content: row.content,
        category: row.category,
        project: row.project,
        importance: row.importance,
        vector: vectorArray, // Rename and ensure it's an array
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
    console.log(`✅ Transformed ${transformedData.length} rows`);
    console.log(`   First vector length: ${transformedData[0].vector.length}`);

    // Drop old table
    console.log("\n5. Dropping old table...");
    await db.dropTable("memories");
    console.log("✅ Dropped old table");

    // Create new table with vector column
    console.log("\n6. Creating new table with 'vector' column...");
    const newTable = await db.createTable("memories", transformedData);
    console.log("✅ Created new table");

    // Verify
    console.log("\n7. Verifying migration...");
    const newCount = await newTable.countRows();
    console.log(`✅ New table has ${newCount} rows`);

    if (newCount === count) {
      console.log("\n✅ Migration successful! All rows preserved.");
    } else {
      console.warn(`\n⚠️  Warning: Row count mismatch (${count} -> ${newCount})`);
    }

    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log("║                  Migration Complete!                       ║");
    console.log("╚════════════════════════════════════════════════════════════╝");
  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    throw error;
  }
}

migrateTable();
