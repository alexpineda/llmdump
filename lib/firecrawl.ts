import FirecrawlApp, { type ScrapeResponse } from "@mendable/firecrawl-js";
import { withRetry } from "./util.js";

/**
 * Scrapes a url and returns the markdown
 * Rate limited to 20 / minute
 * @param url
 * @returns
 */
export const scrape = async (url: string, apiKey: string) => {
  const app = new FirecrawlApp({ apiKey });
  return withRetry(async () => {
    const scrapeResult = (await app.scrapeUrl(url, {
      formats: ["markdown", "html", "screenshot@fullPage"],
      actions: [
        // {
        //   type: "screenshot",
        //   fullPage: true,
        // },
        // {
        //   "type": "click",
        //   "selector": "#load-more-button"
        // }
        // {
        //   "type": "write",
        //   "text": "Hello, world!",
        //   "selector": "#search-input"
        // }
        // {
        //   "type": "press",
        //   "key": "Enter"
        // }
      ],
    })) as ScrapeResponse;

    if (!scrapeResult.success) {
      throw new Error(`Failed to scrape: ${scrapeResult.error}`);
    }

    return scrapeResult;
  });
};

type MapOptions = {
  search?: string;
  limit?: number;
};

export const map = async (
  url: string,
  options: MapOptions = {},
  apiKey: string
) => {
  const app = new FirecrawlApp({ apiKey });
  return withRetry(async () => {
    const mapResponse = await app.mapUrl(url, {
      search: options.search,
      limit: options.limit,
    });

    if (!mapResponse.success) {
      throw new Error(`Failed to map: ${mapResponse.error}`);
    }

    return mapResponse;
  });
};

type CrawlOptions = {
  limit?: number;
  scrapeOptions?: {
    formats?: string[];
    onlyMainContent?: boolean;
  };
};

export const crawl = async (
  url: string,
  options: CrawlOptions = {},
  apiKey: string
) => {
  const app = new FirecrawlApp({ apiKey });
  return withRetry(async () => {
    const crawlResponse = await app.crawlUrl(url, {
      limit: options.limit,
      scrapeOptions: {
        formats: ["markdown"],
        onlyMainContent: true,
      },
    });

    if (!crawlResponse.success) {
      throw new Error(`Failed to crawl: ${crawlResponse.error}`);
    }

    return crawlResponse;
  });
};
