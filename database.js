const { createClient } = require("@supabase/supabase-js");
const { Storage } = require("@google-cloud/storage");

// Initialize Supabase client
let supabase = null;

// Initialize Google Cloud Storage client
let gcsClient = null;

function initializeGCS() {
  // Google Cloud Storage can authenticate via:
  // 1. Service account key JSON (recommended for production)
  // 2. Application Default Credentials (for local development with gcloud CLI)

  const projectId = process.env.GCS_PROJECT_ID;
  const keyFilename = process.env.GCS_KEY_FILE; // Path to service account key JSON file
  const credentials = process.env.GCS_CREDENTIALS; // JSON string of service account key

  if (!projectId) {
    console.warn(
      "GCS_PROJECT_ID not found in environment variables. Google Cloud Storage operations will be disabled."
    );
    return null;
  }

  try {
    // If credentials JSON string is provided (recommended for serverless)
    if (credentials) {
      const credentialsObj = JSON.parse(credentials);
      return new Storage({
        projectId,
        credentials: credentialsObj,
      });
    }

    // If key file path is provided
    if (keyFilename) {
      return new Storage({
        projectId,
        keyFilename,
      });
    }

    // Otherwise, use Application Default Credentials
    console.log(
      "Using Application Default Credentials for Google Cloud Storage"
    );
    return new Storage({ projectId });
  } catch (error) {
    console.error("Error initializing Google Cloud Storage:", error.message);
    return null;
  }
}

gcsClient = initializeGCS();

function initializeSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.warn(
      "SUPABASE_URL or SUPABASE_ANON_KEY not found in environment variables. Database operations will be disabled."
    );
    return null;
  }

  if (
    supabaseUrl === "your_supabase_url_here" ||
    supabaseKey === "your_supabase_anon_key_here"
  ) {
    console.warn(
      "Supabase credentials are set to placeholder values. Please update with your actual credentials."
    );
    return null;
  }

  return createClient(supabaseUrl, supabaseKey);
}

supabase = initializeSupabase();

/**
 * Convert UTC time to Los Angeles time
 * @param {string|Date} utcTime - UTC timestamp
 * @returns {string} - LA time in ISO format with timezone
 */
function convertToLATime(utcTime) {
  if (!utcTime) return null;

  const date = new Date(utcTime);

  // Get the time in LA timezone
  const laTime = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  // Extract the time components
  const year = laTime.find((part) => part.type === "year").value;
  const month = laTime.find((part) => part.type === "month").value;
  const day = laTime.find((part) => part.type === "day").value;
  const hour = laTime.find((part) => part.type === "hour").value;
  const minute = laTime.find((part) => part.type === "minute").value;
  const second = laTime.find((part) => part.type === "second").value;

  // Get the timezone offset for LA time
  // Use a more direct approach to get the current offset
  const now = new Date();
  const laOffset = new Intl.DateTimeFormat("en", {
    timeZone: "America/Los_Angeles",
    timeZoneName: "longOffset",
  }).formatToParts(now);

  // Find the offset part (e.g., "GMT-8" or "GMT-7")
  const offsetPart = laOffset.find((part) => part.type === "timeZoneName");
  let offsetString = "-08:00"; // default to PST

  if (offsetPart) {
    const offsetText = offsetPart.value;
    // Extract offset from "GMT-8" or "GMT-7" format
    const offsetMatch = offsetText.match(/GMT([+-]\d+)/);
    if (offsetMatch) {
      const offsetHours = parseInt(offsetMatch[1]);
      const offsetSign = offsetHours >= 0 ? "+" : "-";
      const absOffsetHours = Math.abs(offsetHours);
      offsetString = `${offsetSign}${absOffsetHours
        .toString()
        .padStart(2, "0")}:00`;
    }
  }

  return `${year}-${month}-${day}T${hour}:${minute}:${second}${offsetString}`;
}

/**
 * Get current LA time
 * @returns {string} - Current LA time in ISO format
 */
function getCurrentLATime() {
  return convertToLATime(new Date());
}

/**
 * Geocode an address using MapBox API
 * @param {string} address - The address to geocode
 * @returns {Promise<Object>} - Object with latitude and longitude or null if failed
 */
