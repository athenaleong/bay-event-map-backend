const { EventDetailScraper } = require("./eventDetailScraper");
const fs = require("fs");
const path = require("path");

class EventDetailTester {
  constructor() {
    this.scraper = new EventDetailScraper();
  }

  async debugEventDetails(eventUrl) {
    console.log("🔍 Starting Event Details Debug Session");
    console.log("=".repeat(60));
    console.log(`📋 Target URL: ${eventUrl}`);
    console.log("=".repeat(60));

    try {
      // Test the scraping function
      console.log("\n🚀 Attempting to scrape event details...");
      const startTime = Date.now();

      // First, fetch and save the raw HTML response
      console.log("📥 Fetching raw HTML response...");
      const response = await this.scraper.axiosInstance.get(eventUrl);
      await this.saveHtmlResponse(eventUrl, response);

      const result = await this.scraper.scrapeEventDetails(eventUrl);

      console.log(result);

      // Save the result to a JSON file
      await this.saveResultToFile(eventUrl, result);

      const endTime = Date.now();
      const duration = endTime - startTime;

      console.log(`\n✅ Scraping completed in ${duration}ms`);
      console.log("\n📊 Results:");
      console.log("=".repeat(40));

      // Display results in a readable format
      this.displayResults(result);

      // Test individual parsing methods
      console.log("\n🔧 Testing individual parsing methods...");
      await this.testIndividualMethods(eventUrl);

      return result;
    } catch (error) {
      console.error("\n❌ Error during scraping:");
      console.error("=".repeat(40));
      console.error(`Error Type: ${error.constructor.name}`);
      console.error(`Error Message: ${error.message}`);
      console.error(`Stack Trace: ${error.stack}`);

      // Try to get more detailed error information
      await this.analyzeError(eventUrl, error);

      throw error;
    }
  }

  displayResults(result) {
    const fields = [
      "title",
      "description",
      "startTime",
      "endTime",
      "venue",
      "address",
      "latitude",
      "longitude",
      "cost",
      "currency",
      "costDetails",
      "organizer",
      "organizerUrl",
      "performers",
      "image",
      "tags",
      "contactEmail",
      "contactPhone",
      "socialLinks",
      "eventDate",
      "descriptionHtml",
    ];

    fields.forEach((field) => {
      if (result[field] !== undefined) {
        let value = result[field];

        // Truncate long values for display
        if (typeof value === "string" && value.length > 100) {
          value = value.substring(0, 100) + "...";
        }

        // Format arrays
        if (Array.isArray(value)) {
          value = `[${value.join(", ")}]`;
        }

        // Format objects
        if (typeof value === "object" && value !== null) {
          value = JSON.stringify(value, null, 2);
        }

        console.log(`  ${field}: ${value}`);
      }
    });

    // Show total fields found
    const foundFields = Object.keys(result).filter(
      (key) => result[key] !== undefined
    );
    console.log(`\n📈 Total fields extracted: ${foundFields.length}`);
    console.log(`📋 Fields found: ${foundFields.join(", ")}`);
  }

  async testIndividualMethods(eventUrl) {
    try {
      console.log("\n🔍 Testing individual parsing methods...");

      // Fetch the HTML directly
      const response = await this.scraper.axiosInstance.get(eventUrl);
      const $ = require("cheerio").load(response.data);

      console.log("\n1️⃣ Testing JSON-LD extraction...");
      const jsonLDDetails = this.scraper.extractJsonLDDetails($);
      console.log(
        `   JSON-LD fields found: ${Object.keys(jsonLDDetails).length}`
      );
      if (Object.keys(jsonLDDetails).length > 0) {
        console.log(
          `   JSON-LD fields: ${Object.keys(jsonLDDetails).join(", ")}`
        );
      }

      console.log("\n2️⃣ Testing HTML extraction...");
      const htmlDetails = { source: "detail", url: eventUrl };
      this.scraper.extractHTMLDetails($, htmlDetails);
      const htmlFields = Object.keys(htmlDetails).filter(
        (key) => htmlDetails[key] !== undefined
      );
      console.log(`   HTML fields found: ${htmlFields.length}`);
      if (htmlFields.length > 0) {
        console.log(`   HTML fields: ${htmlFields.join(", ")}`);
      }

      console.log("\n3️⃣ Testing specific selectors...");
      this.testSelectors($);
    } catch (error) {
      console.error(
        `   ❌ Error in individual method testing: ${error.message}`
      );
    }
  }

