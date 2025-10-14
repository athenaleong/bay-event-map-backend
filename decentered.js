const axios = require("axios");
const csv = require("csv-parser");
const { Readable } = require("stream");
const OpenAI = require("openai");
const {
  geocodeAddress,
  saveEnhancedEventsToEventTable,
  eventsExistForDate,
} = require("./database");

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Google Sheets CSV URL
const DECENTERED_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1eX21lRIMOl3LLUhanRptk0jWbKoyZJVnbsJ-UWP7JZY/export?format=csv&gid=0";

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
 * Parse date and time strings to create a proper datetime (already in LA time)
 * @param {string} dateStr - Date string in MM/DD/YYYY format (e.g., "01/15/2024")
 * @param {string} timeStr - Time string (e.g., "19:00" or "7:00 PM")
 * @returns {Date|null} - Parsed date object or null if invalid
 */
function parseDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;

  try {
    // Handle different time formats
    let time = timeStr.trim();

    // Convert 12-hour format to 24-hour format if needed
    if (time.includes("AM") || time.includes("PM")) {
      const [timePart, period] = time.split(/(AM|PM)/i);
      const [hours, minutes] = timePart.split(":").map(Number);

      let hour24 = hours;
      if (period.toUpperCase() === "PM" && hours !== 12) {
        hour24 = hours + 12;
      } else if (period.toUpperCase() === "AM" && hours === 12) {
        hour24 = 0;
      }

      time = `${hour24.toString().padStart(2, "0")}:${minutes
        .toString()
        .padStart(2, "0")}`;
    }

    // Parse the date string (MM/DD/YYYY format)
    const [month, day, year] = dateStr.split("/").map(Number);
    if (!month || !day || !year) {
      console.warn(`Invalid date format: ${dateStr}`);
      return null;
    }

    // Create datetime string (already in LA time)
    const datetimeStr = `${year}-${month.toString().padStart(2, "0")}-${day
      .toString()
      .padStart(2, "0")}T${time}:00`;

    // Since the time is already in LA time, we can parse it directly
    const date = new Date(datetimeStr);

    if (isNaN(date.getTime())) {
      console.warn(`Invalid datetime: ${datetimeStr}`);
      return null;
    }

    // The date is already in LA time, so we can return it as-is
    return date;
  } catch (error) {
    console.warn(`Error parsing datetime: ${dateStr} ${timeStr}`, error);
    return null;
  }
}

/**
 * Fetch and parse CSV data from Google Sheets
 * @returns {Promise<Array>} - Array of parsed event objects
 */
async function fetchDecenteredCSV() {
  try {
    console.log("📥 Fetching Decentered Arts CSV data...");

    const response = await axios.get(DECENTERED_CSV_URL, {
      timeout: 30000, // 30 second timeout
    });

    if (!response.data) {
      throw new Error("No data received from CSV URL");
    }

    console.log("📋 Parsing CSV data...");

    // Split the CSV into lines and process manually
    const lines = response.data.split("\n");
    const results = [];
    let headerRowIndex = -1;
    let headerColumns = [];

    // Find the header row (should be around line 7 based on the CSV structure)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (
        line.includes(
          "Date,Event Name,Type,Start Time,End Time,Location,Address,Description,Cost,Link,Tracked By"
        )
      ) {
        headerRowIndex = i;
        headerColumns = line
          .split(",")
          .map((col) => col.trim().replace(/"/g, ""));
        console.log("📋 Found CSV header row at line", i + 1);
        break;
      }
    }

    if (headerRowIndex === -1) {
      throw new Error("Could not find CSV header row");
    }

    // Process data rows starting from the line after the header
    for (let i = headerRowIndex + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue; // Skip empty lines

      // Parse CSV line (handle quoted fields)
      const fields = parseCSVLine(line);

      if (fields.length >= headerColumns.length) {
        const row = {};
        headerColumns.forEach((header, index) => {
          row[header] = fields[index] || "";
        });

        // Check if this row has the required data
        if (
          row.Date &&
          row["Event Name"] &&
          row.Date.trim() !== "" &&
          row["Event Name"].trim() !== ""
        ) {
          // Skip rows that look like headers or metadata
          if (row.Date !== "Date" && row["Event Name"] !== "Event Name") {
            results.push(row);
          }
        }
      }
    }

    console.log(`✅ Parsed ${results.length} events from CSV`);
    return results;
  } catch (error) {
    console.error("Error fetching Decentered CSV:", error);
    throw error;
  }
}

