require("dotenv").config();

const express = require("express");
const cors = require("cors");
const NodeCache = require("node-cache");
const { FuncheapScraper } = require("../scraper");
const { EnhancedFuncheapScraper } = require("../enhancedFuncheapScraper");
const { generateEmojisForEvents } = require("../emojiGenerator");

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy for Vercel
app.set("trust proxy", 1);

// Cache for 1 hour (3600 seconds)
const cache = new NodeCache({ stdTTL: 3600 });
const scraper = new FuncheapScraper();
const enhancedScraper = new EnhancedFuncheapScraper();

// CORS configuration for production
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // Allow all origins in development
    if (process.env.NODE_ENV !== "production") {
      return callback(null, true);
    }

    // In production, you can specify allowed origins
    const allowedOrigins = [
      "http://localhost:3000",
      "http://localhost:3001",
      "https://bay-event-map.vercel.app",
      // Add your actual frontend URLs here
    ];

    // For now, allow all origins (you can restrict this later)
    return callback(null, true);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Helper function to convert date formats
const formatDateForFuncheap = (dateStr) => {
  // Convert YYYY-MM-DD to YYYY/MM/DD
  return dateStr.replace(/-/g, "/");
};

const formatDateForAPI = (dateStr) => {
  // Convert YYYY/MM/DD to YYYY-MM-DD
  return dateStr.replace(/\//g, "-");
};

// Helper function to get date range
const getDateRange = (startDate, days) => {
  const dates = [];
  const current = new Date(startDate);

  for (let i = 0; i < days; i++) {
    const date = new Date(current);
    date.setDate(current.getDate() + i);
    dates.push(date.toISOString().split("T")[0]);
  }

  return dates;
};

// Routes

// Get events for a specific date
app.get("/api/events/:date", async (req, res) => {
  const { date } = req.params; // Expected format: YYYY-MM-DD
  const cacheKey = `events-${date}`;

  try {
    // Check cache first
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json({
        success: true,
        events: cached,
        cached: true,
        date: date,
        count: cached.length,
      });
    }

    console.log(`Scraping events for ${date}...`);

    // Convert date format and scrape
    const funcheapDate = formatDateForFuncheap(date);
    const events = await scraper.getEventsForDate(funcheapDate);

    // Cache the results
    cache.set(cacheKey, events);

    res.json({
      success: true,
      events,
      cached: false,
      date: date,
      count: events.length,
    });
  } catch (error) {
    console.error(`Error fetching events for ${date}:`, error.message);
    res.status(500).json({
      success: false,
      error: "Failed to fetch events",
      message: error.message,
    });
  }
});

