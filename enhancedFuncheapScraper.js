const { FuncheapScraper } = require("./scraper");
const { EventDetailScraper } = require("./eventDetailScraper");

class EnhancedFuncheapScraper {
  constructor() {
    this.listingScraper = new FuncheapScraper();
    this.detailScraper = new EventDetailScraper();
  }

  async getEventsWithDetails(dateStr, options = {}) {
    const {
      includeDetails = false,
      maxDetailRequests = 500,
      detailFilter = null, // function to filter which events get detailed scraping
      onProgress = null, // callback for progress updates
      batchSize = 10, // Number of events to process in parallel for detail retrieval
    } = options;

    try {
      // Step 1: Get basic event listings
      console.log(`📋 Fetching event listings for ${dateStr}...`);
      const basicEvents = await this.listingScraper.getEventsForDate(dateStr);

      if (onProgress)
        onProgress({
          step: "listings",
          completed: basicEvents.length,
          total: basicEvents.length,
        });

      if (!includeDetails) {
        return basicEvents;
      }

      // Step 2: Enhance with detailed information (in parallel batches)
      console.log(
        `🔍 Enhancing ${Math.min(
          basicEvents.length,
          maxDetailRequests
        )} events with detailed info in batches of ${batchSize}...`
      );

      // Filter events for detail scraping
      let eventsToDetail = basicEvents;
      if (detailFilter) {
        eventsToDetail = basicEvents.filter(detailFilter);
      }

      // Limit the number of detail requests
      eventsToDetail = eventsToDetail.slice(0, maxDetailRequests);

      // Get details in parallel batches
      const enhancedEvents = await this.getEventDetailsInBatches(
        eventsToDetail,
        batchSize,
        onProgress
      );

      // Add remaining events without details
      const remainingEvents = basicEvents.slice(eventsToDetail.length);
      enhancedEvents.push(...remainingEvents);

      return enhancedEvents;
    } catch (error) {
      console.error(`Error in enhanced scraping: ${error.message}`);
      throw error;
    }
  }

  mergeEventData(basicEvent, detailedEvent) {
    // Just use the detailed event data since it's always more complete
    return {
      ...detailedEvent,
      scrapedAt: new Date().toISOString(),
    };
  }

  /**
   * Retrieve details for multiple events in parallel batches
   * @param {Array} events - Array of events to get details for
   * @param {number} batchSize - Number of events to process in parallel (default: 10)
   * @param {Function} onProgress - Progress callback function
   * @returns {Promise<Array>} - Array of events with details
   */
  async getEventDetailsInBatches(events, batchSize = 10, onProgress = null) {
    const enhancedEvents = [];
    let completedCount = 0;

    for (let i = 0; i < events.length; i += batchSize) {
      const batch = events.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(events.length / batchSize);

      console.log(
        `  📖 Getting details for batch ${batchNumber}/${totalBatches} (${batch.length} events)...`
      );

      // Process batch in parallel
      const batchPromises = batch.map(async (event, index) => {
        const globalIndex = i + index + 1;
        console.log(
          `    📖 Getting details for event ${globalIndex}/${events.length}: ${event.title}`
        );

        try {
          if (event.url) {
            const details = await this.detailScraper.scrapeEventDetails(
              event.url
            );
            const enhancedEvent = this.mergeEventData(event, details);
            return enhancedEvent;
          } else {
            // No URL available, just use basic data
            return event;
          }
        } catch (error) {
          console.error(
            `Failed to get details for ${event.title}: ${error.message}`
          );
          // Add the basic event even if detail scraping fails
          return {
            ...event,
            detailScrapingError: error.message,
          };
        }
      });

      try {
        const batchResults = await Promise.all(batchPromises);
        enhancedEvents.push(...batchResults);
        completedCount += batch.length;

        // Update progress
        if (onProgress) {
          onProgress({
            step: "details",
            completed: completedCount,
            total: events.length,
            currentEvent: `Batch ${batchNumber}/${totalBatches}`,
          });
        }

        // Add a small delay between batches to avoid overwhelming the server
        if (i + batchSize < events.length) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch (error) {
        console.error(`Error processing detail batch ${batchNumber}:`, error);
        // Add events with fallback data
        batch.forEach((event) => {
          enhancedEvents.push({
            ...event,
            detailScrapingError: "Batch processing failed",
          });
        });
        completedCount += batch.length;
      }
    }

    return enhancedEvents;
  }

  // Utility method to create smart detail filters
  static createDetailFilter(options = {}) {
    const {
      categories = [],
      excludeSponsored = false,
      titleKeywords = [],
      costFilter = null, // 'free', 'paid', or null for all
      hasImages = false,
    } = options;

    return (event) => {
      // Filter by categories
      if (categories.length > 0) {
        const eventCategories = (event.categories || []).map((c) =>
          c.toLowerCase()
        );
        const hasMatchingCategory = categories.some((cat) =>
          eventCategories.some((ec) => ec.includes(cat.toLowerCase()))
        );
        if (!hasMatchingCategory) return false;
      }

      // Filter out sponsored events
      if (excludeSponsored && event.sponsored) {
        return false;
      }

      // Filter by title keywords
      if (titleKeywords.length > 0) {
        const title = (event.title || "").toLowerCase();
        const hasKeyword = titleKeywords.some((keyword) =>
          title.includes(keyword.toLowerCase())
        );
        if (!hasKeyword) return false;
      }

      // Filter by cost
      if (costFilter === "free") {
        const cost = (event.cost || "").toLowerCase();
        if (!cost.includes("free")) return false;
      } else if (costFilter === "paid") {
        const cost = (event.cost || "").toLowerCase();
        if (cost.includes("free")) return false;
      }

      // Filter by image availability
      if (hasImages && !event.image) {
        return false;
      }

      return true;
    };
  }

  // Method for batch processing multiple dates
  async getEventsWithDetailsForDateRange(startDate, days = 7, options = {}) {
    const allEvents = [];
    const errors = [];

    for (let i = 0; i < days; i++) {
      const date = new Date(startDate.replace(/\//g, "-"));
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split("T")[0].replace(/-/g, "/");

      try {
        console.log(`\n📅 Processing ${dateStr}...`);
        const dayEvents = await this.getEventsWithDetails(dateStr, options);

        // Add date to each event
        const eventsWithDate = dayEvents.map((event) => ({
          ...event,
          scrapedDate: dateStr,
        }));

        allEvents.push(...eventsWithDate);
      } catch (error) {
        console.error(`Failed to process ${dateStr}: ${error.message}`);
        errors.push({ date: dateStr, error: error.message });
      }

      // Be respectful with delays between dates
      if (i < days - 1) {
        await this.delay(2000);
      }
    }

    return {
      events: allEvents,
      errors: errors,
      summary: {
        totalEvents: allEvents.length,
        datesProcessed: days - errors.length,
        errorsCount: errors.length,
      },
    };
  }

  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = { EnhancedFuncheapScraper };
