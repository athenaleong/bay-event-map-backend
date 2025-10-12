const { EnhancedFuncheapScraper } = require("./enhancedFuncheapScraper");
const { saveEventsToDatabase } = require("./database");

async function testScraping() {
  console.log("🧪 Testing scraping and database saving...");

  const scraper = new EnhancedFuncheapScraper();

  try {
    // Scrape just a few events to test
    const events = await scraper.getEventsWithDetails("2025-10-13", {
      maxEvents: 3,
      enableDetailScraping: true,
      detailScrapingLimit: 3,
    });

    console.log(`\n📊 Scraped ${events.length} events:`);
    events.forEach((event, index) => {
      console.log(`\n${index + 1}. ${event.title}`);
      console.log(`   Venue: ${event.venue || "NOT FOUND"}`);
      console.log(`   Address: ${event.address || "NOT FOUND"}`);
      console.log(`   Source: ${event.source}`);
      console.log(`   Has detailed info: ${event.hasDetailedInfo || false}`);
    });

    // Test database saving
    console.log("\n💾 Testing database save...");
    const result = await saveEventsToDatabase(events);

    console.log(`\n✅ Database save result:`);
    console.log(`   Success: ${result.success}`);
    console.log(`   Saved: ${result.saved}`);
    console.log(`   Events: ${result.events.length}`);
  } catch (error) {
    console.error("❌ Test failed:", error.message);
  }
}

testScraping();
