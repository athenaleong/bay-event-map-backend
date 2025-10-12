const { getNearbyPlaces } = require("./database");

/**
 * Validate input parameters for recommendRoute endpoint
 * @param {Object} params - Input parameters
 * @returns {Object} - Validation result with success status and error message
 */
const validateRecommendRouteInput = (params) => {
  const { lat, lon, locationName, timeLimit, intention, currentTime } = params;

  // Check required fields
  if (lat === undefined || lat === null) {
    return { success: false, error: "Latitude (lat) is required" };
  }
  if (lon === undefined || lon === null) {
    return { success: false, error: "Longitude (lon) is required" };
  }
  if (!locationName || typeof locationName !== "string") {
    return { success: false, error: "Location name is required" };
  }
  if (!timeLimit || typeof timeLimit !== "string") {
    return { success: false, error: "Time limit is required" };
  }
  if (!intention || typeof intention !== "string") {
    return { success: false, error: "Intention is required" };
  }
  if (!currentTime || typeof currentTime !== "string") {
    return { success: false, error: "Current time is required" };
  }

  // Validate latitude and longitude
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lon);

  if (isNaN(latitude) || latitude < -90 || latitude > 90) {
    return {
      success: false,
      error: "Invalid latitude. Must be between -90 and 90",
    };
  }
  if (isNaN(longitude) || longitude < -180 || longitude > 180) {
    return {
      success: false,
      error: "Invalid longitude. Must be between -180 and 180",
    };
  }

  // Validate time format (expecting ISO string or similar)
  const timeDate = new Date(currentTime);
  if (isNaN(timeDate.getTime())) {
    return { success: false, error: "Invalid current time format" };
  }

  return {
    success: true,
    validatedParams: {
      lat: latitude,
      lon: longitude,
      locationName: locationName.trim(),
      timeLimit: timeLimit.trim(),
      intention: intention.trim(),
      currentTime: timeDate,
    },
  };
};

/**
 * Get nearby places within specified radius
 * @param {number} lat - Center latitude
 * @param {number} lon - Center longitude
 * @param {number} radiusMeters - Search radius in meters (default: 700)
 * @returns {Promise<Object>} - Result object with places
 */
const getNearbyPlacesWithinRadius = async (lat, lon, radiusMeters = 700) => {
  try {
    console.log(
      `Searching for places within ${radiusMeters}m of ${lat}, ${lon}`
    );

    const result = await getNearbyPlaces(lat, lon, radiusMeters);

    if (!result.success) {
      return {
        success: false,
        error: result.error,
        places: [],
      };
    }

    console.log(`Found ${result.count} places within radius`);
    return {
      success: true,
      places: result.places,
      count: result.count,
    };
  } catch (error) {
    console.error("Error getting nearby places:", error);
    return {
      success: false,
      error: error.message,
      places: [],
    };
  }
};

/**
 * Filter places by excluding specific tags
 * @param {Array} places - Array of place objects
 * @param {Array} excludedTags - Array of tags to exclude (default: ["lodging", "selfcare", "night_club"])
 * @returns {Object} - Filtered places and removal count
 */
const filterPlacesByTags = (
  places,
  excludedTags = ["lodging", "selfcare", "night_club"]
) => {
  const excludedTagsSet = new Set(excludedTags);
  let removedCount = 0;

  const filteredPlaces = places.filter((place) => {
    const placeTags = place.tags || [];
    const hasExcludedTag = placeTags.some((tag) => excludedTagsSet.has(tag));

    if (hasExcludedTag) {
      removedCount++;
      return false;
    }
    return true;
  });

  console.log(
    `Filtered out ${removedCount} places with excluded tags: ${excludedTags.join(
      ", "
    )}`
  );
  console.log(`${filteredPlaces.length} places remaining after tag filtering`);

  return {
    places: filteredPlaces,
    removedCount,
    excludedTags,
  };
};

/**
 * Filter places by checking if they are open at the current time
 * @param {Array} places - Array of place objects
 * @param {Date} currentTime - Current time to check against
 * @returns {Object} - Filtered places and removal count
 */