// Get events for a date range
app.get("/api/events", async (req, res) => {
  const {
    start = new Date().toISOString().split("T")[0],
    days = 7,
    category,
    location,
  } = req.query;

  try {
    const dates = getDateRange(start, parseInt(days));
    const allEvents = [];
    let cacheHits = 0;
    let cacheMisses = 0;

    // Fetch events for each date
    for (const date of dates) {
      const cacheKey = `events-${date}`;
      let dayEvents = cache.get(cacheKey);

      if (dayEvents) {
        cacheHits++;
      } else {
        console.log(`Scraping events for ${date}...`);
        const funcheapDate = formatDateForFuncheap(date);
        dayEvents = await scraper.getEventsForDate(funcheapDate);
        cache.set(cacheKey, dayEvents);
        cacheMisses++;

        // Add delay between scrapes to be respectful
        if (cacheMisses > 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      // Add date to each event and filter if needed
      const eventsWithDate = dayEvents.map((event) => ({
        ...event,
        date: date,
      }));

      allEvents.push(...eventsWithDate);
    }

    // Apply filters if provided
    let filteredEvents = allEvents;

    if (category) {
      filteredEvents = filteredEvents.filter(
        (event) =>
          event.categories &&
          event.categories.some((cat) =>
            cat.toLowerCase().includes(category.toLowerCase())
          )
      );
    }

    if (location) {
      filteredEvents = filteredEvents.filter(
        (event) =>
          event.location &&
          event.location.toLowerCase().includes(location.toLowerCase())
      );
    }

    res.json({
      success: true,
      events: filteredEvents,
      dateRange: { start, days: parseInt(days) },
      count: filteredEvents.length,
      cacheStats: { hits: cacheHits, misses: cacheMisses },
    });
  } catch (error) {
    console.error("Error fetching event range:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to fetch events",
      message: error.message,
    });
  }
});

// Get cache statistics
app.get("/api/cache/stats", (req, res) => {
  const stats = cache.getStats();
  const keys = cache.keys();

  res.json({
    success: true,
    stats,
    cachedDates: keys.map((key) => key.replace("events-", "")),
    count: keys.length,
  });
});

// Clear cache
app.delete("/api/cache", (req, res) => {
  cache.flushAll();
  res.json({
    success: true,
    message: "Cache cleared",
  });
});

// Enhanced routes with detailed event information

// Get events with detailed information for a specific date
app.get("/api/enhanced/events/:date", async (req, res) => {
  const { date } = req.params; // Expected format: YYYY-MM-DD
  const {
    includeDetails = "false",
    maxDetailRequests = "5",
    categories = "",
    excludeSponsored = "false",
    titleKeywords = "",
    costFilter = "",
    hasImages = "false",
  } = req.query;

  const cacheKey = `enhanced-events-${date}-${includeDetails}-${maxDetailRequests}`;

  try {
    // Check cache first
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json({
        success: true,
        events: cached,
        cached: true,
        date: date,
        count: cached.length,
        enhanced: includeDetails === "true",
      });
    }

    console.log(`Enhanced scraping events for ${date}...`);

    // Convert date format
    const funcheapDate = formatDateForFuncheap(date);

    // Build options
    const options = {
      includeDetails: includeDetails === "true",
      maxDetailRequests: parseInt(maxDetailRequests) || 5,
    };

    // Add detail filter if specified
    if (
      categories ||
      excludeSponsored === "true" ||
      titleKeywords ||
      costFilter ||
      hasImages === "true"
    ) {
      const filterOptions = {
        categories: categories
          ? categories.split(",").map((c) => c.trim())
          : [],
        excludeSponsored: excludeSponsored === "true",
        titleKeywords: titleKeywords
          ? titleKeywords.split(",").map((k) => k.trim())
          : [],
        costFilter: costFilter || null,
        hasImages: hasImages === "true",
      };
      options.detailFilter =
        EnhancedFuncheapScraper.createDetailFilter(filterOptions);
    }

    // Add progress callback
    options.onProgress = (progress) => {
      console.log(
        `  Progress: ${progress.step} - ${progress.completed}/${
          progress.total
        }${progress.currentEvent ? ` (${progress.currentEvent})` : ""}`
      );
    };

    const events = await enhancedScraper.getEventsWithDetails(
      funcheapDate,
      options
    );

    // Generate emojis for events if we have detailed information
    let eventsWithEmojis = events;
    if (options.includeDetails && events.length > 0) {
      console.log(`Generating emojis for ${events.length} events...`);
      try {
        eventsWithEmojis = await generateEmojisForEvents(events, 200); // 200ms delay between API calls
        console.log(
          `Generated emojis for ${
            eventsWithEmojis.filter((e) => e.emoji).length
          } events`
        );
      } catch (error) {
        console.error("Error generating emojis:", error);
        // Continue with original events if emoji generation fails
        eventsWithEmojis = events;
      }
    }

    // Cache the results (shorter TTL for detailed data due to size)
    cache.set(cacheKey, eventsWithEmojis, 3600); // an hour

    res.json({
      success: true,
      events: eventsWithEmojis,
      cached: false,
      date: date,
      count: eventsWithEmojis.length,
      enhanced: options.includeDetails,
      detailRequestsUsed: Math.min(
        eventsWithEmojis.filter((e) => e.hasDetailedInfo).length,
        options.maxDetailRequests
      ),
      emojisGenerated: options.includeDetails
        ? eventsWithEmojis.filter((e) => e.emoji).length
        : 0,
    });
  } catch (error) {
    console.error(`Error in enhanced scraping for ${date}:`, error.message);
    res.status(500).json({
      success: false,
      error: "Failed to fetch enhanced events",
      message: error.message,
    });
  }
});

