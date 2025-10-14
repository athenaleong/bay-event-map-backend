require("dotenv").config();

const express = require("express");
const cors = require("cors");
const NodeCache = require("node-cache");
const OpenAI = require("openai");
const { FuncheapScraper } = require("./scraper");
const { EnhancedFuncheapScraper } = require("./enhancedFuncheapScraper");
const { generateEmojisForEvents } = require("./emojiGenerator");
const { scrapeAndSaveFuncheapEvents } = require("./funcheap");
const { scrapeAndSaveDecenteredEvents } = require("./decentered");
const {
  getEventsFromDatabase,
  eventsExistForDate,
  deleteEventsForDate,
  getNearbyPlaces,
  getAllPlaces,
  getLiveEventsNearby,
} = require("./database");
const { recommendRoute } = require("./routeRecommender");

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy for Vercel
app.set("trust proxy", 1);

// Cache for 1 hour (3600 seconds)
const cache = new NodeCache({ stdTTL: 3600 });
const scraper = new FuncheapScraper();
const enhancedScraper = new EnhancedFuncheapScraper();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
      "http://localhost:8081",
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

    console.log(eventsWithEmojis);

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

// Scrape and save events to database
app.post("/api/scrape-and-save-funcheap/:date", async (req, res) => {
  const { date } = req.params; // Expected format: YYYY-MM-DD
  const {
    includeDetails = "true",
    categories = "",
    excludeSponsored = "false",
    titleKeywords = "",
    costFilter = "",
    hasImages = "false",
    forceRescrape = "false", // Force re-scraping even if data exists
  } = req.query;

  try {
    // Check if events already exist for this date (unless forcing rescrape)
    if (forceRescrape !== "true") {
      const existsInDb = await eventsExistForDate("funcheap-event", date);
      if (existsInDb) {
        console.log(
          `Events already exist for ${date}, returning from database...`
        );
        const dbResult = await getEventsFromDatabase(date);
        if (dbResult.success) {
          return res.json({
            success: true,
            events: dbResult.events,
            cached: false,
            fromDatabase: true,
            date: date,
            count: dbResult.count,
            message: "Events retrieved from database (already scraped)",
          });
        }
      }
    } else {
      // If force rescraping, delete existing events for this date
      console.log(
        `Force rescraping enabled, deleting existing events for ${date}...`
      );
      const deleteResult = await deleteEventsForDate(date);
      if (deleteResult.success) {
        console.log(`Deleted ${deleteResult.deleted} existing events`);
      }
    }

    // Use the reusable helper function
    const scrapeResult = await scrapeAndSaveFuncheapEvents(date, {
      includeDetails: includeDetails === "true",
      categories: categories,
      excludeSponsored: excludeSponsored === "true",
      titleKeywords: titleKeywords,
      costFilter: costFilter,
      hasImages: hasImages === "true",
    });

    if (!scrapeResult.success) {
      return res.status(500).json({
        success: false,
        error: "Failed to save events to database",
        message: scrapeResult.saveError || scrapeResult.message,
        scrapedEvents: scrapeResult.count,
        saved: scrapeResult.saved,
      });
    }

    res.json({
      success: true,
      events: scrapeResult.events,
      cached: false,
      fromDatabase: false,
      date: date,
      count: scrapeResult.count,
      enhanced: scrapeResult.enhanced,
      detailRequestsUsed: scrapeResult.detailRequestsUsed,
      emojisGenerated: scrapeResult.emojisGenerated,
      saved: scrapeResult.saved,
      message: scrapeResult.message,
    });
  } catch (error) {
    console.error(`Error in scrape-and-save for ${date}:`, error.message);
    res.status(500).json({
      success: false,
      error: "Failed to scrape and save events",
      message: error.message,
    });
  }
});

// Scrape and save Decentered Arts events to database
app.post("/api/scrape-and-save-decentered/:date", async (req, res) => {
  const { date } = req.params; // Expected format: YYYY-MM-DD

  try {
    console.log(`🚀 Scraping Decentered Arts events for ${date}...`);

    // Use the Decentered Arts scraping function
    const scrapeResult = await scrapeAndSaveDecenteredEvents(date, {
      progressPrefix: "Decentered ",
    });

    if (!scrapeResult.success) {
      return res.status(500).json({
        success: false,
        error: "Failed to scrape and save Decentered Arts events",
        message: scrapeResult.error || scrapeResult.message,
        scrapedEvents: scrapeResult.count,
        saved: scrapeResult.saved,
      });
    }

    res.json({
      success: true,
      events: scrapeResult.events,
      cached: false,
      fromDatabase: false,
      date: date,
      count: scrapeResult.count,
      enhanced: scrapeResult.enhanced,
      detailRequestsUsed: scrapeResult.detailRequestsUsed,
      emojisGenerated: scrapeResult.emojisGenerated,
      saved: scrapeResult.saved,
      message: scrapeResult.message,
      breakdown: scrapeResult.breakdown,
    });
  } catch (error) {
    console.error(
      `Error in scrape-and-save-decentered for ${date}:`,
      error.message
    );
    res.status(500).json({
      success: false,
      error: "Failed to scrape and save Decentered Arts events",
      message: error.message,
    });
  }
});

