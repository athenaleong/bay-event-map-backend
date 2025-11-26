const Anthropic = require("@anthropic-ai/sdk");

// Initialize Anthropic client
let anthropic = null;

function initializeAnthropic() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn(
      "ANTHROPIC_API_KEY not found in environment variables. Emoji generation will be disabled."
    );
    return null;
  }

  if (process.env.ANTHROPIC_API_KEY === "your_anthropic_api_key_here") {
    console.warn(
      "ANTHROPIC_API_KEY is set to placeholder value. Please update with your actual API key."
    );
    return null;
  }

  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
}

anthropic = initializeAnthropic();

/**
 * Generate an emoji for an event based on its title and description
 * @param {string} title - The event title
 * @param {string} description - The event description (will be truncated if too long)
 * @returns {Promise<string>} - The generated emoji
 */
async function generateEventEmoji(title, description = "") {
  try {
    // Check if Anthropic client is available
    if (!anthropic) {
      console.warn(
        "Anthropic client not initialized. Skipping emoji generation."
      );
      return "📅"; // Return default emoji
    }

    // Truncate description to avoid hitting token limits
    const truncatedDescription =
      description.length > 300
        ? description.substring(0, 300) + "..."
        : description;

    // Combine title and description for the prompt
    const eventText = `${title}\n${truncatedDescription}`;

    const msg = await anthropic.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 4096,
      temperature: 1,
      system:
        "given the name and description of an event, choose an emoji that describes the event. the emoji will be used as an icon marker. avoid using faces and hearts, use descriptive and fun emoji. Do not use 😂 or 🤣 \n\n\nOutput following this example, do not output anything else:\n🌈\n",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: eventText,
            },
          ],
        },
      ],
    });

    // Extract the emoji from the response
    const emoji = msg.content[0].text.trim();
    return emoji;
  } catch (error) {
    console.error("Error generating emoji:", error);
    // Return a default emoji if API call fails
    return "📅";
  }
}

/**
 * Generate emojis for multiple events in batch
 * @param {Array} events - Array of event objects with title and description
 * @param {number} delay - Delay between API calls in milliseconds (default: 100ms)
 * @returns {Promise<Array>} - Array of events with added emoji property
 */
async function generateEmojisForEvents(events, delay = 100) {
  const eventsWithEmojis = [];


  for (const event of events) {
    try {
      const emoji = await generateEventEmoji(event.title, event.description);
      eventsWithEmojis.push({
        ...event,
        emoji: emoji,
      });

      // Add delay between requests to be respectful to the API
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    } catch (error) {
      console.error(
        `Error generating emoji for event "${event.title}":`,
        error
      );
      // Add default emoji if generation fails
      eventsWithEmojis.push({
        ...event,
        emoji: "📅",
      });
    }
  }

  return eventsWithEmojis;
}

module.exports = {
  generateEventEmoji,
  generateEmojisForEvents,
};
