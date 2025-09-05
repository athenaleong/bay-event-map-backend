const express = require("express");
const cors = require("cors");
const NodeCache = require("node-cache");
const { FuncheapScraper } = require("./scraper");

const app = express();
const PORT = process.env.PORT || 3001;

// Cache for 1 hour (3600 seconds)
const cache = new NodeCache({ stdTTL: 3600 });
const scraper = new FuncheapScraper();

// Middleware
app.use(cors());
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

// Health check
app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Server is running",
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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`API docs: http://localhost:${PORT}/api/events`);
});