const filterPlacesByHours = (places, currentTime) => {
  let removedCount = 0;

  // Convert the input time to California time if it's not already
  let californiaTime;
  if (currentTime instanceof Date) {
    // If it's a Date object, convert to California time
    californiaTime = new Date(
      currentTime.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
    );
  } else {
    // If it's a string, parse it and convert to California time
    const utcTime = new Date(currentTime);
    californiaTime = new Date(
      utcTime.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
    );
  }

  const currentDay = californiaTime.getDay(); // 0 = Sunday, 1 = Monday, etc.
  const currentHour = californiaTime.getHours();
  const currentMinute = californiaTime.getMinutes();
  const currentTimeMinutes = currentHour * 60 + currentMinute;

  // Log the selected time for debugging
  console.log(
    `Selected time: ${californiaTime.toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    })} (Day: ${currentDay}, Hour: ${currentHour}, Minute: ${currentMinute}, Total Minutes: ${currentTimeMinutes})`
  );

  // Log the original input time for comparison
  console.log(
    `Original input time: ${currentTime} (type: ${typeof currentTime})`
  );

  const filteredPlaces = places.filter((place) => {
    const hours = place.hours;

    // If no hours data, keep the place (assume it's open)
    if (!hours) {
      return true;
    }

    // Get day name from day number
    const dayNames = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    const currentDayName = dayNames[currentDay];

    let dayHours = null;

    // Handle different hours formats
    if (Array.isArray(hours)) {
      // Format: ['Monday: Closed', 'Tuesday: 5:00 PM – 12:00 AM']
      const dayEntry = hours.find((h) => h.startsWith(currentDayName + ":"));
      if (dayEntry) {
        dayHours = dayEntry.split(": ")[1]; // Extract the time part after ": "
      }
    } else if (typeof hours === "object") {
      // Format: { monday: "5:00 PM - 12:00 AM" }
      const lowerDayName = currentDayName.toLowerCase();
      dayHours = hours[lowerDayName];
    }

    // If no hours for current day, assume closed
    if (!dayHours) {
      removedCount++;
      return false;
    }

    // Parse hours (checking for "Closed" first)
    if (dayHours.toLowerCase().includes("closed")) {
      removedCount++;
      return false;
    }

    // Try to parse opening and closing times
    // Handle both regular dash (-) and en-dash (–)
    const timeMatch = dayHours.match(
      /(\d{1,2}):(\d{2})\s*(AM|PM)?\s*[–-]\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i
    );

    if (!timeMatch) {
      // If we can't parse the hours, keep the place
      return true;
    }

    const [, openHour, openMin, openPeriod, closeHour, closeMin, closePeriod] =
      timeMatch;

    // Convert to 24-hour format
    let openTimeMinutes = parseInt(openHour) * 60 + parseInt(openMin);
    let closeTimeMinutes = parseInt(closeHour) * 60 + parseInt(closeMin);

    if (
      openPeriod &&
      openPeriod.toUpperCase() === "PM" &&
      parseInt(openHour) !== 12
    ) {
      openTimeMinutes += 12 * 60;
    }
    if (
      openPeriod &&
      openPeriod.toUpperCase() === "AM" &&
      parseInt(openHour) === 12
    ) {
      openTimeMinutes -= 12 * 60;
    }

    if (
      closePeriod &&
      closePeriod.toUpperCase() === "PM" &&
      parseInt(closeHour) !== 12
    ) {
      closeTimeMinutes += 12 * 60;
    }
    if (
      closePeriod &&
      closePeriod.toUpperCase() === "AM" &&
      parseInt(closeHour) === 12
    ) {
      closeTimeMinutes -= 12 * 60;
    }

    // Handle overnight hours (e.g., 11 PM - 2 AM)
    if (closeTimeMinutes < openTimeMinutes) {
      closeTimeMinutes += 24 * 60;
    }

    // Check if current time is within opening hours
    const isOpen =
      currentTimeMinutes >= openTimeMinutes &&
      currentTimeMinutes <= closeTimeMinutes;

    if (!isOpen) {
      removedCount++;
    }

    return isOpen;
  });

  console.log(`Filtered out ${removedCount} places that are currently closed`);
  console.log(
    `${filteredPlaces.length} places remaining after hours filtering`
  );

  return {
    places: filteredPlaces,
    removedCount,
  };
};