  testSelectors($) {
    const selectors = {
      "Title selectors": [
        "h1.entry-title",
        ".entry-title",
        "h1",
        ".event-title",
        ".post-title",
      ],
      "Content selectors": [
        ".entry-content",
        ".post-content",
        ".event-description",
        ".event-content",
        "article .content",
      ],
      "Meta selectors": {
        venue: [".venue", ".location", ".event-venue", "[data-venue]"],
        address: [".address", ".event-address", "[data-address]"],
        cost: [".cost", ".price", ".event-cost", ".admission"],
        eventDate: [".date", ".event-date", "[data-date]"],
        time: [".time", ".event-time", "[data-time]"],
      },
      "Image selectors": [
        ".event-image img",
        ".post-thumbnail img",
        ".featured-image img",
        "article img",
        ".entry-content img",
      ],
    };

    Object.entries(selectors).forEach(([category, selectorList]) => {
      console.log(`\n   ${category}:`);

      if (Array.isArray(selectorList)) {
        selectorList.forEach((selector) => {
          const elements = $(selector);
          console.log(`     ${selector}: ${elements.length} elements found`);
          if (elements.length > 0) {
            const text = elements.first().text().trim();
            console.log(
              `       First element text: "${text.substring(0, 50)}${
                text.length > 50 ? "..." : ""
              }"`
            );
          }
        });
      } else {
        Object.entries(selectorList).forEach(([field, fieldSelectors]) => {
          console.log(`     ${field}:`);
          fieldSelectors.forEach((selector) => {
            const elements = $(selector);
            console.log(
              `       ${selector}: ${elements.length} elements found`
            );
          });
        });
      }
    });
  }

  async analyzeError(eventUrl, error) {
    console.log("\n🔍 Error Analysis:");
    console.log("=".repeat(40));

    // Check if it's a network error
    if (error.code === "ECONNABORTED") {
      console.log("❌ Timeout Error: Request took too long");
      console.log("💡 Try increasing timeout or check network connection");
    } else if (error.code === "ENOTFOUND") {
      console.log("❌ DNS Error: Could not resolve hostname");
      console.log("💡 Check if the URL is correct and accessible");
    } else if (error.response) {
      console.log(
        `❌ HTTP Error: ${error.response.status} ${error.response.statusText}`
      );
      console.log(`💡 Server responded with error status`);

      if (error.response.status === 403) {
        console.log("💡 This might be due to anti-bot protection");
      } else if (error.response.status === 404) {
        console.log("💡 The event page might not exist or have been moved");
      } else if (error.response.status >= 500) {
        console.log("💡 Server error - try again later");
      }
    } else if (error.request) {
      console.log("❌ Network Error: No response received");
      console.log("💡 Check internet connection and URL accessibility");
    } else {
      console.log("❌ Unknown Error: Something went wrong");
      console.log("💡 Check the error message and stack trace above");
    }

    // Try to fetch the page with basic axios to see if it's accessible
    console.log("\n🌐 Testing basic page accessibility...");
    try {
      const axios = require("axios");
      const testResponse = await axios.get(eventUrl, { timeout: 10000 });
      console.log(`✅ Page is accessible (Status: ${testResponse.status})`);
      console.log(`📄 Content length: ${testResponse.data.length} characters`);
      console.log(`📄 Content type: ${testResponse.headers["content-type"]}`);
    } catch (testError) {
      console.log(`❌ Page accessibility test failed: ${testError.message}`);
    }
  }

