import { withRetry } from "./util.js";
import FirecrawlApp, { type ScrapeResponse } from "@mendable/firecrawl-js";
import type { CrawlStatusResponse, CrawledDocument } from "./types.js";

/**
 * Options for crawling a URL
 */
export interface CrawlOptions {
  limit?: number;
  scrapeOptions?: {
    formats?: string[];
    onlyMainContent?: boolean;
  };
}

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

/**
 * Crawls a website and returns the crawl result
 * @param url The URL to crawl
 * @param options The crawl options
 * @param apiKey The Firecrawl API key
 * @returns The crawl result
 */
export async function crawlWebsite(
  url: string,
  options: CrawlOptions = {},
  apiKey: string
): Promise<CrawlStatusResponse> {
  if (!apiKey) {
    throw new Error("Firecrawl API key is required");
  }

  console.log(`Crawling ${url} with limit ${options.limit || "default"}...`);
  return await crawl(url, options, apiKey);
}

/**
 * Internal implementation of crawl using Firecrawl
 */
const crawl = async (
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

/**
 * Extracts crawled documents from the crawl response
 * @param crawlResult The crawl response from Firecrawl
 * @returns An array of crawled documents
 */
export function extractDocuments(
  crawlResult: CrawlStatusResponse
): CrawledDocument[] {
  return crawlResult.data.map((d: any) => ({
    url: d.metadata?.url || "",
    title: d.metadata?.title || "",
    description: d.metadata?.description || "",
    content: d.markdown || "",
  }));
}
