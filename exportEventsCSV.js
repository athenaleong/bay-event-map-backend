#!/usr/bin/env node

/**
 * Script to export all events from Supabase to CSV with event_details column
 * Usage: node exportEventsCSV.js [output_filename]
 */

require("dotenv").config();
const { exportEventsToCSV } = require("./database.js");

async function main() {
  console.log("🚀 Starting events CSV export...");

  // Get output filename from command line argument or use default
  const outputPath = process.argv[2] || "events_export.csv";

  try {
    const result = await exportEventsToCSV(outputPath);

    if (result.success) {
      console.log(`\n✅ CSV export completed successfully!`);
      console.log(`📁 File saved to: ${result.file_path}`);
      console.log(`📊 Total events exported: ${result.exported}`);

      if (result.exported > 0) {
        console.log(`\n📋 Sample event data:`);
        console.log(`   - Title: ${result.events[0].title}`);
        console.log(`   - Start Time: ${result.events[0].start_time}`);
        console.log(`   - Location: ${result.events[0].location}`);
        console.log(`   - Source: ${result.events[0].source}`);
        console.log(`\n📄 CSV Format:`);
        console.log(`   - Column: event_details`);
        console.log(`   - Each row contains complete JSON of one event`);
        console.log(`   - JSON is properly escaped for CSV format`);
      }
    } else {
      console.error(`\n❌ CSV export failed: ${result.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`\n💥 Unexpected error: ${error.message}`);
    process.exit(1);
  }
}

// Run the export
main();