/**
 * Create a condensed version of places with only essential fields
 * @param {Array} places - Array of place objects
 * @returns {Array} - Condensed places with only essential fields
 */
const createCondensedPlaces = (places) => {
  return places.map((place) => ({
    place_id: place.place_id,
    name: place.name,
    tags: place.tags,
    latitude: place.latitude,
    longitude: place.longitude,
    address: place.address,
    detailed_description: place.summary,
  }));
};

/**
 * Generate a route recommendation using OpenAI
 * @param {Array} condensedPlaces - Array of condensed place objects
 * @param {Object} userInput - User input parameters
 * @returns {Object} - Route recommendation result
 */
const generateRouteWithLLM = async (condensedPlaces, userInput, places) => {
  try {
    const { OpenAI } = require("openai");

    // Initialize OpenAI client
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    console.log(
      `Generating route with LLM for ${condensedPlaces.length} places`
    );
    console.log("User input:", userInput);

    // Create the prompt with the list of places
    const placesList = JSON.stringify(condensedPlaces, null, 2);

    const systemPrompt = `Interpret the given route information and output it in a structured JSON format that clearly represents each step, location, and transition within the route, ensuring detailed data for each waypoint. For every "course_of_action" and all natural language in "steps" and transitions, use language that fits the theme, mood, or vibe the user is seeking or that is implied by the context. Be aware of the typical time and effort required at each step, avoiding overplanning or making the activity unnecessarily complex. Keep the sequence efficient and realistic so the route feels natural, practical, and not overly burdened with micro-activities.

Carefully read and extract all key details from the route, including:
- The start point,
- Each waypoint, with associated data (place_id, and a "course_of_action" string that describes what should happen at that location using language that matches the user's thematic preference or overall vibe, and that is mindful to not overcomplicate or overplan),
- The end point,
- Descriptive steps or transitions between these, ensuring each transition uses natural language and tone that fit the user's desired or implied theme throughout the route, while keeping the pacing and planning realistic and time-sensitive.

Organize the extracted route as a JSON object with clearly labeled fields:

- "start": an object with at least a "name" and, if available, a "place_id".
- "waypoints": an array where each waypoint is an object with:
    - "name" (waypoint name),
    - "place_id" (a string identifier for the waypoint, use a unique placeholder if not provided),
    - "course_of_action" (a brief instruction or note describing the action at this point, written in the user's preferred or implied theme or tone, and ensuring efficiency by not overcomplicating the action or dwelling excessively at any step).
- "end": an object with at least a "name" and "place_id".
- "steps": an array containing a brief, thematically-aligned natural language description for each movement or transition along the route, in sequence, with no unnecessary or unrealistic elaborations.

Before producing the output, internally reason through the route's structure and sequence, ensuring that each waypoint is enriched with the appropriate data, that all steps and transitions accurately reflect the route, and that descriptions are in the correct tone or mood to suit the user's preference while being mindful of time and not overplanning. Do not produce any summary or explanation—output only the fully structured JSON object as specified.

# Steps

1. Parse the route input to identify start, waypoints, and end.
2. For each waypoint, ensure "name", assign "place_id" (use what's provided), and specify a "course_of_action" using language that matches the user's intended theme, mood, or vibe, ensuring that instructions remain practical and not unnecessarily detailed or time-consuming.
3. Sequence all steps in the route with a brief natural language transition for each, using the same user-aligned tone, and maintaining efficient progression without overextending the narrative.
4. Validate that each element is correctly assigned to its field: "start", "waypoints", "end", "steps".
5. Output only the complete, structured JSON.

# Output Format

Output must be a single JSON object with the fields:  
- "start": { "name": ..., "place_id": ... }  
- "waypoints": [ { "name": ..., "place_id": ..., "course_of_action": ... }, ... ]  
- "end": { "name": ..., "place_id": ... }  
- "steps": [ ... ]  
Do not include any additional explanation or text before or after the JSON.

# Examples

**Example Input:**  
Main Street → Elm Street → Oak Avenue (pause for lunch) → Pine Road

**Example Output:**  
{
  "start": { "name": "Main Street", "place_id": "5785" },
  "waypoints": [
    {
      "name": "Elm Street",
      "place_id": "1886",
      "course_of_action": "Walk along Elm Street, staying on track with your journey."
    },
    {
      "name": "Oak Avenue",
      "place_id": "3465",
      "course_of_action": "Pause briefly for lunch at Oak Avenue before moving ahead."
    }
  ],
  "end": { "name": "Pine Road", "place_id": "658" },
  "steps": [
    "Begin your journey from Main Street.",
    "Head along Elm Street toward Oak Avenue.",
    "Take a short lunch break at Oak Avenue.",
    "Continue straight to your destination, Pine Road."
  ]
}
(For longer or more complex routes, ensure that pacing is realistic, actions are efficient, and instructions never overwhelm the user with excessive detail or overplanning.)

# Notes

- Use place_id provided with list
- Every waypoint in the array must include all required fields.
- "Course_of_action" should succinctly capture the intended action at each waypoint, in the user's preferred tone/mood; keep it efficient and pragmatic, with no superfluous details.
- Never output anything except the JSON as specified.

**Reminder:**  
- Extract all route details, but keep planning efficient—do not overcomplicate steps or dwell excessively at any location.
- For each waypoint, include name, place_id, and a practical, thematically-aligned course_of_action.
- Match every step and transition to the user's described or implied theme—never default to playful or verbose unless specifically requested.
- Output only the structured JSON—never add explanations or extra text.

**Notes:**  
Ensure the prompt result balances thematic richness with time-sensitivity and efficient sequencing. Never overplan or add unnecessary micro-activities; keep progression practical and natural throughout.`;

    const userPrompt = `You are an excursion planner who curates an adventure for the user. Given a set of constraints and a list of places to choose from. Output a multistep adventure for the user

Details:
It's ${userInput.currentTime} on Sunday. The user is looking for an excursion that takes around ${userInput.timeLimit}. He is starting from ${userInput.locationName} in San Francisco and ending at the same place. ${userInput.intention}

Constraints:
- The user has a budget of $100
- Only include stops on the list
- Plan the route such that there's minimal back and forth. 
- Include a snack stop if you think fit, but no full meals
- CRITICAL: Use the EXACT place_id values from the list below. Do NOT create generic place IDs like "place_1", "place_2", etc.

Here are the list of places with their exact place_id values: 
${placesList}

plan a route for user`;

    // Call OpenAI API
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 2000,
      response_format: { type: "json_object" }, // Ensure JSON output
    });

    const routeText = response.choices[0].message.content;
    console.log("OpenAI Response:", routeText);
    console.log("Response length:", routeText.length);

    // Parse the JSON response
    let route;
    try {
      // Try to extract JSON from the response if it's wrapped in markdown
      let jsonText = routeText.trim();

      // Remove markdown code blocks if present
      if (jsonText.startsWith("```json") && jsonText.endsWith("```")) {
        jsonText = jsonText.slice(7, -3).trim(); // Remove ```json and ```
      } else if (jsonText.startsWith("```") && jsonText.endsWith("```")) {
        jsonText = jsonText.slice(3, -3).trim(); // Remove ``` and ```
      }

      console.log("Extracted JSON text:", jsonText);
      route = JSON.parse(jsonText);
    } catch (parseError) {
      console.error("Error parsing OpenAI response as JSON:", parseError);
      console.error("Raw response:", routeText);
      console.error("Response type:", typeof routeText);

      // Try to return a fallback response instead of failing completely
      route = {
        start: {
          name: userInput.locationName,
          place_id: "start_location",
        },
        waypoints: condensedPlaces.slice(0, 3).map((place, index) => ({
          name: place.name,
          place_id: place.place_id,
          course_of_action: `Explore ${
            place.name
          } and enjoy the ${place.tags.join(", ")} atmosphere`,
        })),
        end: {
          name: userInput.locationName,
          place_id: "end_location",
        },
        steps: [
          `Begin your ${userInput.timeLimit} adventure from ${userInput.locationName}`,
          `Head to your first destination and take in the local atmosphere`,
          `Continue your journey to the next stop`,
          `Make your final stop before returning to ${userInput.locationName}`,
          `Return to your starting point to complete your adventure`,
        ],
      };

      console.log("Using fallback route due to parsing error");
    }

    // Enrich waypoints with full place information
    if (route.waypoints && Array.isArray(route.waypoints)) {
      route.waypoints = route.waypoints.map((waypoint) => {
        // Find the full place information by place_id
        const fullPlaceInfo = places.find(
          (place) => place.place_id === waypoint.place_id
        );

        if (fullPlaceInfo) {
          return {
            ...waypoint,
            info: fullPlaceInfo,
          };
        } else {
          // If place not found, return waypoint as is
          console.warn(
            `Place with ID ${waypoint.place_id} not found in condensed places`
          );
          return waypoint;
        }
      });
    }

    return {
      success: true,
      route: route,
    };
  } catch (error) {
    console.error("Error generating route with LLM:", error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Main function to recommend a route based on user input
 * @param {Object} params - User input parameters
 * @param {number} params.lat - User's latitude
 * @param {number} params.lon - User's longitude
 * @param {string} params.locationName - User's location name
 * @param {string} params.timeLimit - Time limit for the route
 * @param {string} params.intention - User's intention/purpose
 * @param {string} params.currentTime - Current time
 * @param {number} params.radius - Search radius in meters (default: 700)
 * @returns {Promise<Object>} - Recommendation result
 */
const recommendRoute = async (params) => {
  const {
    lat,
    lon,
    locationName,
    timeLimit,
    intention,
    currentTime,
    radius = 700,
  } = params;

  console.log("RecommendRoute request received:", {
    lat,
    lon,
    locationName,
    timeLimit,
    intention,
    currentTime,
    radius,
  });

  // Step 1: Validate input parameters
  const validation = validateRecommendRouteInput({
    lat,
    lon,
    locationName,
    timeLimit,
    intention,
    currentTime,
  });

  if (!validation.success) {
    return {
      success: false,
      error: "Invalid input parameters",
      message: validation.error,
    };
  }

  const { validatedParams } = validation;
  const radiusMeters = parseInt(radius) || 700;

  // Step 2: Get nearby places within radius
  const nearbyResult = await getNearbyPlacesWithinRadius(
    validatedParams.lat,
    validatedParams.lon,
    radiusMeters
  );

  if (!nearbyResult.success) {
    return {
      success: false,
      error: "Failed to fetch nearby places",
      message: nearbyResult.error,
    };
  }

  if (nearbyResult.places.length === 0) {
    return {
      success: true,
      message: "No places found within the specified radius",
      places: [],
      filters: {
        radiusMeters,
        excludedTags: ["lodging", "selfcare", "night_club"],
        currentTime: validatedParams.currentTime.toISOString(),
      },
      stats: {
        totalFound: 0,
        afterTagFilter: 0,
        afterHoursFilter: 0,
        tagFilterRemoved: 0,
        hoursFilterRemoved: 0,
      },
    };
  }

  // Step 3: Filter out places with excluded tags
  const tagFilterResult = filterPlacesByTags(nearbyResult.places);

  // Step 4: Filter out places that are not open at current time
  const hoursFilterResult = filterPlacesByHours(
    tagFilterResult.places,
    validatedParams.currentTime
  );

  // Step 5: Create condensed version of filtered places
  const condensedPlaces = createCondensedPlaces(hoursFilterResult.places);
  console.log(
    `Created condensed version with ${condensedPlaces.length} places
    Example:
    ${condensedPlaces[0]}
    `
  );

  // Step 6: Generate route recommendation using LLM
  const routeResult = await generateRouteWithLLM(
    condensedPlaces,
    {
      locationName: validatedParams.locationName,
      timeLimit: validatedParams.timeLimit,
      intention: validatedParams.intention,
      currentTime: validatedParams.currentTime.toISOString(),
      lat: validatedParams.lat,
      lon: validatedParams.lon,
    },
    hoursFilterResult.places
  );

  if (!routeResult.success) {
    return {
      success: false,
      error: "Failed to generate route recommendation",
      message: routeResult.error,
    };
  }

  // Prepare response
  const response = {
    success: true,
    route: routeResult.route,
  };

  return response;
};

module.exports = {
  validateRecommendRouteInput,
  getNearbyPlacesWithinRadius,
  filterPlacesByTags,
  filterPlacesByHours,
  createCondensedPlaces,
  generateRouteWithLLM,
  recommendRoute,
};
