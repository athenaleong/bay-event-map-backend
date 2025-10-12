require('dotenv').config();
const fs = require('fs');
const csv = require('csv-parser');
const { createClient } = require('@supabase/supabase-js');
const { generateEmojisForEvents } = require('./emojiGenerator');

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
 * @returns {string} - LA time in ISO format with timezone
 */
function convertToLATime(utcTime) {
  if (!utcTime) return null;

  const date = new Date(utcTime);

  // Use toLocaleString with sv-SE locale to get ISO format in LA timezone
  // This gives us the time in LA timezone in ISO format (YYYY-MM-DD HH:mm:ss)
  const laTimeString = date.toLocaleString("sv-SE", {
    timeZone: "America/Los_Angeles",
  });

  // Convert to ISO format with timezone
  // We'll append the timezone offset for LA time
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
  const laDate = new Date(
    date.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
  );
  const utcDate = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));

  // Calculate the timezone offset
  const offsetMs = laDate.getTime() - utcDate.getTime();
  const offsetHours = Math.round(offsetMs / (1000 * 60 * 60));

  // Format offset as ±HH:MM
  const offsetSign = offsetHours >= 0 ? "+" : "-";
  const absOffsetHours = Math.abs(offsetHours);
  const offsetString = `${offsetSign}${absOffsetHours
    .toString()
    .padStart(2, "0")}:00`;

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
 * Parse CSV date and time into proper datetime format
 * @param {string} date - Date in MM/DD/YYYY format
 * @param {string} time - Time in HH:MM:SS AM/PM format
 * @returns {string} - Combined datetime in ISO format
 */
function parseDateTime(date, time) {
  if (!date || !time) return null;
  
  try {
    // Parse the date (MM/DD/YYYY)
    const [month, day, year] = date.split('/');
    
    // Parse the time (HH:MM:SS AM/PM)
    const [timePart, period] = time.split(' ');
    const [hours, minutes, seconds] = timePart.split(':');
    
    let hour24 = parseInt(hours);
    if (period === 'PM' && hour24 !== 12) {
      hour24 += 12;
    } else if (period === 'AM' && hour24 === 12) {
      hour24 = 0;
    }
    
    // Create a date object in LA timezone
    const dateObj = new Date(year, month - 1, day, hour24, parseInt(minutes), parseInt(seconds || 0));
    
    return convertToLATime(dateObj);
  } catch (error) {
    console.error(`Error parsing date/time: ${date} ${time}`, error);
    return null;
  }
}

/**
 * Map CSV event data to database schema
 * @param {Object} csvEvent - The CSV event object
 * @returns {Object} - Database-ready event object
 */
function mapCSVEventToDatabase(csvEvent) {
  const startTime = parseDateTime(csvEvent.Date, csvEvent['Start Time']);
  const endTime = parseDateTime(csvEvent.Date, csvEvent['End Time']);
  
  return {
    title: csvEvent['Event Name'] || "",
    description: csvEvent.Description || null,
    url: csvEvent.Link || null,
    start_time: startTime,
    end_time: endTime,
    location: csvEvent.Location || null,
    cost: csvEvent.Cost || null,
    image: null, // CSV doesn't have image data
    categories: csvEvent.Type ? [csvEvent.Type] : [],
    source: "decentered_arts",
    venue: csvEvent.Location || null,
    address: csvEvent.Address || null,
    currency: null,
    social_links: null,
    sources: null,
    time_info: null,
    cost_info: null,
    location_info: null,
    scraped_at: getCurrentLATime(),
    has_detailed_info: false,
    latitude: null,
    longitude: null,
    emoji: null, // Will be generated later
  };
}

/**
 * Read and parse CSV file
 * @param {string} filePath - Path to the CSV file
 * @returns {Promise<Array>} - Array of parsed events
 */