// Get enhanced events for a date range
app.get("/api/enhanced/events", async (req, res) => {
  const {
    start = new Date().toISOString().split("T")[0],
    days = 3, // Lower default for enhanced scraping
    includeDetails = "false",
    maxDetailRequests = "3", // Lower default per day
    categories = "",
    excludeSponsored = "false",
    titleKeywords = "",
    costFilter = "",
    hasImages = "false",
  } = req.query;

  const cacheKey = `enhanced-range-${start}-${days}-${includeDetails}-${maxDetailRequests}`;

  try {
    // Check cache first
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json({
        ...cached,
        cached: true,
      });
    }

    console.log(`Enhanced scraping event range: ${start} for ${days} days...`);

    // Build options
    const options = {
      includeDetails: includeDetails === "true",
      maxDetailRequests: parseInt(maxDetailRequests) || 3,
    };

    // Add detail filter if specified
    if (
      categories ||
      excludeSponsored === "true" ||
      titleKeywords ||
      costFilter ||
      hasImages === "true"
    ) {
      const filterOptions = {
        categories: categories
          ? categories.split(",").map((c) => c.trim())
          : [],
        excludeSponsored: excludeSponsored === "true",
        titleKeywords: titleKeywords
          ? titleKeywords.split(",").map((k) => k.trim())
          : [],
        costFilter: costFilter || null,
        hasImages: hasImages === "true",
      };
      options.detailFilter =
        EnhancedFuncheapScraper.createDetailFilter(filterOptions);
    }

    const result = await enhancedScraper.getEventsWithDetailsForDateRange(
      start,
      parseInt(days),
      options
    );

    // Generate emojis for events if we have detailed information
    let eventsWithEmojis = result.events;
    let emojisGenerated = 0;
    if (options.includeDetails && result.events.length > 0) {
      console.log(
        `Generating emojis for ${result.events.length} events in date range...`
      );
      try {
        eventsWithEmojis = await generateEmojisForEvents(result.events, 200); // 200ms delay between API calls
        emojisGenerated = eventsWithEmojis.filter((e) => e.emoji).length;
        console.log(`Generated emojis for ${emojisGenerated} events`);
      } catch (error) {
        console.error("Error generating emojis for date range:", error);
        // Continue with original events if emoji generation fails
        eventsWithEmojis = result.events;
      }
    }

    const response = {
      success: true,
      events: eventsWithEmojis,
      dateRange: { start, days: parseInt(days) },
      count: eventsWithEmojis.length,
      enhanced: options.includeDetails,
      summary: result.summary,
      errors: result.errors,
      cached: false,
      emojisGenerated: emojisGenerated,
    };

    // Cache the results (shorter TTL for detailed data)
    cache.set(cacheKey, response, 1800); // 30 minutes

    res.json(response);
  } catch (error) {
    console.error("Error in enhanced date range scraping:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to fetch enhanced event range",
      message: error.message,
    });
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Server is running",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    version: "1.0.0",
    anthropicApiConfigured: !!process.env.ANTHROPIC_API_KEY,
  });
});

// Root route for Vercel
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Bay Event Map Backend API",
    endpoints: {
      health: "/health",
      events: "/api/events",
      eventsByDate: "/api/events/:date",
      enhancedEvents: "/api/enhanced/events",
      enhancedEventsByDate: "/api/enhanced/events/:date",
      cacheStats: "/api/cache/stats",
      clearCache: "DELETE /api/cache",
    },
    timestamp: new Date().toISOString(),
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    error: "Something went wrong!",
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
  });
});

// Export the app for Vercel
module.exports = app;

// Only start the server if this file is run directly (not imported)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`API docs: http://localhost:${PORT}/api/events`);
  });
}