/**
 * Parse a CSV line handling quoted fields
 * @param {string} line - CSV line to parse
 * @returns {Array} - Array of field values
 */
function parseCSVLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  fields.push(current.trim());
  return fields;
}

/**
 * Filter events by date
 * @param {Array} events - Array of event objects
 * @param {string} targetDate - Target date in YYYY-MM-DD format
 * @returns {Array} - Filtered events for the target date
 */
function filterEventsByDate(events, targetDate) {
  return events.filter((event) => {
    if (!event.Date) return false;

    try {
      // Parse the event date (MM/DD/YYYY format)
      const [month, day, year] = event.Date.split("/").map(Number);
      if (!month || !day || !year) return false;

      // Format as YYYY-MM-DD for comparison
      const eventDateStr = `${year}-${month.toString().padStart(2, "0")}-${day
        .toString()
        .padStart(2, "0")}`;
      return eventDateStr === targetDate;
    } catch (error) {
      console.warn(`Error parsing event date: ${event.Date}`, error);
      return false;
    }
  });
}

/**
 * Map CSV event data to database schema
 * @param {Object} csvEvent - The CSV event object
 * @returns {Promise<Object>} - Database-ready event object
 */
async function mapDecenteredEventToDatabase(csvEvent) {
  const startTime = parseDateTime(csvEvent.Date, csvEvent["Start Time"]);
  const endTime = parseDateTime(csvEvent.Date, csvEvent["End Time"]);

  // Determine the address to geocode
  let addressToGeocode = null;
  if (csvEvent.Address && csvEvent.Address.trim() !== "") {
    addressToGeocode = csvEvent.Address;
  } else if (csvEvent.Location && csvEvent.Location.trim() !== "") {
    addressToGeocode = csvEvent.Location;
  }

  // Geocode the address if available
  let coordinates = null;
  if (addressToGeocode) {
    coordinates = await geocodeAddress(addressToGeocode);
  }

  return {
    title: csvEvent["Event Name"] || "",
    description: csvEvent.Description || null,
    url: csvEvent.Link || null,
    start_time: startTime ? convertToLATime(startTime) : null,
    end_time: endTime ? convertToLATime(endTime) : null,
    cost: csvEvent.Cost || null,
    image: null, // CSV doesn't have image data
    categories: csvEvent.Type ? [csvEvent.Type] : [],
    source: "decentered_arts",
    venue: csvEvent.Location || null,
    address: csvEvent.Address || null,
    social_links: null,
    event_button_urls: null,
    scraped_at: getCurrentLATime(),
    latitude: coordinates ? coordinates.latitude : null,
    longitude: coordinates ? coordinates.longitude : null,
    emoji: null,
    event_type: "standalone",
    event_source: "decentered_arts",
  };
}

/**
 * Save decentered events to the database
 * @param {Array} events - Array of event objects
 * @returns {Promise<Object>} - Result object with success status and data
 */