// Get events from database only
app.get("/api/events-db/:date", async (req, res) => {
  const { date } = req.params; // Expected format: YYYY-MM-DD
  const {
    includeDetails = "true",
    categories = "",
    excludeSponsored = "false",
    titleKeywords = "",
    costFilter = "",
    hasImages = "false",
  } = req.query;

  try {
    console.log(`📖 Fetching events from database for ${date}...`);

    // First, try to get events from database
    const result = await getEventsFromDatabase(date);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: "Failed to fetch events from database",
        message: result.error,
      });
    }

    // If events exist in database, return them
    if (result.events && result.events.length > 0) {
      console.log(`✅ Found ${result.count} events in database for ${date}`);
      return res.json({
        success: true,
        events: result.events,
        fromDatabase: true,
        date: date,
        count: result.count,
        message: "Events retrieved from database",
      });
    }

    // No events in database, return empty result
    console.log(`📭 No events found in database for ${date}`);
    return res.json({
      success: true,
      events: [],
      fromDatabase: true,
      date: date,
      count: 0,
      message: "No events found in database for this date",
    });
  } catch (error) {
    console.error(
      `Error fetching events from database for ${date}:`,
      error.message
    );
    res.status(500).json({
      success: false,
      error: "Failed to fetch events from database",
      message: error.message,
    });
  }
});

// Get all places
app.get("/api/places-sf", async (req, res) => {
  const { limit, offset, orderBy, ascending } = req.query;

  try {
    // Parse and validate parameters
    const options = {};

    if (limit) {
      const parsedLimit = parseInt(limit);
      if (isNaN(parsedLimit) || parsedLimit <= 0) {
        return res.status(400).json({
          success: false,
          error: "Invalid limit parameter",
          message: "limit must be a positive integer",
        });
      }
      options.limit = parsedLimit;
    }

    if (offset) {
      const parsedOffset = parseInt(offset);
      if (isNaN(parsedOffset) || parsedOffset < 0) {
        return res.status(400).json({
          success: false,
          error: "Invalid offset parameter",
          message: "offset must be a non-negative integer",
        });
      }
      options.offset = parsedOffset;
    }

    if (orderBy) {
      // Validate orderBy field (basic validation)
      const allowedFields = [
        "name",
        "created_at",
        "latitude",
        "longitude",
        "place_id",
      ];
      if (!allowedFields.includes(orderBy)) {
        return res.status(400).json({
          success: false,
          error: "Invalid orderBy parameter",
          message: `orderBy must be one of: ${allowedFields.join(", ")}`,
        });
      }
      options.orderBy = orderBy;
    }

    if (ascending !== undefined) {
      options.ascending = ascending === "true" || ascending === "1";
    }

    console.log(`Fetching all places with options:`, options);

    // Get all places from database
    const result = await getAllPlaces(options);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: "Failed to fetch places",
        message: result.error,
      });
    }

    res.json({
      success: true,
      places: result.places,
      count: result.count,
      options: options,
    });
  } catch (error) {
    console.error("Error in all places endpoint:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to fetch places",
      message: error.message,
    });
  }
});

