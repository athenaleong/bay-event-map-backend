const axios = require("axios");
const cheerio = require("cheerio");

class FuncheapScraper {
  constructor() {
    this.baseUrl = "https://sf.funcheap.com";
    this.axiosInstance = axios.create({
      timeout: 10000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; EventScraper/1.0; Research Purpose)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate",
        Connection: "keep-alive",
        "Upgrade-Insecure-Requests": "1",
      },
    });
  }

  async getEventsForDate(dateStr) {
    const allEvents = [];
    let currentPage = 1;
    let hasMorePages = true;

    while (hasMorePages) {
      const url =
        currentPage === 1
          ? `${this.baseUrl}/${dateStr}/`
          : `${this.baseUrl}/${dateStr}/page/${currentPage}/`;

      try {
        console.log(`Fetching page ${currentPage}: ${url}`);
        const response = await this.axiosInstance.get(url);

        // Add delay to be respectful
        await this.delay(1000);

        const pageEvents = this.parseEvents(response.data);

        // If no events found on this page, we've reached the end
        if (pageEvents.length === 0) {
          hasMorePages = false;
        } else {
          allEvents.push(...pageEvents);

          // Check if there's a "next page" indicator
          hasMorePages = this.hasNextPage(response.data);
          currentPage++;

          // Safety limit to prevent infinite loops
          if (currentPage > 10) {
            console.warn(`Reached page limit (10) for ${dateStr}`);
            hasMorePages = false;
          }
        }
      } catch (error) {
        // If we get a 404 on page 2+, that's normal - no more pages
        if (
          error.response &&
          error.response.status === 404 &&
          currentPage > 1
        ) {
          console.log(
            `No more pages for ${dateStr} (reached page ${currentPage})`
          );
          hasMorePages = false;
        } else {
          console.error(`Error fetching ${url}:`, error.message);
          throw new Error(
            `Failed to fetch events for ${dateStr}: ${error.message}`
          );
        }
      }
    }

    console.log(
      `Found ${allEvents.length} total events across ${
        currentPage - 1
      } pages for ${dateStr}`
    );
    return allEvents;
  }

  hasNextPage(html) {
    const $ = cheerio.load(html);

    // Look for pagination indicators
    const nextPageLink = $(
      '.next.page-numbers, .page-numbers.next, a[rel="next"]'
    );
    const paginationNav = $(".pagination, .nav-links, .page-navigation");

    // Check if there's a "next" button/link that's not disabled
    if (nextPageLink.length > 0) {
      // Make sure it's not disabled or just text
      return nextPageLink.is("a") && !nextPageLink.hasClass("disabled");
    }

    // Alternative: look for numbered page links and see if current page isn't the last
    const pageNumbers = $(".page-numbers:not(.next):not(.prev), .page-number");
    if (pageNumbers.length > 0) {
      const currentPageEl = $(
        ".page-numbers.current, .page-number.current, .current"
      );
      if (currentPageEl.length > 0) {
        const currentPageNum = parseInt(currentPageEl.text()) || 1;
        const allPageNums = pageNumbers
          .map((i, el) => parseInt($(el).text()))
          .get()
          .filter((n) => !isNaN(n));
        const maxPage = Math.max(...allPageNums);
        return currentPageNum < maxPage;
      }
    }

    // Fallback: check if there are many events (suggesting pagination might exist)
    const eventCount = $('article[class*="post-"]').length;
    return eventCount >= 10; // If 10+ events, might have pagination
  }

  parseEvents(html) {
    const $ = cheerio.load(html);
    const events = [];

    // First try to extract JSON-LD structured data
    const jsonEvents = this.extractJsonLD($);
    if (jsonEvents.length > 0) {
      return jsonEvents.map((event) => this.normalizeJsonLDEvent(event));
    }

    // Fallback to HTML parsing
    $('article[class*="post-"]').each((index, element) => {
      const event = this.parseArticle($, $(element));
      if (event && event.title) {
        events.push(event);
      }
    });

    return events;
  }

  extractJsonLD($) {
    const events = [];

    $('script[type="application/ld+json"]').each((index, element) => {
      try {
        const jsonText = $(element).html();
        if (!jsonText) return;

        const data = JSON.parse(jsonText);

        if (Array.isArray(data)) {
          const eventItems = data.filter((item) => item["@type"] === "Event");
          events.push(...eventItems);
        } else if (data["@type"] === "Event") {
          events.push(data);
        }
      } catch (error) {
        // Skip invalid JSON
      }
    });

    return events;
  }

  normalizeJsonLDEvent(jsonEvent) {
    return {
      title: jsonEvent.name || "Untitled Event",
      description: jsonEvent.description || "",
      url: jsonEvent.url || "",
      startTime: jsonEvent.startDate || null,
      endTime: jsonEvent.endDate || null,
      location: this.extractLocationFromJsonLD(jsonEvent.location),
      cost: this.extractCostFromJsonLD(jsonEvent.offers),
      image: this.extractImageFromJsonLD(jsonEvent.image),
      categories: [], // JSON-LD doesn't include category classes
      source: "json-ld",
    };
  }

  extractLocationFromJsonLD(location) {
    if (!location) return "";
    if (typeof location === "string") return location;
    if (location.name) return location.name;
    if (location.address) {
      if (typeof location.address === "string") return location.address;
      if (location.address.name) return location.address.name;
    }
    return "";
  }

  extractCostFromJsonLD(offers) {
    if (!offers) return "";
    if (typeof offers === "string") return offers;
    if (offers.price !== undefined) {
      return offers.price === 0 ? "FREE" : `$${offers.price}`;
    }
    return "";
  }

  extractImageFromJsonLD(image) {
    if (!image) return "";
    if (typeof image === "string") return image;
    if (image.url) return image.url;
    return "";
  }

  parseArticle($, article) {
    const event = {
      source: "html",
    };

    // Extract post ID from class
    const classes = article.attr("class") || "";
    const postIdMatch = classes.match(/post-(\d+)/);
    if (postIdMatch) {
      event.id = postIdMatch[1];
    }

    // Title and URL
    const titleElement = article.find("h1.entry-title, .entry-title");
    if (titleElement.length) {
      event.title = titleElement.text().trim();

      const link = titleElement.find("a");
      if (link.length) {
        event.url = link.attr("href") || "";
      }
    }

    // Time information
    const timeElement = article.find(".date-time, [data-event-date]");
    if (timeElement.length) {
      event.startTime = timeElement.attr("data-event-date") || null;
      event.endTime = timeElement.attr("data-event-date-end") || null;

      // Also get the display text
      event.timeDisplay = timeElement.text().trim();
    }

    // Cost
    const costElement = article.find(".cost");
    if (costElement.length) {
      event.cost = costElement.text().trim();
    }

    // Location
    const regionElement = article.find(".region");
    if (regionElement.length) {
      event.location = regionElement.text().trim().replace(/\s+/g, " ");
    }

    // Image
    const imageElement = article.find("img");
    if (imageElement.length) {
      event.image =
        imageElement.attr("src") || imageElement.attr("data-src") || "";
    }

    // Categories from CSS classes
    event.categories = this.extractCategories(classes);

    // Recurring flag
    const recurringElement = article.find(".recurring-flag-wrapper");
    if (recurringElement.length) {
      event.recurring = recurringElement.text().trim();
    }

    // Check if sponsored
    event.sponsored =
      classes.includes("category-sponsored") ||
      classes.includes("category-funcheap-presents");

    return event;
  }

  extractCategories(classString) {
    const categories = [];
    const categoryRegex = /category-([^\s]+)/g;
    let match;

    while ((match = categoryRegex.exec(classString)) !== null) {
      const category = match[1]
        .replace(/-/g, " ")
        .replace(/\b\w/g, (l) => l.toUpperCase());
      categories.push(category);
    }

    return categories;
  }

  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async getDateRange(startDate, days = 7) {
    const events = [];
    const currentDate = new Date(startDate.replace(/\//g, "-"));

    for (let i = 0; i < days; i++) {
      const date = new Date(currentDate);
      date.setDate(currentDate.getDate() + i);

      const dateStr = date.toISOString().split("T")[0].replace(/-/g, "/");
      console.log(`Fetching events for ${dateStr}...`);

      try {
        const dayEvents = await this.getEventsForDate(dateStr);
        events.push(
          ...dayEvents.map((event) => ({
            ...event,
            date: dateStr,
          }))
        );
      } catch (error) {
        console.error(`Failed to get events for ${dateStr}:`, error.message);
      }

      // Be respectful with multiple requests
      await this.delay(2000);
    }

    return events;
  }
}

module.exports = { FuncheapScraper };