function readCSVFile(filePath) {
  return new Promise((resolve, reject) => {
    const events = [];
    let rowCount = 0;
    let headerSkipped = false;
    
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        rowCount++;
        
        // Skip the first few informational rows and find the actual header
        if (!headerSkipped) {
          // Look for the row that contains "Date,Event Name,Type,Start Time,End Time,Location,Address,Description,Cost,Link,Tracked By"
          if (row['Date'] && row['Event Name'] && row['Type']) {
            headerSkipped = true;
            console.log(`Found header at row ${rowCount}`);
            return; // Skip the header row itself
          } else {
            console.log(`Skipping informational row ${rowCount}`);
            return;
          }
        }
        
        // Now process actual event data
        if (row['Event Name'] && row['Event Name'].trim() !== '') {
          events.push(row);
          if (events.length <= 5) {
            console.log(`Added event ${events.length}: ${row['Event Name']}`);
          }
        }
      })
      .on('end', () => {
        console.log(`Parsed ${events.length} events from ${rowCount} total rows in CSV`);
        resolve(events);
      })
      .on('error', (error) => {
        reject(error);
      });
  });
}

/**
 * Save events to the events_aggre_2 table
 * @param {Array} events - Array of event objects
 * @returns {Promise<Object>} - Result object with success status and data
 */
async function saveEventsToAggre2(events) {
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

    // Insert events one by one to handle duplicates gracefully
    const savedEvents = [];
    const failedEvents = [];
    let savedCount = 0;
    let duplicateCount = 0;

    for (const event of events) {
      try {
        const { data, error } = await supabase
          .from("events_aggre_2")
          .insert([event])
          .select();

        if (error) {
          // Check if it's a duplicate key error
          if (error.code === "23505") {
            console.log(
              `Skipping duplicate event: ${event.title} at ${event.start_time}`
            );
            duplicateCount++;
            failedEvents.push({ event, error: "duplicate" });
          } else {
            console.error(`Failed to save event "${event.title}":`, error);
            failedEvents.push({ event, error: error.message });
          }
        } else {
          savedEvents.push(data[0]);
          savedCount++;
        }
      } catch (err) {
        console.error(`Error saving event "${event.title}":`, err);
        failedEvents.push({ event, error: err.message });
      }
    }

    console.log(
      `Successfully saved ${savedCount} events to events_aggre_2 table (${duplicateCount} duplicates skipped, ${
        failedEvents.length - duplicateCount
      } other failures)`
    );

    return {
      success: true, // Still return success even if some events failed
      saved: savedCount,
      events: savedEvents,
      duplicates: duplicateCount,
      failures: failedEvents.length - duplicateCount,
      failedEvents: failedEvents,
    };
  } catch (error) {
    console.error("Error saving events to events_aggre_2:", error);
    return {
      success: false,
      error: error.message,
      saved: 0,
      events: [],
    };
  }
}

/**
 * Main function to process and upload events
 */
async function main() {
  try {
    console.log("Starting event upload process...");
    
    // Read CSV file
    console.log("Reading event-list.csv...");
    const csvEvents = await readCSVFile('./event-list.csv');
    
    if (csvEvents.length === 0) {
      console.log("No events found in CSV file");
      return;
    }
    
    // Map CSV events to database format
    console.log("Mapping events to database format...");
    const dbEvents = csvEvents.map(mapCSVEventToDatabase);
    
    // Generate emojis for events
    console.log("Generating emojis for events...");
    const eventsWithEmojis = await generateEmojisForEvents(dbEvents, 200); // 200ms delay between API calls
    
    console.log(`Generated emojis for ${eventsWithEmojis.length} events`);
    
    // Save to database
    console.log("Saving events to events_aggre_2 table...");
    const result = await saveEventsToAggre2(eventsWithEmojis);
    
    if (result.success) {
      console.log(`✅ Successfully processed ${result.saved} events`);
      if (result.duplicates > 0) {
        console.log(`⚠️  Skipped ${result.duplicates} duplicate events`);
      }
      if (result.failures > 0) {
        console.log(`❌ Failed to save ${result.failures} events`);
      }
    } else {
      console.error("❌ Failed to save events:", result.error);
    }
    
  } catch (error) {
    console.error("Error in main process:", error);
  }
}

// Run the main function if this script is executed directly
if (require.main === module) {
  main();
}

module.exports = {
  readCSVFile,
  mapCSVEventToDatabase,
  saveEventsToAggre2,
  parseDateTime,
};