// Get nearby places
app.get("/api/places-sf/nearby", async (req, res) => {
  const { latitude, longitude, radius } = req.query;

  try {
    // Validate required parameters
    if (!latitude || !longitude || !radius) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameters",
        message: "latitude, longitude, and radius are required",
      });
    }

    // Parse and validate parameters
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    const radiusMeters = parseFloat(radius);

    if (isNaN(lat) || isNaN(lng) || isNaN(radiusMeters)) {
      return res.status(400).json({
        success: false,
        error: "Invalid parameter format",
        message: "latitude, longitude, and radius must be valid numbers",
      });
    }

    if (lat < -90 || lat > 90) {
      return res.status(400).json({
        success: false,
        error: "Invalid latitude",
        message: "Latitude must be between -90 and 90",
      });
    }

    if (lng < -180 || lng > 180) {
      return res.status(400).json({
        success: false,
        error: "Invalid longitude",
        message: "Longitude must be between -180 and 180",
      });
    }

    if (radiusMeters <= 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid radius",
        message: "Radius must be greater than 0",
      });
    }

    console.log(
      `Finding places near ${lat}, ${lng} within ${radiusMeters}m...`
    );

    // Get nearby places from database
    const result = await getNearbyPlaces(lat, lng, radiusMeters);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: "Failed to fetch nearby places",
        message: result.error,
      });
    }

    res.json({
      success: true,
      places: result.places,
      count: result.count,
      searchParams: {
        latitude: lat,
        longitude: lng,
        radius: radiusMeters,
      },
    });
  } catch (error) {
    console.error("Error in nearby places endpoint:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to fetch nearby places",
      message: error.message,
    });
  }
});

// Get live events near a location
app.get("/api/events-near-by", async (req, res) => {
  const { lat, lon, limit, currentTime } = req.query;
  console.log(req.query);

  try {
    // Validate required parameters
    if (!lat || !lon || !limit || !currentTime) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameters",
        message: "lat, lon, limit, and currentTime are required",
      });
    }

    // Parse and validate parameters
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lon);
    const eventLimit = parseInt(limit);

    if (isNaN(latitude) || isNaN(longitude) || isNaN(eventLimit)) {
      return res.status(400).json({
        success: false,
        error: "Invalid parameter format",
        message: "lat, lon, and limit must be valid numbers",
      });
    }

    if (latitude < -90 || latitude > 90) {
      return res.status(400).json({
        success: false,
        error: "Invalid latitude",
        message: "Latitude must be between -90 and 90",
      });
    }

    if (longitude < -180 || longitude > 180) {
      return res.status(400).json({
        success: false,
        error: "Invalid longitude",
        message: "Longitude must be between -180 and 180",
      });
    }

    if (eventLimit <= 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid limit",
        message: "Limit must be greater than 0",
      });
    }

    // Validate currentTime format (should be ISO string)
    const timeDate = new Date(currentTime);
    if (isNaN(timeDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: "Invalid currentTime format",
        message: "currentTime must be a valid ISO date string",
      });
    }

    console.log(
      `Finding live events near ${latitude}, ${longitude} at ${currentTime} (limit: ${eventLimit})`
    );

    // Get live events from database
    const result = await getLiveEventsNearby(
      latitude,
      longitude,
      eventLimit,
      currentTime,
      1000000
    );

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: "Failed to fetch live events",
        message: result.error,
      });
    }

    res.json({
      success: true,
      events: result.events,
      count: result.count,
      searchParams: {
        latitude: latitude,
        longitude: longitude,
        limit: eventLimit,
        currentTime: currentTime,
      },
    });
  } catch (error) {
    console.error("Error in events-near-by endpoint:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to fetch live events",
      message: error.message,
    });
  }
});

// Recommend Route endpoint
app.post("/api/recommendRoute", async (req, res) => {
  try {
    const {
      lat,
      lon,
      locationName,
      timeLimit,
      intention,
      currentTime,
      radius = 400,
    } = req.body;

    const result = await recommendRoute({
      lat,
      lon,
      locationName,
      timeLimit,
      intention,
      currentTime,
      radius,
    });

    if (!result.success) {
      return res.status(result.status || 500).json({
        success: false,
        error: result.error,
        message: result.message,
      });
    }

    res.json({
      success: true,
      route: result.route,
    });
  } catch (error) {
    console.error("Error in recommendRoute endpoint:", error);
    res.status(500).json({
      success: false,
      error: "Internal Server Error",
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
    supabaseConfigured: !!(
      process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
    ),
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
      scrapeAndSaveFuncheap: "POST /api/scrape-and-save-funcheap/:date",
      scrapeAndSaveDecentered: "POST /api/scrape-and-save-decentered/:date",
      eventsFromDatabase: "/api/events-db/:date",
      liveEventsNearby:
        "/api/events-near-by?lat=37.7749&lon=-122.4194&limit=10&currentTime=2024-01-15T14:30:00-08:00",
      allPlaces: "/api/places-sf?limit=10&orderBy=name",
      nearbyPlaces:
        "/api/places-sf/nearby?latitude=37.7749&longitude=-122.4194&radius=1000",
      recommendRoute: "POST /api/recommendRoute",
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