async function saveDecenteredEventsToDatabase(events) {
  const { createClient } = require("@supabase/supabase-js");

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.warn("Supabase client not initialized. Skipping database save.");
    return {
      success: false,
      error: "Database not configured",
      saved: 0,
      events: [],
    };
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  if (!events || events.length === 0) {
    return {
      success: true,
      saved: 0,
      events: [],
    };
  }

  console.log(`💾 Saving ${events.length} decentered events to database...`);

  const savedEvents = [];
  const failedEvents = [];
  let savedCount = 0;
  let duplicateCount = 0;

  for (const event of events) {
    try {
      const { data, error } = await supabase
        .from("decentered-event")
        .insert([event])
        .select();

      if (error) {
        // Check if it's a duplicate key error
        if (error.code === "23505") {
          console.log(
            `Skipping duplicate decentered event: ${event.title} at ${event.start_time}`
          );
          duplicateCount++;
          failedEvents.push({ event, error: "duplicate" });
        } else {
          console.error(
            `Failed to save decentered event "${event.title}":`,
            error
          );
          failedEvents.push({ event, error: error.message });
        }
      } else {
        savedEvents.push(data[0]);
        savedCount++;
      }
    } catch (err) {
      console.error(`Error saving decentered event "${event.title}":`, err);
      failedEvents.push({ event, error: err.message });
    }
  }

  console.log(
    `Successfully saved ${savedCount} decentered events to database (${duplicateCount} duplicates skipped, ${
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
}

/**
 * Generate human-friendly event copy using OpenAI for decentered events
 * @param {Object} event - Event object to enhance
 * @returns {Promise<Object>} - Enhanced event object with human-friendly copy
 */
const generateDecenteredHumanFriendlyEventCopy = async (event) => {
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
          `Failed to parse OpenAI response for decentered event "${event.title}":`,
          parseError
        );
      }
    }

    // Fallback to original event data if enhancement fails
    console.warn(
      `Failed to generate human-friendly copy for decentered event "${event.title}", using original data`
    );
    return {
      title: event.title,
      description: event.description,
      cost: event.cost,
      rsvp_ticket_required: false,
      emoji: event.emoji || "🎨",
    };
  } catch (error) {
    console.error(
      `Error generating human-friendly copy for decentered event "${event.title}":`,
      error
    );
    // Fallback to original event data if enhancement fails
    return {
      title: event.title,
      description: event.description,
      cost: event.cost,
      rsvp_ticket_required: false,
      emoji: event.emoji || "🎨",
    };
  }
};

/**
 * Scrape and save Decentered Arts events with the new processing pipeline
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} - Result object with success status and data
 */
const scrapeAndSaveDecenteredEvents = async (date, options = {}) => {
  const { progressPrefix = "" } = options;

  console.log(
    `${progressPrefix}🚀 Scraping and saving Decentered Arts events for ${date}...`
  );

  try {
    console.log("checking if events already exists")
    // Step 0: Check if events already exist in the database for this date
    const eventsAlreadyExist = await eventsExistForDate(
      "decentered-event",
      date
    );
    if (eventsAlreadyExist) {
      console.log(
        `${progressPrefix}📋 Decentered Arts events already exist for ${date}, skipping scraping...`
      );
      return {
        success: true,
        events: [],
        count: 0,
        message: `Decentered Arts events already exist for ${date}`,
        saved: 0,
        enhanced: 0,
        detailRequestsUsed: 0,
        emojisGenerated: 0,
        cached: true,
      };
    }

    // Step 1: Fetch CSV data from Google Sheets
    const csvEvents = await fetchDecenteredCSV();

    // Step 2: Filter events by date
    const eventsForDate = filterEventsByDate(csvEvents, date);
    console.log(
      `${progressPrefix}📅 Found ${eventsForDate.length} events for ${date}`
    );

    if (eventsForDate.length === 0) {
      return {
        success: true,
        events: [],
        count: 0,
        message: "No Decentered Arts events found for this date",
        saved: 0,
        enhanced: 0,
        detailRequestsUsed: 0,
        emojisGenerated: 0,
      };
    }

    // Step 3: Map events to database schema with geocoding
    console.log(
      `${progressPrefix}🗺️  Mapping and geocoding ${eventsForDate.length} events...`
    );
    const dbEvents = await Promise.all(
      eventsForDate.map(mapDecenteredEventToDatabase)
    );

    // Filter out events without addresses (as requested)
    const eventsWithAddresses = dbEvents.filter(
      (event) => event.address && event.address.trim() !== ""
    );
    console.log(
      `${progressPrefix}📍 ${eventsWithAddresses.length} events have addresses and will be saved`
    );

    if (eventsWithAddresses.length === 0) {
      return {
        success: true,
        events: [],
        count: 0,
        message: "No Decentered Arts events with addresses found for this date",
        saved: 0,
        enhanced: 0,
        detailRequestsUsed: 0,
        emojisGenerated: 0,
      };
    }

    // Step 4: Save events to decentered-event table
    console.log(
      `${progressPrefix}💾 Saving ${eventsWithAddresses.length} events to decentered-event table...`
    );
    const saveResult = await saveDecenteredEventsToDatabase(
      eventsWithAddresses
    );

    if (!saveResult.success) {
      console.error(
        `${progressPrefix}Failed to save decentered events to database:`,
        saveResult.error
      );
      return {
        success: false,
        events: eventsWithAddresses,
        count: eventsWithAddresses.length,
        saved: 0,
        saveError: saveResult.error,
        message: "Events scraped but failed to save to database",
        detailRequestsUsed: 0,
        emojisGenerated: 0,
      };
    }

    // Step 5: Generate human-friendly copies for all events
    console.log(
      `${progressPrefix}✨ Generating human-friendly copies for ${eventsWithAddresses.length} events...`
    );

    const enhancedEvents = [];
    for (let i = 0; i < eventsWithAddresses.length; i++) {
      const event = eventsWithAddresses[i];
      console.log(
        `${progressPrefix}  Enhancing event ${i + 1}/${
          eventsWithAddresses.length
        }: ${event.title}`
      );

      try {
        const enhancedCopy = await generateDecenteredHumanFriendlyEventCopy(
          event
        );

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
          start_time: event.start_time,
          end_time: event.end_time,
          url: event.url,
          latitude: event.latitude,
          longitude: event.longitude,
          event_urls: [event.url],
          event_type: event.event_type,
          event_source: "decentered",

          // Additional metadata
          categories: event.categories,
          image: event.image,
          social_links: event.social_links,
          scraped_at: new Date().toISOString(),
        };

        enhancedEvents.push(combinedEvent);

        // Add a small delay to avoid rate limiting
        if (i < eventsWithAddresses.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      } catch (error) {
        console.error(
          `Error enhancing decentered event "${event.title}":`,
          error
        );
        // Continue with other events even if one fails
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
      `${progressPrefix}✅ Successfully processed ${date}: scraped ${eventsWithAddresses.length}, saved ${totalSaved} total events`
    );

    return {
      success: true,
      events: [...saveResult.events, ...enhancedSaveResult.events],
      count: totalSaved,
      enhanced: true,
      detailRequestsUsed: 0,
      emojisGenerated: enhancedEvents.length,
      saved: totalSaved,
      message: `Successfully scraped and saved ${totalSaved} Decentered Arts events (${saveResult.saved} to decentered-event table, ${enhancedSaveResult.saved} to main event table)`,
      breakdown: {
        decenteredEvents: saveResult.saved,
        enhancedEvents: enhancedSaveResult.saved,
      },
    };
  } catch (error) {
    console.error(
      `${progressPrefix}Error in scrapeAndSaveDecenteredEvents:`,
      error
    );
    return {
      success: false,
      error: error.message,
      events: [],
      count: 0,
      saved: 0,
      message: "Failed to scrape Decentered Arts events",
    };
  }
};

module.exports = {
  scrapeAndSaveDecenteredEvents,
  fetchDecenteredCSV,
  filterEventsByDate,
  mapDecenteredEventToDatabase,
  saveDecenteredEventsToDatabase,
  generateDecenteredHumanFriendlyEventCopy,
};
