const axios = require("axios");
const cheerio = require("cheerio");

class EventDetailScraper {
  constructor() {
    this.axiosInstance = axios.create({
      timeout: 15000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; EventDetailScraper/1.0; Research Purpose)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate",
        Connection: "keep-alive",
        "Upgrade-Insecure-Requests": "1",
      },
    });
  }

  async scrapeEventDetails(eventUrl) {
    try {
      console.log(`    🔗 Fetching details from: ${eventUrl}`);
      const response = await this.axiosInstance.get(eventUrl);

      // Add delay to be respectful
      await this.delay(500);

      return this.parseEventDetailPage(response.data, eventUrl);
    } catch (error) {
      console.error(
        `Error fetching event details from ${eventUrl}:`,
        error.message
      );
      throw new Error(`Failed to fetch event details: ${error.message}`);
    }
  }

  parseEventDetailPage(html, url) {
    const $ = cheerio.load(html);
    const details = {
      source: "detail",
      url: url,
    };

    // Try JSON-LD first (most reliable)
    const jsonLDDetails = this.extractJsonLDDetails($);
    if (Object.keys(jsonLDDetails).length > 0) {
      Object.assign(details, jsonLDDetails);
    }

    // Extract additional details from HTML
    this.extractHTMLDetails($, details);

    return details;
  }

  extractJsonLDDetails($) {
    const details = {};

    $('script[type="application/ld+json"]').each((index, element) => {
      try {
        const jsonText = $(element).html();
        if (!jsonText) return;

        const data = JSON.parse(jsonText);

        // Handle array of LD+JSON objects
        const eventData = Array.isArray(data)
          ? data.find((item) => item["@type"] === "Event")
          : data["@type"] === "Event"
          ? data
          : null;

        if (eventData) {
          details.title = eventData.name || details.title;
          details.description = eventData.description || details.description;
          details.startTime = eventData.startDate || details.startTime;
          details.endTime = eventData.endDate || details.endTime;

          // Extract venue information
          if (eventData.location) {
            const location = eventData.location;
            if (location.name) {
              details.venue = location.name;
            }
            if (location.address) {
              if (typeof location.address === "string") {
                details.address = location.address;
              } else if (
                location.address.streetAddress ||
                location.address.addressLocality
              ) {
                const addr = location.address;
                details.address = [
                  addr.streetAddress,
                  addr.addressLocality,
                  addr.addressRegion,
                  addr.postalCode,
                ]
                  .filter(Boolean)
                  .join(", ");
              }
            }
            if (location.geo) {
              details.latitude = location.geo.latitude;
              details.longitude = location.geo.longitude;
            }
          }

          // Extract cost information
          if (eventData.offers) {
            const offers = Array.isArray(eventData.offers)
              ? eventData.offers[0]
              : eventData.offers;
            if (offers.price !== undefined) {
              details.cost =
                offers.price === 0 || offers.price === "0"
                  ? "FREE"
                  : `$${offers.price}`;
            }
            if (offers.priceCurrency) {
              details.currency = offers.priceCurrency;
            }
            if (offers.description) {
              details.costDetails = offers.description;
            }
          }

          // Extract organizer information
          if (eventData.organizer) {
            const organizer = eventData.organizer;
            details.organizer = organizer.name || organizer;
            if (organizer.url) {
              details.organizerUrl = organizer.url;
            }
          }

          // Extract performer information
          if (eventData.performer) {
            details.performers = Array.isArray(eventData.performer)
              ? eventData.performer.map((p) => p.name || p)
              : [eventData.performer.name || eventData.performer];
          }

          // Extract image
          if (eventData.image) {
            details.image = Array.isArray(eventData.image)
              ? eventData.image[0]
              : eventData.image;
            if (typeof details.image === "object" && details.image.url) {
              details.image = details.image.url;
            }
          }
        }
      } catch (error) {
        // Skip invalid JSON
      }
    });

    return details;
  }

  extractHTMLDetails($, details) {
    // Extract title if not already found
    if (!details.title) {
      const titleSelectors = [
        "h1.entry-title",
        ".entry-title",
        "h1",
        ".event-title",
        ".post-title",
      ];

      for (const selector of titleSelectors) {
        const titleEl = $(selector).first();
        if (titleEl.length && titleEl.text().trim()) {
          details.title = titleEl.text().trim();
          break;
        }
      }
    }

    // Extract description/content
    const contentSelectors = [
      ".entry-content",
      ".post-content",
      ".event-description",
      ".event-content",
      "article .content",
    ];

    for (const selector of contentSelectors) {
      const contentEl = $(selector).first();
      if (contentEl.length) {
        details.descriptionHtml = contentEl.html();
        details.description = contentEl.text().trim().substring(0, 500);
        break;
      }
    }

    // Extract event metadata
    this.extractEventMeta($, details);

    // Extract contact information
    this.extractContactInfo($, details);

    // Extract additional images
    this.extractImages($, details);

    // Extract social links
    this.extractSocialLinks($, details);

    // Extract event date from various sources
    this.extractEventDate($, details);

    return details;
  }

  extractEventMeta($, details) {
    // Look for structured event information
    const metaSelectors = {
      venue: [".venue", ".location", ".event-venue", "[data-venue]"],
      address: [".address", ".event-address", "[data-address]"],
      cost: [".cost", ".price", ".event-cost", ".admission"],
      eventDate: [".date", ".event-date", "[data-date]"],
      time: [".time", ".event-time", "[data-time]"],
    };

    Object.entries(metaSelectors).forEach(([key, selectors]) => {
      if (details[key]) return; // Skip if already found

      for (const selector of selectors) {
        const el = $(selector).first();
        if (el.length && el.text().trim()) {
          details[key] = el.text().trim();
          break;
        }
      }
    });

    // Extract tags/categories
    const tagElements = $(".tag, .category, .event-tag, .post-tag");
    if (tagElements.length > 0) {
      details.tags = tagElements.map((i, el) => $(el).text().trim()).get();
    }
  }

  extractContactInfo($, details) {
    // Look for contact information
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const phoneRegex = /[\+]?[1-9][\d]{0,15}/g;

    const contactText = $(".contact, .event-contact, .organizer-info").text();

    const emails = contactText.match(emailRegex);
    if (emails) {
      details.contactEmail = emails[0];
    }

    const phones = contactText.match(phoneRegex);
    if (phones) {
      details.contactPhone = phones[0];
    }
  }

  extractImages($, details) {
    if (details.image) return; // Already have main image

    // Look for event images
    const imageSelectors = [
      ".event-image img",
      ".post-thumbnail img",
      ".featured-image img",
      "article img",
      ".entry-content img",
    ];

    for (const selector of imageSelectors) {
      const img = $(selector).first();
      if (img.length) {
        const src = img.attr("src") || img.attr("data-src");
        if (src && !src.includes("avatar") && !src.includes("logo")) {
          details.image = src;
          break;
        }
      }
    }
  }

  extractSocialLinks($, details) {
    const socialLinks = {};

    $(
      'a[href*="facebook.com"], a[href*="twitter.com"], a[href*="instagram.com"], a[href*="linkedin.com"]'
    ).each((i, el) => {
      const href = $(el).attr("href");
      if (href.includes("facebook.com")) socialLinks.facebook = href;
      else if (href.includes("twitter.com")) socialLinks.twitter = href;
      else if (href.includes("instagram.com")) socialLinks.instagram = href;
      else if (href.includes("linkedin.com")) socialLinks.linkedin = href;
    });

    if (Object.keys(socialLinks).length > 0) {
      details.socialLinks = socialLinks;
    }
  }

  extractEventDate($, details) {
    if (details.startTime) return; // Already have structured date

    // Look for date information in various formats
    const dateSelectors = ["[datetime]", ".date", ".event-date", "[data-date]"];

    for (const selector of dateSelectors) {
      const el = $(selector).first();
      if (el.length) {
        const datetime =
          el.attr("datetime") || el.attr("data-date") || el.text();
        if (datetime) {
          try {
            const parsedDate = new Date(datetime);
            if (!isNaN(parsedDate.getTime())) {
              details.eventDate = parsedDate.toISOString();
              break;
            }
          } catch (e) {
            // Continue to next selector
          }
        }
      }
    }
  }

  // Generate Google Maps URL if we have address
  generateGoogleMapsUrl(address) {
    if (!address) return null;
    const encodedAddress = encodeURIComponent(address);
    return `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
  }

  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = { EventDetailScraper };
