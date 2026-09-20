import * as lancedb from "@lancedb/lancedb";
import { Ollama } from "ollama";

const ollama = new Ollama();

async function testVectorSearch() {
  console.log("Testing vector search...");

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
    const emb3 = await ollama.embed({
      model: "nomic-embed-text",
      input: "I enjoy eating pizza",
    });
    console.log(`✅ Generated 3 embeddings (${emb1.embeddings[0].length} dims)`);

    // Create test data
    const data = [
      {
        id: "1",
        content: "I love programming in TypeScript",
        vector: emb1.embeddings[0],
      },
      {
        id: "2",
        content: "Python is a great programming language",
        vector: emb2.embeddings[0],
      },
      {
        id: "3",
        content: "I enjoy eating pizza",
        vector: emb3.embeddings[0],
      },
    ];

    // Connect and create table
    console.log("\n2. Creating test table...");
    const db = await lancedb.connect("./test-vector-db");
    const table = await db.createTable("test_vectors", data, { mode: "overwrite" });
    console.log("✅ Table created");

    // Try vector search
    console.log("\n3. Performing vector search...");
    const queryEmb = await ollama.embed({
      model: "nomic-embed-text",
      input: "coding in TypeScript",
    });

    const results = await table
      .vectorSearch(queryEmb.embeddings[0])
      .limit(2)
      .toArray();

    console.log("✅ Vector search successful!");
    console.log("\nResults:");
    results.forEach((r: any, i: number) => {
      console.log(`  ${i + 1}. ${r.content}`);
      console.log(`     Distance: ${r._distance}`);
    });

    // Cleanup
    await db.dropTable("test_vectors");
    console.log("\n✅ Test completed successfully!");
  } catch (error) {
    console.error("\n❌ Error:", error);
    throw error;
  }
}

testVectorSearch();
