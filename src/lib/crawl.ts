import { crawl as firecrawlCrawl } from "../../lib/firecrawl.js";
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
  return await firecrawlCrawl(url, options, apiKey);
}

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
