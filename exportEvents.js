#!/usr/bin/env node

/**
 * Temporary script to export all events from Supabase to JSON
 * Usage: node exportEvents.js [output_filename]
 */

require("dotenv").config();
const { exportEventsToJSON } = require("./database.js");

async function main() {
  console.log("🚀 Starting events export...");

  // Get output filename from command line argument or use default
  const outputPath = process.argv[2] || "events_export.json";

  try {
    const result = await exportEventsToJSON(outputPath);

    if (result.success) {
      console.log(`\n✅ Export completed successfully!`);
      console.log(`📁 File saved to: ${result.file_path}`);
      console.log(`📊 Total events exported: ${result.exported}`);

      if (result.exported > 0) {
        console.log(`\n📋 Sample event data:`);
        console.log(`   - Title: ${result.events[0].title}`);
        console.log(`   - Start Time: ${result.events[0].start_time}`);
        console.log(`   - Location: ${result.events[0].location}`);
        console.log(`   - Source: ${result.events[0].source}`);
      }
    } else {
      console.error(`\n❌ Export failed: ${result.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`\n💥 Unexpected error: ${error.message}`);
    process.exit(1);
  }
}

// Run the export
main();

