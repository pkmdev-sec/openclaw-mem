import * as lancedb from "@lancedb/lancedb";
import { Ollama } from "ollama";

const ollama = new Ollama();

async function testVectorSearchWithEmbeddingName() {
  console.log("Testing vector search with 'embedding' column name...");

  try {
    // Generate test embeddings
    console.log("\n1. Generating embeddings...");
    const emb1 = await ollama.embed({
      model: "nomic-embed-text",
      input: "I love programming in TypeScript",
    });
    const emb2 = await ollama.embed({
      model: "nomic-embed-text",
      input: "Python is a great programming language",
    });
    console.log(`✅ Generated 2 embeddings (${emb1.embeddings[0].length} dims)`);

    // Create test data with 'embedding' column
    const data = [
      {
        id: "1",
        content: "I love programming in TypeScript",
        embedding: emb1.embeddings[0],
      },
      {
        id: "2",
        content: "Python is a great programming language",
        embedding: emb2.embeddings[0],
      },
    ];

    // Connect and create table
    console.log("\n2. Creating test table with 'embedding' column...");
    const db = await lancedb.connect("./test-vector-db");
    const table = await db.createTable("test_embedding", data, { mode: "overwrite" });
    console.log("✅ Table created");

    // Try vector search WITHOUT specifying column
    console.log("\n3. Performing vector search (auto-detect column)...");
    const queryEmb = await ollama.embed({
      model: "nomic-embed-text",
      input: "coding in TypeScript",
    });

    try {
      const results1 = await table
        .vectorSearch(queryEmb.embeddings[0])
        .limit(2)
        .toArray();
      console.log("✅ Auto-detect worked!");
    } catch (error) {
      console.log("❌ Auto-detect failed:", (error as Error).message);

      // Try with explicit column name
      console.log("\n4. Trying with explicit column name...");
      const results2 = await table
        .search(queryEmb.embeddings[0])
        .column("embedding")
        .limit(2)
        .toArray();
      console.log("✅ Explicit column name worked!");
      console.log("Results:", results2.map((r: any) => r.content));
    }

    // Cleanup
    await db.dropTable("test_embedding");
    console.log("\n✅ Test completed!");
  } catch (error) {
    console.error("\n❌ Error:", error);
    throw error;
  }
}

testVectorSearchWithEmbeddingName();
