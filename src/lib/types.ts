import { z } from "zod";
import type { CrawlStatusResponse } from "@mendable/firecrawl-js";

/**
 * Represents a crawled document with basic metadata and content
 */
export type CrawledDocument = {
  url: string;
  title: string;
  description: string;
  content: string;
};

/**
 * Schema for document identifier
 */
export const identifierSchema = z.object({
  identifier: z.string(),
});

export type IdentifierSchema = z.infer<typeof identifierSchema>;

/**
 * Schema for document categorization
 */
export const categorySchema = z.object({
  categories: z.array(
    z.object({
      category: z.string(),
      refUrls: z.array(z.string()),
    })
  ),
});

export type CategorySchema = z.infer<typeof categorySchema>;

/**
 * Re-export CrawlStatusResponse for convenience
 */
export type { CrawlStatusResponse };
