const { createClient } = require("@supabase/supabase-js");

// Initialize Supabase client
let supabase = null;

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
 * @returns {string} - LA time in ISO format
 */
function convertToLATime(utcTime) {
  if (!utcTime) return null;

  const date = new Date(utcTime);
  // Convert to LA time using Intl.DateTimeFormat
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

  // Reconstruct ISO format for LA time
  const year = laTime.find((part) => part.type === "year").value;
  const month = laTime.find((part) => part.type === "month").value;
  const day = laTime.find((part) => part.type === "day").value;
  const hour = laTime.find((part) => part.type === "hour").value;
  const minute = laTime.find((part) => part.type === "minute").value;
  const second = laTime.find((part) => part.type === "second").value;

  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

/**
 * Get current LA time
 * @returns {string} - Current LA time in ISO format
 */
function getCurrentLATime() {
  return convertToLATime(new Date());
}

/**
 * Map scraped event data to database schema
 * @param {Object} event - The scraped event object
 * @returns {Object} - Database-ready event object
 */
function mapEventToDatabase(event) {
  return {
    title: event.title || "",
    description: event.description || null,
    url: event.url || null,
    start_time: convertToLATime(event.startTime),
    end_time: convertToLATime(event.endTime),
    location: event.location || null,
    cost: event.cost || null,
    image: event.image || null,
    categories: event.categories || [],
    source: event.source || "funcheap",
    venue: event.venue || null,
    address: event.address || null,
    currency: event.currency || null,
    social_links: event.socialLinks || null,
    sources: event.sources || null,
    time_info: event.timeInfo || null,
    cost_info: event.costInfo || null,
    location_info: event.locationInfo || null,
    scraped_at: getCurrentLATime(),
    has_detailed_info: event.hasDetailedInfo || false,
    latitude: event.latitude || null,
    longitude: event.longitude || null,
    emoji: event.emoji || null,
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

    // Map events to database schema
    const dbEvents = events.map(mapEventToDatabase);

    // Insert events into the database
    const { data, error } = await supabase
      .from("events")
      .insert(dbEvents)
      .select();

    if (error) {
      console.error("Database error:", error);
      return {
        success: false,
        error: error.message,
        saved: 0,
        events: [],
      };
    }

    console.log(`Successfully saved ${data.length} events to database`);
    return {
      success: true,
      saved: data.length,
      events: data,
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
async function eventsExistForDate(date) {
  try {
    if (!supabase) {
      return false;
    }

    // Create LA time range for the given date
    const startOfDay = `${date}T00:00:00`;
    const endOfDay = `${date}T23:59:59`;

    const { data, error } = await supabase
      .from("events")
      .select("id")
      .gte("start_time", startOfDay)
      .lte("start_time", endOfDay)
      .limit(1);

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

module.exports = {
  saveEventsToDatabase,
  getEventsFromDatabase,
  eventsExistForDate,
  deleteEventsForDate,
  mapEventToDatabase,
  getNearbyPlaces,
  calculateDistance,
  getAllPlaces,
};
