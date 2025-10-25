const OpenAI = require("openai");
const { EnhancedFuncheapScraper } = require("./enhancedFuncheapScraper");
const {
  saveEventsToDatabase,
  saveEnhancedEventsToEventTable,
} = require("./database");

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
 * Classify multiple events in parallel batches
 * @param {Array} events - Array of event objects to classify
 * @param {number} batchSize - Number of events to process in parallel (default: 10)
 * @param {string} progressPrefix - Prefix for progress logging
 * @returns {Promise<Array>} - Array of events with classification added
 */
const classifyEventsInBatches = async (
  events,
  batchSize = 10,
  progressPrefix = ""
) => {
  const eventsWithClassification = [];

  for (let i = 0; i < events.length; i += batchSize) {
    const batch = events.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(events.length / batchSize);

    console.log(
      `${progressPrefix}  Classifying batch ${batchNumber}/${totalBatches} (${batch.length} events)...`
    );

    // Process batch in parallel
    const batchPromises = batch.map(async (event, index) => {
      const globalIndex = i + index + 1;
      console.log(
        `${progressPrefix}    Classifying event ${globalIndex}/${events.length}: ${event.title}`
      );

      const eventType = await classifyEvent(event);
      return {
        ...event,
        event_type: eventType,
      };
    });

    try {
      const batchResults = await Promise.all(batchPromises);
      eventsWithClassification.push(...batchResults);

      // Add a small delay between batches to avoid rate limiting
      if (i + batchSize < events.length) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } catch (error) {
      console.error(
        `${progressPrefix}  Error processing batch ${batchNumber}:`,
        error
      );
      // Add events with fallback classification
      batch.forEach((event) => {
        eventsWithClassification.push({
          ...event,
          event_type: "standalone", // fallback
        });
      });
    }
  }

  return eventsWithClassification;
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

/**
 * Enhance multiple events in parallel batches
 * @param {Array} events - Array of event objects to enhance
 * @param {number} batchSize - Number of events to process in parallel (default: 10)
 * @param {string} progressPrefix - Prefix for progress logging
 * @returns {Promise<Array>} - Array of enhanced events
 */
const enhanceEventsInBatches = async (
  events,
  batchSize = 10,
  progressPrefix = ""
) => {
  const enhancedEvents = [];

  for (let i = 0; i < events.length; i += batchSize) {
    const batch = events.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(events.length / batchSize);

    console.log(
      `${progressPrefix}  Enhancing batch ${batchNumber}/${totalBatches} (${batch.length} events)...`
    );

    // Process batch in parallel
    const batchPromises = batch.map(async (event, index) => {
      const globalIndex = i + index + 1;
      console.log(
        `${progressPrefix}    Enhancing event ${globalIndex}/${events.length}: ${event.title}`
      );

      try {
        const enhancedCopy = await generateHumanFriendlyEventCopy(event);

        // Combine original event data with enhanced copy
        return {
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
      } catch (error) {
        console.error(`Error enhancing event "${event.title}":`, error);
        // Return null for failed enhancements, we'll filter them out
        return null;
      }
    });

    try {
      const batchResults = await Promise.all(batchPromises);
      // Filter out null results (failed enhancements)
      const validResults = batchResults.filter((result) => result !== null);
      enhancedEvents.push(...validResults);

      // Add a small delay between batches to avoid rate limiting
      if (i + batchSize < events.length) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    } catch (error) {
      console.error(
        `${progressPrefix}  Error processing enhancement batch ${batchNumber}:`,
        error
      );
      // Continue with other batches even if one fails
    }
  }

  return enhancedEvents;
};

/**
 * Scrape and save Funcheap events with the new processing pipeline
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {Object} options - Scraping options
 * @returns {Promise<Object>} - Result object with success status and data
 */
const scrapeAndSaveFuncheapEvents = async (date, options = {}) => {
  const {
    includeDetails = true,
    categories = "",
    excludeSponsored = false,
    titleKeywords = "",
    costFilter = "",
    hasImages = false,
    progressPrefix = "",
    batchSize = 10, // Number of events to process in parallel
  } = options;

  console.log(
    `${progressPrefix}🚀 Scraping and saving Funcheap events for ${date}...`
  );

  // Convert date format for Funcheap (YYYY-MM-DD to YYYY/MM/DD)
  const funcheapDate = date.replace(/-/g, "/");

  // Build scraping options
  const scrapingOptions = {
    includeDetails: includeDetails,
    batchSize: batchSize, // Pass batch size to enhanced scraper
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
  const enhancedScraper = new EnhancedFuncheapScraper();
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

  // Step 2: Classify events immediately after scraping (in parallel batches)
  console.log(
    `${progressPrefix}🤖 Classifying ${events.length} events in batches of ${batchSize}...`
  );
  const eventsWithClassification = await classifyEventsInBatches(
    events,
    batchSize,
    progressPrefix
  );

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
      `${progressPrefix}✨ Generating human-friendly copies for ${eventsForEnhancement.length} events in batches of ${batchSize}...`
    );
    enhancedEvents = await enhanceEventsInBatches(
      eventsForEnhancement,
      batchSize,
      progressPrefix
    );
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

module.exports = {
  scrapeAndSaveFuncheapEvents,
  classifyEvent,
  generateHumanFriendlyEventCopy,
  classifyEventsInBatches,
  enhanceEventsInBatches,
};
