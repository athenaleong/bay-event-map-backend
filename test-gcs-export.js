require("dotenv").config();

const { exportEventsToGCS } = require("./database");

console.log("🧪 Testing GCS Export Function\n");

// Check environment variables
console.log("📋 Checking environment variables:");
console.log(
  "✓ GCS_PROJECT_ID:",
  process.env.GCS_PROJECT_ID ? "✅ Set" : "❌ Missing"
);
console.log(
  "✓ GCS_BUCKET_NAME:",
  process.env.GCS_BUCKET_NAME ? "✅ Set" : "❌ Missing"
);
console.log(
  "✓ GCS_CREDENTIALS:",
  process.env.GCS_CREDENTIALS ? "✅ Set" : "❌ Missing"
);
console.log(
  "✓ GCS_FILE_NAME:",
  process.env.GCS_FILE_NAME || "Using default: events/weekly-events.json"
);
console.log(
  "✓ SUPABASE_URL:",
  process.env.SUPABASE_URL ? "✅ Set" : "❌ Missing"
);
console.log(
  "✓ SUPABASE_ANON_KEY:",
  process.env.SUPABASE_ANON_KEY ? "✅ Set" : "❌ Missing"
);
console.log("\n" + "=".repeat(60) + "\n");

async function testExport() {
  try {
    console.log("🚀 Starting export test...\n");

    const startTime = Date.now();
    const result = await exportEventsToGCS();
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log("\n" + "=".repeat(60));
    console.log("📊 RESULTS:");
    console.log("=".repeat(60) + "\n");

    if (result.success) {
      console.log("✅ SUCCESS!\n");
      console.log("📦 Events exported:", result.exported);
      console.log(
        "📅 Date range:",
        result.dateRange?.start,
        "to",
        result.dateRange?.end
      );
      console.log("🪣 Bucket:", result.gcsBucket || result.s3Bucket);
      console.log("📄 File:", result.gcsFileName || result.s3Key);
      console.log("🌐 Public URL:", result.gcsUrl || result.s3Url);
      console.log("⏱️  Duration:", duration, "seconds");

      console.log("\n🎉 Test your file:");
      console.log(`   curl ${result.gcsUrl || result.s3Url}`);
    } else {
      console.log("❌ FAILED\n");
      console.log("Error:", result.error);
      console.log("Exported:", result.exported || 0);

      if (result.error.includes("Database not configured")) {
        console.log(
          "\n💡 Tip: Make sure SUPABASE_URL and SUPABASE_ANON_KEY are set in .env"
        );
      } else if (result.error.includes("not configured")) {
        console.log(
          "\n💡 Tip: Make sure GCS_PROJECT_ID, GCS_BUCKET_NAME, and GCS_CREDENTIALS are set in .env"
        );
      }
    }

    console.log("\n" + "=".repeat(60));
  } catch (error) {
    console.error("\n❌ UNEXPECTED ERROR:");
    console.error(error);
    console.log("\n💡 Check your environment variables and try again.");
  }
}

testExport()
  .then(() => {
    console.log("\n✨ Test complete!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n💥 Fatal error:", error);
    process.exit(1);
  });