async function geocodeAddress(address) {
  try {
    const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN;

    if (!MAPBOX_TOKEN) {
      console.warn(
        "MAPBOX_TOKEN not found in environment variables. Geocoding disabled."
      );
      return null;
    }

    if (!address || typeof address !== "string" || address.trim() === "") {
      return null;
    }

    // Clean the address
    const cleanAddress = address.trim();

    // Use MapBox Geocoding API (forward geocoding)
    const response = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
        cleanAddress
      )}.json?access_token=${MAPBOX_TOKEN}&limit=1`
    );

    if (!response.ok) {
      console.error(
        `MapBox geocoding failed for "${cleanAddress}": ${response.status} ${response.statusText}`
      );
      return null;
    }

    const data = await response.json();

    if (!data.features || data.features.length === 0) {
      console.log(`No coordinates found for address: "${cleanAddress}"`);
      return null;
    }

    const coordinates = data.features[0].center; // [longitude, latitude]
    const [longitude, latitude] = coordinates;

    console.log(`Geocoded "${cleanAddress}" to ${latitude}, ${longitude}`);

    return {
      latitude: latitude,
      longitude: longitude,
    };
  } catch (error) {
    console.error(`Error geocoding address "${address}":`, error.message);
    return null;
  }
}

/**
 * Map scraped event data to database schema with geocoding
 * @param {Object} event - The scraped event object
 * @returns {Promise<Object>} - Database-ready event object with geocoded coordinates
 */
async function mapEventToDatabase(event) {
  // Log the original event times for debugging
  console.log(
    `[DB] Original event time: ${
      event.startTime
    } -> Converted: ${convertToLATime(event.startTime)}`
  );

  console.log(event);

  return {
    title: event.title || "",
    description: event.description || null,
    url: event.url || null,
    start_time: convertToLATime(event.startTime),
    end_time: convertToLATime(event.endTime),
    cost: event.cost || null,
    image: event.image || null,
    categories: event.categories || [],
    source: event.source || "funcheap",
    venue: event.venue || null,
    address: event.address || null,
    social_links: event.socialLinks || null,
    event_button_urls: event.eventButtonUrls || null,
    scraped_at: getCurrentLATime(),
    latitude: event.latitude || null, // Already geocoded
    longitude: event.longitude || null, // Already geocoded
    emoji: event.emoji || null,
    event_type: event.event_type || "standalone",
    event_source: "funcheap",
  };
}

/**
 * Save events to the database
 * @param {Array} events - Array of event objects
 * @returns {Promise<Object>} - Result object with success status and data
 */
async function saveEventsToDatabase(events) {
  try {
    if (!supabase) {
      console.warn("Supabase client not initialized. Skipping database save.");
      return {
        success: false,
        error: "Database not configured",
        saved: 0,
        events: [],
      };
    }

    if (!events || events.length === 0) {
      return {
        success: true,
        saved: 0,
        events: [],
      };
    }

    // Map events to database schema (geocoding already done)
    console.log(`📋 Mapping ${events.length} events to database schema...`);
    const dbEvents = await Promise.all(events.map(mapEventToDatabase));

    // Separate events by type
    const standaloneEvents = dbEvents.filter(
      (event) => event.event_type === "standalone"
    );
    const partOfCompilationEvents = dbEvents.filter(
      (event) => event.event_type === "part-of-a-compilation"
    );
    const compilationEvents = dbEvents.filter(
      (event) => event.event_type === "compilation"
    );

    console.log(
      `📊 Event classification: ${standaloneEvents.length} standalone, ${partOfCompilationEvents.length} part-of-compilation, ${compilationEvents.length} compilation`
    );

    // Save standalone events to funcheap-event table
    const standaloneResult = await saveEventsToTable(
      standaloneEvents,
      "funcheap-event"
    );

    // Save part-of-compilation events to funcheap-event table
    const partOfCompilationResult = await saveEventsToTable(
      partOfCompilationEvents,
      "funcheap-event"
    );

    // Save compilation events to funcheap-event-compilation table
    const compilationResult = await saveEventsToTable(
      compilationEvents,
      "funcheap-event-compilation"
    );

    const totalSaved =
      standaloneResult.saved +
      partOfCompilationResult.saved +
      compilationResult.saved;
    const allSavedEvents = [
      ...standaloneResult.events,
      ...partOfCompilationResult.events,
      ...compilationResult.events,
    ];
    const totalDuplicates =
      standaloneResult.duplicates +
      partOfCompilationResult.duplicates +
      compilationResult.duplicates;
    const totalFailures =
      standaloneResult.failures +
      partOfCompilationResult.failures +
      compilationResult.failures;

    console.log(
      `Successfully saved ${totalSaved} events to database (${totalDuplicates} duplicates skipped, ${totalFailures} other failures)`
    );

    return {
      success: true, // Still return success even if some events failed
      saved: totalSaved,
      events: allSavedEvents,
      duplicates: totalDuplicates,
      failures: totalFailures,
      breakdown: {
        standalone: standaloneResult,
        partOfCompilation: partOfCompilationResult,
        compilation: compilationResult,
      },
    };
  } catch (error) {
    console.error("Error saving events to database:", error);
    return {
      success: false,
      error: error.message,
      saved: 0,
      events: [],
    };
  }
}

/**
 * Save events to a specific table
 * @param {Array} events - Array of event objects
 * @param {string} tableName - Name of the table to save to
 * @returns {Promise<Object>} - Result object
 */
async function saveEventsToTable(events, tableName) {
  if (!events || events.length === 0) {
    return {
      success: true,
      saved: 0,
      events: [],
      duplicates: 0,
      failures: 0,
    };
  }

  const savedEvents = [];
  const failedEvents = [];
  let savedCount = 0;
  let duplicateCount = 0;

  for (const event of events) {
    try {
      const { data, error } = await supabase
        .from(tableName)
        .insert([event])
        .select();

      if (error) {
        // Check if it's a duplicate key error
        if (error.code === "23505") {
          console.log(
            `Skipping duplicate event in ${tableName}: ${event.title} at ${event.start_time}`
          );
          duplicateCount++;
          failedEvents.push({ event, error: "duplicate" });
        } else {
          console.error(
            `Failed to save event "${event.title}" to ${tableName}:`,
            error
          );
          failedEvents.push({ event, error: error.message });
        }
      } else {
        savedEvents.push(data[0]);
        savedCount++;
      }
    } catch (err) {
      console.error(
        `Error saving event "${event.title}" to ${tableName}:`,
        err
      );
      failedEvents.push({ event, error: err.message });
    }
  }

  return {
    success: true,
    saved: savedCount,
    events: savedEvents,
    duplicates: duplicateCount,
    failures: failedEvents.length - duplicateCount,
    failedEvents: failedEvents,
  };
}

/**
 * Get events from database for a specific date (in LA time)
 * @param {string} date - Date in YYYY-MM-DD format (LA time)
 * @returns {Promise<Object>} - Result object with events
 */
async function getEventsFromDatabase(date) {
  try {
    if (!supabase) {
      return {
        success: false,
        error: "Database not configured",
        events: [],
      };
    }

    // Create LA time range for the given date
    const startOfDay = `${date}T00:00:00`;
    const endOfDay = `${date}T23:59:59`;

    const { data, error } = await supabase
      .from("events")
      .select("*")
      .gte("start_time", startOfDay)
      .lte("start_time", endOfDay)
      .order("start_time", { ascending: true });

    if (error) {
      console.error("Database query error:", error);
      return {
        success: false,
        error: error.message,
        events: [],
      };
    }

    return {
      success: true,
      events: data || [],
      count: data?.length || 0,
    };
  } catch (error) {
    console.error("Error fetching events from database:", error);
    return {
      success: false,
      error: error.message,
      events: [],
    };
  }
}

/**
 * Check if events exist in database for a specific date (in LA time)
 * @param {string} date - Date in YYYY-MM-DD format (LA time)
 * @returns {Promise<boolean>} - Whether events exist for this date
 */
async function eventsExistForDate(table, date) {
  try {
    if (!supabase) {
      return false;
    }

    // Create LA time range for the given date
    // We need to create proper LA timezone timestamps to match what's stored in the database
    // Create timestamps that represent the start and end of the day in LA timezone
    const startOfDay = `${date}T00:00:00-08:00`; // Start with PST (winter time)
    const endOfDay = `${date}T23:59:59-08:00`; // End with PST (winter time)

    // For summer time (PDT), we need to check if the date falls in DST period
    // Let's create a more robust approach by checking the actual timezone offset
    const testDate = new Date(`${date}T12:00:00`); // Noon on the given date
    const laOffset = new Intl.DateTimeFormat("en", {
      timeZone: "America/Los_Angeles",
      timeZoneName: "longOffset",
    }).formatToParts(testDate);

    const offsetPart = laOffset.find((part) => part.type === "timeZoneName");
    let offsetString = "-08:00"; // default to PST

    if (offsetPart) {
      const offsetText = offsetPart.value;
      const offsetMatch = offsetText.match(/GMT([+-]\d+)/);
      if (offsetMatch) {
        const offsetHours = parseInt(offsetMatch[1]);
        const offsetSign = offsetHours >= 0 ? "+" : "-";
        const absOffsetHours = Math.abs(offsetHours);
        offsetString = `${offsetSign}${absOffsetHours
          .toString()
          .padStart(2, "0")}:00`;
      }
    }

    // Create the final timestamps with the correct timezone offset
    const startOfDayFinal = `${date}T00:00:00${offsetString}`;
    const endOfDayFinal = `${date}T23:59:59${offsetString}`;

    console.log("start of day", startOfDayFinal);
    console.log("end of day", endOfDayFinal);

    const { data, error } = await supabase
      .from(table)
      .select("id")
      .gte("start_time", startOfDayFinal)
      .lte("start_time", endOfDayFinal)
      .limit(1);

    console.log(JSON.stringify(data));

    if (error) {
      console.error("Database query error:", error);
      return false;
    }

    return data && data.length > 0;
  } catch (error) {
    console.error("Error checking events existence:", error);
    return false;
  }
}

/**
 * Delete events for a specific date (useful for re-scraping, in LA time)
 * @param {string} date - Date in YYYY-MM-DD format (LA time)
 * @returns {Promise<Object>} - Result object
 */
async function deleteEventsForDate(date) {
  try {
    if (!supabase) {
      return {
        success: false,
        error: "Database not configured",
        deleted: 0,
      };
    }

    // Create LA time range for the given date
    const startOfDay = `${date}T00:00:00`;
    const endOfDay = `${date}T23:59:59`;

    const { data, error } = await supabase
      .from("events")
      .delete()
      .gte("start_time", startOfDay)
      .lte("start_time", endOfDay)
      .select("id");

    if (error) {
      console.error("Database delete error:", error);
      return {
        success: false,
        error: error.message,
        deleted: 0,
      };
    }

    return {
      success: true,
      deleted: data?.length || 0,
    };
  } catch (error) {
    console.error("Error deleting events:", error);
    return {
      success: false,
      error: error.message,
      deleted: 0,
    };
  }
}

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param {number} lat1 - Latitude of first point
 * @param {number} lon1 - Longitude of first point
 * @param {number} lat2 - Latitude of second point
 * @param {number} lon2 - Longitude of second point
 * @returns {number} - Distance in meters
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in meters
}

/**
 * Get nearby places from the places_sf table
 * @param {number} latitude - Center latitude
 * @param {number} longitude - Center longitude
 * @param {number} radiusMeters - Search radius in meters
 * @returns {Promise<Object>} - Result object with places
 */
async function getNearbyPlaces(latitude, longitude, radiusMeters) {
  try {
    if (!supabase) {
      return {
        success: false,
        error: "Database not configured",
        places: [],
      };
    }

    // Convert radius from meters to degrees (approximate)
    // 1 degree latitude ≈ 111,000 meters
    // 1 degree longitude ≈ 111,000 * cos(latitude) meters
    const latRadius = radiusMeters / 111000;
    const lngRadius =
      radiusMeters / (111000 * Math.cos((Math.abs(latitude) * Math.PI) / 180));

    // Calculate bounding box coordinates
    const minLat = latitude - latRadius;
    const maxLat = latitude + latRadius;
    const minLng = longitude - lngRadius;
    const maxLng = longitude + lngRadius;

    console.log(
      `Searching for places near ${latitude}, ${longitude} within ${radiusMeters}m`
    );
    console.log(
      `Bounding box: lat ${minLat} to ${maxLat}, lng ${minLng} to ${maxLng}`
    );

    // For very large radius searches, skip bounding box and get all places
    let data, error;
    if (radiusMeters > 50000) {
      // 50km radius
      console.log("Large radius detected, fetching all places...");
      const result = await supabase
        .from("places_sf")
        .select("*")
        .not("latitude", "is", null)
        .not("longitude", "is", null)
        .limit(10000);
      data = result.data;
      error = result.error;
    } else {
      // Use bounding box for smaller radius searches
      const result = await supabase
        .from("places_sf")
        .select("*")
        .gte("latitude", minLat)
        .lte("latitude", maxLat)
        .gte("longitude", minLng)
        .lte("longitude", maxLng)
        .not("latitude", "is", null)
        .not("longitude", "is", null);
      data = result.data;
      error = result.error;
    }

    if (error) {
      console.error("Database query error:", error);
      return {
        success: false,
        error: error.message,
        places: [],
      };
    }

    if (!data || data.length === 0) {
      return {
        success: true,
        places: [],
        count: 0,
      };
    }

    // Now filter by exact distance using Haversine formula
    const nearbyPlaces = data.filter((place) => {
      const distance = calculateDistance(
        latitude,
        longitude,
        parseFloat(place.latitude),
        parseFloat(place.longitude)
      );
      return distance <= radiusMeters;
    });

    // Sort by distance (closest first)
    nearbyPlaces.sort((a, b) => {
      const distanceA = calculateDistance(
        latitude,
        longitude,
        parseFloat(a.latitude),
        parseFloat(a.longitude)
      );
      const distanceB = calculateDistance(
        latitude,
        longitude,
        parseFloat(b.latitude),
        parseFloat(b.longitude)
      );
      return distanceA - distanceB;
    });

    // Add distance to each place
    const placesWithDistance = nearbyPlaces.map((place) => ({
      ...place,
      distance: calculateDistance(
        latitude,
        longitude,
        parseFloat(place.latitude),
        parseFloat(place.longitude)
      ),
    }));

    console.log(placesWithDistance);
    return {
      success: true,
      places: placesWithDistance,
      count: placesWithDistance.length,
    };
  } catch (error) {
    console.error("Error fetching nearby places:", error);
    return {
      success: false,
      error: error.message,
      places: [],
    };
  }
}

/**
 * Get all places from the places_sf table
 * @param {Object} options - Optional query options
 * @param {number} options.limit - Maximum number of places to return
 * @param {number} options.offset - Number of places to skip
 * @param {string} options.orderBy - Field to order by (default: 'name')
 * @param {boolean} options.ascending - Whether to sort ascending (default: true)
 * @returns {Promise<Object>} - Result object with places
 */
async function getAllPlaces(options = {}) {
  try {
    if (!supabase) {
      return {
        success: false,
        error: "Database not configured",
        places: [],
      };
    }

    const {
      limit = null,
      offset = 0,
      orderBy = "name",
      ascending = true,
    } = options;

    let query = supabase.from("places_sf").select("*");

    // Apply ordering
    query = query.order(orderBy, { ascending });

    // Apply offset and limit
    if (offset > 0) {
      query = query.range(offset, offset + (limit || 10000) - 1);
    } else if (limit) {
      query = query.limit(limit);
    } else {
      // If no limit specified, set a high limit to get all places
      query = query.limit(10000);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Database query error:", error);
      return {
        success: false,
        error: error.message,
        places: [],
      };
    }

    return {
      success: true,
      places: data || [],
      count: data?.length || 0,
    };
  } catch (error) {
    console.error("Error fetching all places:", error);
    return {
      success: false,
      error: error.message,
      places: [],
    };
  }
}

/**
 * Get live events near a specific location
 * @param {number} latitude - Center latitude
 * @param {number} longitude - Center longitude
 * @param {number} limit - Maximum number of events to return
 * @param {string} currentTime - Current time in ISO format (LA timezone)
 * @param {number} radiusMeters - Search radius in meters (default: 10000)
 * @returns {Promise<Object>} - Result object with events
 */
async function getLiveEventsNearby(
  latitude,
  longitude,
  limit,
  currentTime,
  radiusMeters = 10000
) {
  try {
    if (!supabase) {
      return {
        success: false,
        error: "Database not configured",
        events: [],
      };
    }

    // Convert radius from meters to degrees (approximate)
    const latRadius = radiusMeters / 111000;
    const lngRadius =
      radiusMeters / (111000 * Math.cos((Math.abs(latitude) * Math.PI) / 180));

    // Calculate bounding box coordinates
    const minLat = Math.min(latitude - latRadius, latitude + latRadius);
    const maxLat = Math.max(latitude - latRadius, latitude + latRadius);
    const minLng = Math.min(longitude - lngRadius, longitude + lngRadius);
    const maxLng = Math.max(longitude - lngRadius, longitude + lngRadius);

    console.log(
      `Searching for live events near ${latitude}, ${longitude} within ${radiusMeters}m at ${currentTime}`
    );

    console.log(minLat, maxLat, minLng, maxLng);

    // Query for events that are currently live (started but not ended)
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .gte("latitude", minLat)
      .lte("latitude", maxLat)
      .gte("longitude", minLng)
      .lte("longitude", maxLng)
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .lte("start_time", currentTime) // Event has started
      .gte("end_time", currentTime) // Event hasn't ended
      .order("start_time", { ascending: true });

    console.log(`Returned ${data.length} events from database query`);

    if (error) {
      console.error("Database query error:", error);
      return {
        success: false,
        error: error.message,
        events: [],
      };
    }

    if (!data || data.length === 0) {
      return {
        success: true,
        events: [],
        count: 0,
      };
    }

    // Filter by exact distance using Haversine formula
    const nearbyEvents = data.filter((event) => {
      const distance = calculateDistance(
        latitude,
        longitude,
        parseFloat(event.latitude),
        parseFloat(event.longitude)
      );
      return distance <= radiusMeters;
    });

    // Sort by distance (closest first)
    nearbyEvents.sort((a, b) => {
      const distanceA = calculateDistance(
        latitude,
        longitude,
        parseFloat(a.latitude),
        parseFloat(a.longitude)
      );
      const distanceB = calculateDistance(
        latitude,
        longitude,
        parseFloat(b.latitude),
        parseFloat(b.longitude)
      );
      return distanceA - distanceB;
    });

    // Add distance to each event and limit results
    const eventsWithDistance = nearbyEvents.slice(0, limit).map((event) => ({
      ...event,
      distance: calculateDistance(
        latitude,
        longitude,
        parseFloat(event.latitude),
        parseFloat(event.longitude)
      ),
    }));

    console.log(`Found ${eventsWithDistance.length} live events near location`);
    return {
      success: true,
      events: eventsWithDistance,
      count: eventsWithDistance.length,
    };
  } catch (error) {
    console.error("Error fetching live events nearby:", error);
    return {
      success: false,
      error: error.message,
      events: [],
    };
  }
}

/**
 * Export all events from the events table to a JSON file
 * @param {string} outputPath - Path where to save the JSON file (optional, defaults to 'events_export.json')
 * @returns {Promise<Object>} - Result object with export status
 */
async function exportEventsToJSON(outputPath = "events_export.json") {
  try {
    if (!supabase) {
      return {
        success: false,
        error: "Database not configured",
        exported: 0,
      };
    }

    console.log("🔄 Fetching all events from database...");

    // Get all events from the database
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .order("start_time", { ascending: true });

    if (error) {
      console.error("Database query error:", error);
      return {
        success: false,
        error: error.message,
        exported: 0,
      };
    }

    if (!data || data.length === 0) {
      console.log("No events found in database");
      return {
        success: true,
        exported: 0,
        message: "No events found in database",
      };
    }

    // Create export data with metadata
    const exportData = {
      export_info: {
        timestamp: getCurrentLATime(),
        total_events: data.length,
        export_source: "supabase_events_table",
        description: "Complete export of all events from the events table",
      },
      events: data,
    };

    // Write to JSON file
    const fs = require("fs").promises;
    await fs.writeFile(outputPath, JSON.stringify(exportData, null, 2), "utf8");

    console.log(
      `✅ Successfully exported ${data.length} events to ${outputPath}`
    );

    return {
      success: true,
      exported: data.length,
      file_path: outputPath,
      events: data,
    };
  } catch (error) {
    console.error("Error exporting events to JSON:", error);
    return {
      success: false,
      error: error.message,
      exported: 0,
    };
  }
}

/**
 * Export all events from the events table to a CSV file with event_details column
 * @param {string} outputPath - Path where to save the CSV file (optional, defaults to 'events_export.csv')
 * @returns {Promise<Object>} - Result object with export status
 */
async function exportEventsToCSV(outputPath = "events_export.csv") {
  try {
    if (!supabase) {
      return {
        success: false,
        error: "Database not configured",
        exported: 0,
      };
    }

    console.log("🔄 Fetching all events from database...");

    // Get all events from the database
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .order("start_time", { ascending: true });

    if (error) {
      console.error("Database query error:", error);
      return {
        success: false,
        error: error.message,
        exported: 0,
      };
    }

    if (!data || data.length === 0) {
      console.log("No events found in database");
      return {
        success: true,
        exported: 0,
        message: "No events found in database",
      };
    }

    // Create CSV content
    let csvContent = "event_details\n";

    // Add each event as a JSON string in the event_details column
    data.forEach((event) => {
      // Escape quotes and newlines in the JSON string for CSV
      const eventJson = JSON.stringify(event).replace(/"/g, '""');
      csvContent += `"${eventJson}"\n`;
    });

    // Write to CSV file
    const fs = require("fs").promises;
    await fs.writeFile(outputPath, csvContent, "utf8");

    console.log(
      `✅ Successfully exported ${data.length} events to ${outputPath}`
    );

    return {
      success: true,
      exported: data.length,
      file_path: outputPath,
      events: data,
    };
  } catch (error) {
    console.error("Error exporting events to CSV:", error);
    return {
      success: false,
      error: error.message,
      exported: 0,
    };
  }
}

/**
 * Save enhanced events to the main event table
 * @param {Array} events - Array of enhanced event objects
 * @returns {Promise<Object>} - Result object with success status and data
 */
async function saveEnhancedEventsToEventTable(events) {
  try {
    if (!supabase) {
      console.warn(
        "Supabase client not initialized. Skipping enhanced event save."
      );
      return {
        success: false,
        error: "Database not configured",
        saved: 0,
        events: [],
      };
    }

    if (!events || events.length === 0) {
      return {
        success: true,
        saved: 0,
        events: [],
      };
    }

    console.log(
      `💾 Saving ${events.length} enhanced events to main event table...`
    );

    const savedEvents = [];
    const failedEvents = [];
    let savedCount = 0;
    let duplicateCount = 0;

    for (const event of events) {
      try {
        const { data, error } = await supabase
          .from("events")
          .insert([event])
          .select();

        if (error) {
          // Check if it's a duplicate key error
          if (error.code === "23505") {
            console.log(
              `Skipping duplicate enhanced event: ${event.title} at ${event.start_time}`
            );
            duplicateCount++;
            failedEvents.push({ event, error: "duplicate" });
          } else {
            console.error(
              `Failed to save enhanced event "${event.title}":`,
              error
            );
            failedEvents.push({ event, error: error.message });
          }
        } else {
          savedEvents.push(data[0]);
          savedCount++;
        }
      } catch (err) {
        console.error(`Error saving enhanced event "${event.title}":`, err);
        failedEvents.push({ event, error: err.message });
      }
    }

    console.log(
      `Successfully saved ${savedCount} enhanced events to main event table (${duplicateCount} duplicates skipped, ${
        failedEvents.length - duplicateCount
      } other failures)`
    );

    return {
      success: true,
      saved: savedCount,
      events: savedEvents,
      duplicates: duplicateCount,
      failures: failedEvents.length - duplicateCount,
      failedEvents: failedEvents,
    };
  } catch (error) {
    console.error("Error saving enhanced events to main event table:", error);
    return {
      success: false,
      error: error.message,
      saved: 0,
      events: [],
    };
  }
}

/**
 * Get events from database for a date range (in LA time)
 * @param {string} startDate - Start date in YYYY-MM-DD format (LA time)
 * @param {string} endDate - End date in YYYY-MM-DD format (LA time)
 * @returns {Promise<Object>} - Result object with events
 */
async function getEventsForDateRange(startDate, endDate) {
  try {
    if (!supabase) {
      return {
        success: false,
        error: "Database not configured",
        events: [],
      };
    }

    // Create LA time range for the given dates
    const startOfRange = `${startDate}T00:00:00`;
    const endOfRange = `${endDate}T23:59:59`;

    console.log(
      `🔍 Querying events from ${startOfRange} to ${endOfRange} (LA time)`
    );

    const { data, error } = await supabase
      .from("events")
      .select("*")
      .gte("start_time", startOfRange)
      .lte("start_time", endOfRange)
      .order("start_time", { ascending: true });

    if (error) {
      console.error("Database query error:", error);
      return {
        success: false,
        error: error.message,
        events: [],
      };
    }

    return {
      success: true,
      events: data || [],
      count: data?.length || 0,
    };
  } catch (error) {
    console.error("Error fetching events from database:", error);
    return {
      success: false,
      error: error.message,
      events: [],
    };
  }
}

/**
 * Export events for today to 7 days ahead and upload to Google Cloud Storage
 * @returns {Promise<Object>} - Result object with export status
 */
async function exportEventsToGCS() {
  try {
    if (!supabase) {
      return {
        success: false,
        error: "Database not configured",
        exported: 0,
      };
    }

    if (!gcsClient) {
      return {
        success: false,
        error: "Google Cloud Storage client not configured",
        exported: 0,
      };
    }

    console.log("🔄 Starting Google Cloud Storage export process...");

    // Get current date in California timezone
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    const parts = formatter.formatToParts(now);
    const year = parseInt(parts.find((p) => p.type === "year").value);
    const month = parseInt(parts.find((p) => p.type === "month").value) - 1; // 0-indexed
    const day = parseInt(parts.find((p) => p.type === "day").value);

    // Create start date (today in California)
    const startDateObj = new Date(year, month, day);
    const startDate = startDateObj.toLocaleDateString("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    // Create end date (7 days from today in California)
    const endDateObj = new Date(startDateObj);
    endDateObj.setDate(endDateObj.getDate() + 7);
    const endDate = endDateObj.toLocaleDateString("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    console.log(
      `📅 Exporting events from ${startDate} to ${endDate} (California time)`
    );

    // Get events from database for the date range
    const result = await getEventsForDateRange(startDate, endDate);

    if (!result.success) {
      console.error("Failed to fetch events:", result.error);
      return {
        success: false,
        error: result.error,
        exported: 0,
      };
    }

    if (!result.events || result.events.length === 0) {
      console.log("No events found for the date range");
      return {
        success: true,
        exported: 0,
        message: "No events found for the date range",
        gcsUrl: null,
      };
    }

    // Filter events to only include public-safe fields
    const filteredEvents = result.events.map((event) => ({
      title: event.title,
      description: event.description,
      cost: event.cost,
      emoji: event.emoji,
      venue: event.venue,
      address: event.address,
      start_time: event.start_time,
      end_time: event.end_time,
      latitude: event.latitude,
      longitude: event.longitude,
      event_urls: event.event_urls,
    }));

    // Create export data with metadata
    const exportData = {
      export_info: {
        timestamp: getCurrentLATime(),
        date_range: {
          start: startDate,
          end: endDate,
        },
        total_events: filteredEvents.length,
        export_source: "supabase_events_table",
        description: "Events from today to 7 days ahead (California time)",
      },
      events: filteredEvents,
    };

    // Convert to JSON
    const jsonData = JSON.stringify(exportData, null, 2);

    // Upload to Google Cloud Storage
    const bucketName = process.env.GCS_BUCKET_NAME;
    const fileName = process.env.GCS_FILE_NAME || "events/weekly-events.json";

    if (!bucketName) {
      return {
        success: false,
        error: "GCS_BUCKET_NAME environment variable not set",
        exported: 0,
      };
    }

    console.log(`⬆️  Uploading to GCS: gs://${bucketName}/${fileName}`);

    // Get bucket and file reference
    const bucket = gcsClient.bucket(bucketName);
    const file = bucket.file(fileName);

    // Upload file
    await file.save(jsonData, {
      contentType: "application/json",
      metadata: {
        cacheControl: "public, max-age=0, must-revalidate", // Always check for fresh version
      },
    });

    // Make file public (works with uniform bucket-level access)
    try {
      await file.makePublic();
      console.log("✅ File made public");
    } catch (publicError) {
      console.warn(
        "⚠️  Could not make file public automatically:",
        publicError.message
      );
      console.warn(
        "   Make sure to grant 'Storage Object Viewer' role to 'allUsers' on your bucket"
      );
    }

    // Construct public URL
    const gcsUrl = `https://storage.googleapis.com/${bucketName}/${fileName}`;

    console.log(
      `✅ Successfully exported ${filteredEvents.length} events to GCS: ${gcsUrl}`
    );

    return {
      success: true,
      exported: filteredEvents.length,
      gcsUrl: gcsUrl,
      gcsBucket: bucketName,
      gcsFileName: fileName,
      dateRange: {
        start: startDate,
        end: endDate,
      },
      events: filteredEvents,
    };
  } catch (error) {
    console.error("Error exporting events to Google Cloud Storage:", error);
    return {
      success: false,
      error: error.message,
      exported: 0,
    };
  }
}

// Keep S3 name for backward compatibility
const exportEventsToS3 = exportEventsToGCS;

module.exports = {
  saveEventsToDatabase,
  saveEventsToTable,
  saveEnhancedEventsToEventTable,
  getEventsFromDatabase,
  eventsExistForDate,
  deleteEventsForDate,
  mapEventToDatabase,
  geocodeAddress,
  getNearbyPlaces,
  calculateDistance,
  getAllPlaces,
  getLiveEventsNearby,
  exportEventsToJSON,
  exportEventsToCSV,
  getEventsForDateRange,
  exportEventsToGCS,
  exportEventsToS3, // Alias for backward compatibility
};