  async runMultipleTests(testUrls) {
    console.log("🧪 Running Multiple Event Detail Tests");
    console.log("=".repeat(60));

    const results = [];

    for (let i = 0; i < testUrls.length; i++) {
      const url = testUrls[i];
      console.log(`\n📋 Test ${i + 1}/${testUrls.length}: ${url}`);
      console.log("-".repeat(60));

      try {
        const result = await this.debugEventDetails(url);
        results.push({ url, success: true, result });
        console.log(`✅ Test ${i + 1} completed successfully`);
      } catch (error) {
        results.push({ url, success: false, error: error.message });
        console.log(`❌ Test ${i + 1} failed: ${error.message}`);
      }

      // Add delay between tests
      if (i < testUrls.length - 1) {
        console.log("\n⏳ Waiting 2 seconds before next test...");
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    // Summary
    console.log("\n📊 Test Summary:");
    console.log("=".repeat(60));
    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    console.log(`✅ Successful: ${successful}/${results.length}`);
    console.log(`❌ Failed: ${failed}/${results.length}`);

    if (failed > 0) {
      console.log("\n❌ Failed URLs:");
      results
        .filter((r) => !r.success)
        .forEach((result, i) => {
          console.log(`   ${i + 1}. ${result.url} - ${result.error}`);
        });
    }

    return results;
  }

  async saveHtmlResponse(eventUrl, response) {
    try {
      // Create a safe filename from the URL
      const urlObj = new URL(eventUrl);
      const domain = urlObj.hostname.replace(/[^a-zA-Z0-9]/g, "_");
      const pathname = urlObj.pathname
        .replace(/[^a-zA-Z0-9]/g, "_")
        .substring(0, 50);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

      const filename = `debug_html_${domain}_${pathname}_${timestamp}.html`;
      const filepath = path.join(__dirname, filename);

      // Save the HTML content
      fs.writeFileSync(filepath, response.data, "utf8");

      // Also save response metadata
      const metadata = {
        url: eventUrl,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        timestamp: new Date().toISOString(),
        contentLength: response.data.length,
        contentType: response.headers["content-type"],
      };

      const metadataFilename = filename.replace(".html", "_metadata.json");
      const metadataFilepath = path.join(__dirname, metadataFilename);
      fs.writeFileSync(
        metadataFilepath,
        JSON.stringify(metadata, null, 2),
        "utf8"
      );

      console.log(`💾 HTML response saved to: ${filename}`);
      console.log(`📋 Response metadata saved to: ${metadataFilename}`);
      console.log(`📄 Content length: ${response.data.length} characters`);
      console.log(`📄 Content type: ${response.headers["content-type"]}`);
    } catch (error) {
      console.error(`❌ Error saving HTML response: ${error.message}`);
    }
  }

  async saveResultToFile(eventUrl, result) {
    try {
      // Create a safe filename from the URL
      const urlObj = new URL(eventUrl);
      const domain = urlObj.hostname.replace(/[^a-zA-Z0-9]/g, "_");
      const pathname = urlObj.pathname
        .replace(/[^a-zA-Z0-9]/g, "_")
        .substring(0, 50);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

      const filename = `debug_result_${domain}_${pathname}_${timestamp}.json`;
      const filepath = path.join(__dirname, filename);

      // Save the result as formatted JSON
      fs.writeFileSync(filepath, JSON.stringify(result, null, 2), "utf8");

      console.log(`💾 Scraping result saved to: ${filename}`);
    } catch (error) {
      console.error(`❌ Error saving result: ${error.message}`);
    }
  }
}

// Main execution function
async function main() {
  const tester = new EventDetailTester();

  // Get URL from command line arguments or use default
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(
      "Usage: node debugEventDetails.js <event_url> [additional_urls...]"
    );
    console.log("\nExample:");
    console.log('  node debugEventDetails.js "https://example.com/event"');
    console.log(
      '  node debugEventDetails.js "https://example.com/event1" "https://example.com/event2"'
    );
    process.exit(1);
  }

  if (args.length === 1) {
    // Single URL test
    try {
      await tester.debugEventDetails(args[0]);
    } catch (error) {
      console.error("\n💥 Debug session failed:", error.message);
      process.exit(1);
    }
  } else {
    // Multiple URL test
    try {
      await tester.runMultipleTests(args);
    } catch (error) {
      console.error("\n💥 Multiple test session failed:", error.message);
      process.exit(1);
    }
  }
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { EventDetailTester };
