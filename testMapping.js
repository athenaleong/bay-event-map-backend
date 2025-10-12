const { mapEventToDatabase } = require("./database");

// Test with the event data we know has venue and address
const testEvent = {
  source: "detail",
  url: "https://sf.funcheap.com/youth-grown-pumpkin-patch-feed-goats-santa-clara/",
  title: "Youth Grown Pumpkin Patch + Feed Goats (Santa Clara)",
  description: "Test description",
  startTime: "2025-10-12T11:00:00-07:00",
  endTime: "2025-10-12T17:00:00-07:00",
  venue: "Homesteaders 4-H Ranch",
  address: "3450 Brookdale Dr, Santa Clara, CA 95051",
  cost: "$0.00",
  currency: "USD",
  image:
    "https://cdn.funcheap.com/wp-content/uploads/2025/10/Pumpkin-patch-flyer2-80x80.jpg",
  socialLinks: {
    facebook: "https://www.facebook.com/funcheap/",
    instagram: "https://www.instagram.com/funcheap/",
    twitter: "https://twitter.com/FunCheapSF",
  },
  eventButtonUrls: ["https://www.eventbrite.com/e/test-tickets-123"],
};

async function testMapping() {
  console.log("🧪 Testing event mapping...");
  console.log("Input event:");
  console.log(JSON.stringify(testEvent, null, 2));

  try {
    const mappedEvent = await mapEventToDatabase(testEvent);
    console.log("\n✅ Mapped event:");
    console.log(JSON.stringify(mappedEvent, null, 2));

    console.log("\n🔍 Key fields check:");
    console.log(`Venue: ${mappedEvent.venue || "NOT FOUND"}`);
    console.log(`Address: ${mappedEvent.address || "NOT FOUND"}`);
    console.log(
      `Event Button URLs: ${mappedEvent.event_button_urls || "NOT FOUND"}`
    );
  } catch (error) {
    console.error("❌ Mapping failed:", error.message);
  }
}

testMapping();
