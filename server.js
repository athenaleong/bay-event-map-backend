require("dotenv").config();

const express = require("express");
const cors = require("cors");
const NodeCache = require("node-cache");
const OpenAI = require("openai");
const { FuncheapScraper } = require("./scraper");
const { EnhancedFuncheapScraper } = require("./enhancedFuncheapScraper");
const { generateEmojisForEvents } = require("./emojiGenerator");
const {
  saveEventsToDatabase,
  saveEnhancedEventsToEventTable,
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

// Reusable function to scrape events and save to database
/**
 * Classify an event using OpenAI prompt
 * @param {Object} event - Event object to classify
 * @returns {Promise<string>} - Event type: 'compilation', 'standalone', or 'part-of-a-compilation'
 */
const classifyEvent = async (event) => {
  try {
    const response = await openai.responses.create({
      prompt: {
        id: "pmpt_68ec0010e0ec819383fa3109de9d1d6d0d6867f5f9275e7f",
        version: "4",
        variables: {
          event_details: JSON.stringify(event, null, 2),
        },
      },
    });

    // Extract the event_type from the response
    if (response && response.output_text) {
      try {
        const parsedOutput = JSON.parse(response.output_text);
        if (parsedOutput && parsedOutput.event_type) {
          return parsedOutput.event_type;
        }
      } catch (parseError) {
        console.error(
          `Failed to parse OpenAI response for event "${event.title}":`,
          parseError
        );
      }
    }

    // Fallback to standalone if classification fails
    console.warn(
      `Failed to classify event "${event.title}", defaulting to standalone`
    );
    return "standalone";
  } catch (error) {
    console.error(`Error classifying event "${event.title}":`, error);
    // Fallback to standalone if classification fails
    return "standalone";
  }
};

/**
 * Generate human-friendly event copy using OpenAI
 * @param {Object} event - Event object to enhance
 * @returns {Promise<Object>} - Enhanced event object with human-friendly copy
 */
const generateHumanFriendlyEventCopy = async (event) => {
  try {
    const response = await openai.responses.create({
      prompt: {
        id: "pmpt_68ed704a7a088194b546caa4c299595f07a88fb8ac0cdb09",
        version: "2",
        variables: {
          event_details: JSON.stringify(event, null, 2),
        },
      },
    });

    // Extract the enhanced event data from the response
    if (response && response.output_text) {
      try {
        const parsedOutput = JSON.parse(response.output_text);
        if (parsedOutput && parsedOutput.title) {
          return {
            title: parsedOutput.title,
            description: parsedOutput.description,
            cost: parsedOutput.cost,
            rsvp_ticket_required: parsedOutput.rsvp_ticket_required,
            emoji: parsedOutput.emoji,
          };
        }
      } catch (parseError) {
        console.error(
          `Failed to parse OpenAI response for event "${event.title}":`,
          parseError
        );
      }
    }

    // Fallback to original event data if enhancement fails
    console.warn(
      `Failed to generate human-friendly copy for event "${event.title}", using original data`
    );
    return {
      title: event.title,
      description: event.description,
      cost: event.cost,
      rsvp_ticket_required: false,
      emoji: event.emoji || "🎉",
    };
  } catch (error) {
    console.error(
      `Error generating human-friendly copy for event "${event.title}":`,
      error
    );
    // Fallback to original event data if enhancement fails
    return {
      title: event.title,
      description: event.description,
      cost: event.cost,
      rsvp_ticket_required: false,
      emoji: event.emoji || "🎉",
    };
  }
};

const scrapeAndSaveEvents = async (date, options = {}) => {
  const {
    includeDetails = true,
    categories = "",
    excludeSponsored = false,
    titleKeywords = "",
    costFilter = "",
    hasImages = false,
    progressPrefix = "",
  } = options;

  console.log(`${progressPrefix}🚀 Scraping and saving events for ${date}...`);

  // Convert date format
  const funcheapDate = formatDateForFuncheap(date);

  // Build scraping options
  const scrapingOptions = {
    includeDetails: includeDetails,
  };

  // Add detail filter if specified
  if (
    categories ||
    excludeSponsored ||
    titleKeywords ||
    costFilter ||
    hasImages
  ) {
    const filterOptions = {
      categories: categories
        ? typeof categories === "string"
          ? categories.split(",").map((c) => c.trim())
          : categories
        : [],
      excludeSponsored: excludeSponsored,
      titleKeywords: titleKeywords
        ? typeof titleKeywords === "string"
          ? titleKeywords.split(",").map((k) => k.trim())
          : titleKeywords
        : [],
      costFilter: costFilter || null,
      hasImages: hasImages,
    };
    scrapingOptions.detailFilter =
      EnhancedFuncheapScraper.createDetailFilter(filterOptions);
  }

  // Add progress callback
  scrapingOptions.onProgress = (progress) => {
    console.log(
      `  ${progressPrefix}Progress: ${progress.step} - ${progress.completed}/${
        progress.total
      }${progress.currentEvent ? ` (${progress.currentEvent})` : ""}`
    );
  };

  // Step 1: Scrape events with enhanced details
  console.log(`${progressPrefix}📋 Scraping enhanced events for ${date}...`);
  const events = await enhancedScraper.getEventsWithDetails(
    funcheapDate,
    scrapingOptions
  );

  // Count events with non-null venues
  let eventsWithVenues = events.filter((event) => event.venue != null).length;
  let eventsWithAddresses = events.filter(
    (event) => event.address != null
  ).length;
  console.log(
    `${progressPrefix}📍 Found ${eventsWithVenues} events with venue information`
  );
  console.log(
    `${progressPrefix}🏢 Found ${eventsWithAddresses} events with address information`
  );

  if (!events || events.length === 0) {
    return {
      success: true,
      events: [],
      count: 0,
      message: "No events found for this date",
      saved: 0,
      enhanced: includeDetails,
      detailRequestsUsed: 0,
      emojisGenerated: 0,
    };
  }

  // Step 2: Classify events immediately after scraping
  console.log(`${progressPrefix}🤖 Classifying ${events.length} events...`);
  const eventsWithClassification = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    console.log(
      `${progressPrefix}  Classifying event ${i + 1}/${events.length}: ${
        event.title
      }`
    );

    const eventType = await classifyEvent(event);
    eventsWithClassification.push({
      ...event,
      event_type: eventType,
    });

    // Add a small delay to avoid rate limiting
    if (i < events.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  eventsWithVenues = eventsWithClassification.filter(
    (event) => event.venue != null
  ).length;
  eventsWithAddresses = eventsWithClassification.filter(
    (event) => event.address != null
  ).length;
  console.log(
    `${progressPrefix}📍 Found ${eventsWithVenues} events with venue information`
  );
  console.log(
    `${progressPrefix}🏢 Found ${eventsWithAddresses} events with address information`
  );

  // Step 3: Geocode events after classification
  console.log(
    `${progressPrefix}🗺️  Geocoding addresses for ${eventsWithClassification.length} events...`
  );
  const { geocodeAddress } = require("./database");
  const eventsWithGeocoding = await Promise.all(
    eventsWithClassification.map(async (event) => {
      // Determine the address to geocode
      let addressToGeocode = null;
      if (event.address && event.address.trim() !== "") {
        addressToGeocode = event.address;
      } else if (event.venue && event.venue.trim() !== "") {
        addressToGeocode = event.venue;
      }

      // Geocode the address if available
      let coordinates = null;
      if (addressToGeocode) {
        coordinates = await geocodeAddress(addressToGeocode);
      }

      return {
        ...event,
        latitude: coordinates ? coordinates.latitude : null,
        longitude: coordinates ? coordinates.longitude : null,
      };
    })
  );

  // Step 4: Save events to appropriate tables based on classification
  console.log(
    `${progressPrefix}💾 Saving ${eventsWithGeocoding.length} events to database...`
  );
  const saveResult = await saveEventsToDatabase(eventsWithGeocoding);

  if (!saveResult.success) {
    console.error(
      `${progressPrefix}Failed to save events to database:`,
      saveResult.error
    );
    return {
      success: false,
      events: eventsWithGeocoding,
      count: eventsWithGeocoding.length,
      enhanced: includeDetails,
      saved: 0,
      saveError: saveResult.error,
      message: "Events scraped but failed to save to database",
      detailRequestsUsed: eventsWithGeocoding.filter((e) => e.hasDetailedInfo)
        .length,
      emojisGenerated: 0,
    };
  }

  // Step 5: Generate human-friendly copies for standalone and part-of-compilation events
  const eventsForEnhancement = eventsWithGeocoding.filter(
    (event) =>
      event.event_type === "standalone" ||
      event.event_type === "part-of-a-compilation"
  );

  let enhancedEvents = [];
  if (eventsForEnhancement.length > 0) {
    console.log(
      `${progressPrefix}✨ Generating human-friendly copies for ${eventsForEnhancement.length} events...`
    );

    for (let i = 0; i < eventsForEnhancement.length; i++) {
      const event = eventsForEnhancement[i];
      console.log(
        `${progressPrefix}  Enhancing event ${i + 1}/${
          eventsForEnhancement.length
        }: ${event.title}`
      );

      try {
        const enhancedCopy = await generateHumanFriendlyEventCopy(event);

        // Combine original event data with enhanced copy
        const combinedEvent = {
          // Enhanced copy data
          title: enhancedCopy.title,
          description: enhancedCopy.description,
          cost: enhancedCopy.cost,
          rsvp_ticket_required: enhancedCopy.rsvp_ticket_required,
          emoji: enhancedCopy.emoji,

          // Original event data
          venue: event.venue,
          address: event.address,
          start_time: event.startTime,
          end_time: event.endTime,
          url: event.url,
          latitude: event.latitude, // Already geocoded
          longitude: event.longitude, // Already geocoded
          event_urls: event.eventButtonUrls,
          event_type: event.event_type,
          event_source: "funcheap",

          // Additional metadata
          categories: event.categories,
          image: event.image,
          social_links: event.socialLinks,
          scraped_at: new Date().toISOString(),
        };

        enhancedEvents.push(combinedEvent);

        // Add a small delay to avoid rate limiting
        if (i < eventsForEnhancement.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      } catch (error) {
        console.error(`Error enhancing event "${event.title}":`, error);
        // Continue with other events even if one fails
      }
    }
  }

  // Step 6: Save enhanced events to main event table
  let enhancedSaveResult = { success: true, saved: 0, events: [] };
  if (enhancedEvents.length > 0) {
    console.log(
      `${progressPrefix}💾 Saving ${enhancedEvents.length} enhanced events to main event table...`
    );
    enhancedSaveResult = await saveEnhancedEventsToEventTable(enhancedEvents);
  }

  const totalSaved = saveResult.saved + enhancedSaveResult.saved;
  console.log(
    `${progressPrefix}✅ Successfully processed ${date}: scraped ${eventsWithGeocoding.length}, saved ${totalSaved} total events`
  );

  return {
    success: true,
    events: [...saveResult.events, ...enhancedSaveResult.events],
    count: totalSaved,
    enhanced: includeDetails,
    detailRequestsUsed: eventsWithGeocoding.filter((e) => e.hasDetailedInfo)
      .length,
    emojisGenerated: enhancedEvents.length,
    saved: totalSaved,
    message: `Successfully scraped and saved ${totalSaved} events (${saveResult.saved} to funcheap tables, ${enhancedSaveResult.saved} to main event table)`,
    breakdown: {
      funcheapEvents: saveResult.saved,
      enhancedEvents: enhancedSaveResult.saved,
    },
  };
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
app.post("/api/scrape-and-save/:date", async (req, res) => {
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
    const scrapeResult = await scrapeAndSaveEvents(date, {
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

// Get events from database (auto-scrape if not found)
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

    // No events in database, auto-scrape them
    console.log(`🚀 No events found in database for ${date}, auto-scraping...`);

    // Use the reusable helper function
    const autoScrapeResult = await scrapeAndSaveEvents(date, {
      includeDetails: includeDetails === "true",
      categories: categories,
      excludeSponsored: excludeSponsored === "true",
      titleKeywords: titleKeywords,
      costFilter: costFilter,
      hasImages: hasImages === "true",
      progressPrefix: "Auto-scrape ",
    });

    if (!autoScrapeResult.success) {
      // Still return the scraped events even if saving failed
      return res.json({
        success: true,
        events: autoScrapeResult.events,
        fromDatabase: false,
        autoScraped: true,
        date: date,
        count: autoScrapeResult.count,
        enhanced: autoScrapeResult.enhanced,
        saved: autoScrapeResult.saved,
        saveError: autoScrapeResult.saveError,
        message: autoScrapeResult.message,
      });
    }

    res.json({
      success: true,
      events: autoScrapeResult.events,
      fromDatabase: false,
      autoScraped: true,
      date: date,
      count: autoScrapeResult.count,
      enhanced: autoScrapeResult.enhanced,
      detailRequestsUsed: autoScrapeResult.detailRequestsUsed,
      emojisGenerated: autoScrapeResult.emojisGenerated,
      saved: autoScrapeResult.saved,
      message: autoScrapeResult.message,
    });
  } catch (error) {
    console.error(`Error in auto-scrape for ${date}:`, error.message);
    res.status(500).json({
      success: false,
      error: "Failed to fetch/scrape events",
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
      scrapeAndSave: "POST /api/scrape-and-save/:date",
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
