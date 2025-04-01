import fs from "node:fs/promises";
import path from "node:path";
import type { OpenAIInstance } from "./ai.js";
import { cleanupMarkdownDocument } from "./ai.js";
import type {
  CategorySchema,
  IdentifierSchema,
  CrawlStatusResponse,
} from "./types.js";

/**
 * Sanitizes categories by removing references to URLs that don't exist in the crawl result
 * @param categories The categories to sanitize
 * @param crawlResult The crawl result to check URLs against
 * @returns Sanitized categories
 */
export function sanitizeCategories(
  categories: CategorySchema,
  crawlResult: CrawlStatusResponse
): CategorySchema {
  return {
    categories: categories.categories.map((c) => ({
      ...c,
      refUrls: c.refUrls.filter((u) =>
        crawlResult.data.find((d) => d.metadata?.url === u)
      ),
    })),
  };
}

/**
 * Estimates the number of tokens in a string
 * @param content The content to estimate tokens for
 * @returns Estimated token count
 */
export function estimateTokens(content: string): number {
  return (Math.ceil(content.length / 4) * 4) / 5; // 4/5 is cleaned document estimate
}

/**
 * Estimates the number of tokens in a category's documents
 * @param category The category to estimate tokens for
 * @param crawlResult The crawl result to get document content from
 * @returns Estimated token count
 */
export function estimateTokensForCategory(
  category: CategorySchema["categories"][0],
  crawlResult: CrawlStatusResponse
): number {
  return category.refUrls.reduce((acc: number, url: string) => {
    const siteData = crawlResult.data.find((d) => d.metadata?.url === url);
    return acc + estimateTokens(siteData?.markdown ?? "");
  }, 0);
}

/**
 * Estimates the number of tokens in all categories
 * @param categories The categories to estimate tokens for
 * @param crawlResult The crawl result to get document content from
 * @returns Estimated token count
 */
export function estimateTokensForAllDocuments(
  categories: CategorySchema,
  crawlResult: CrawlStatusResponse
): number {
  return categories.categories.reduce((acc: number, category) => {
    return acc + estimateTokensForCategory(category, crawlResult);
  }, 0);
}

/**
 * Interface for document content with title, URL, and content
 */
export interface DocumentContent {
  title: string;
  url: string;
  content: string;
}

/**
 * Processes the content of a specific document
 * @param url The URL of the document to process
 * @param crawlResult The crawl result containing the document
 * @param openai The OpenAI instance for cleaning
 * @returns The processed document content
 */
export async function processDocument(
  url: string,
  crawlResult: CrawlStatusResponse,
  openai: OpenAIInstance
): Promise<DocumentContent | null> {
  const siteData = crawlResult.data.find((d) => d.metadata?.url === url);
  if (
    !siteData?.metadata?.title ||
    !siteData?.metadata?.url ||
    !siteData?.markdown
  ) {
    return null;
  }

  const cleanedContent = await cleanupMarkdownDocument(
    siteData.markdown,
    openai
  );
  return {
    title: siteData.metadata.title,
    url: siteData.metadata.url,
    content: cleanedContent,
  };
}

/**
 * Processes the content of a category by processing each document
 * @param category The category to process
 * @param crawlResult The crawl result containing the documents
 * @param openai The OpenAI instance for cleaning
 * @returns Array of processed documents
 */
export async function processCategoryContent(
  category: CategorySchema["categories"][0],
  crawlResult: CrawlStatusResponse,
  openai: OpenAIInstance
): Promise<DocumentContent[]> {
  const documents: DocumentContent[] = [];

  for (const url of category.refUrls) {
    const document = await processDocument(url, crawlResult, openai);
    if (document) {
      documents.push(document);
    }
  }

  return documents;
}

/**
 * Extract headers from markdown content
 * @param content The markdown content to extract headers from
 * @returns Array of headers
 */
export async function extractHeaders(content: string): Promise<string[]> {
  const lines = content.split("\n");
  const headers = lines
    .filter((line) => line.startsWith("#"))
    .map((line) => line.replace("#", "##").trim());
  return headers;
}

/**
 * Prunes specified URLs from a category
 * @param categories The categories to modify
 * @param categoryName The name of the category to prune
 * @param urlsToRemove The URLs to remove from the category
 * @returns Updated categories
 */
export function pruneUrlsFromCategory(
  categories: CategorySchema,
  categoryName: string,
  urlsToRemove: string[]
): CategorySchema {
  return {
    categories: categories.categories.map((category) => {
      if (category.category === categoryName) {
        return {
          ...category,
          refUrls: category.refUrls.filter(
            (url) => !urlsToRemove.includes(url)
          ),
        };
      }
      return category;
    }),
  };
}

/**
 * Writes documents to file
 * @param categories The categories containing documents to write
 * @param identifier The identifier for the documents
 * @param crawlResult The crawl result containing the document content
 * @param outputDir The directory to write the documents to
 * @param openai The OpenAI instance for cleaning
 * @param mode Whether to write a single file or multiple files
 */
export async function writeDocumentsToFile(
  categories: CategorySchema,
  identifier: IdentifierSchema,
  crawlResult: CrawlStatusResponse,
  outputDir: string,
  openai: OpenAIInstance,
  mode: "single" | "multiple" = "single"
): Promise<string[]> {
  const outputFiles: string[] = [];

  if (mode === "single") {
    const outputPath = path.join(outputDir, `${identifier.identifier}.md`);
    let content = `# ${identifier.identifier}\n\n`;

    for (const category of categories.categories) {
      if (category.refUrls.length === 0) continue;

      content += `## ${category.category}\n\n`;
      const documents = await processCategoryContent(
        category,
        crawlResult,
        openai
      );

      for (const doc of documents) {
        content += `### ${doc.title}\n\n`;
        content += `[${doc.url}](${doc.url})\n\n`;
        content += `${doc.content}\n\n`;
      }
    }

    await fs.writeFile(outputPath, content);
    outputFiles.push(outputPath);
  } else {
    // Multiple files mode
    for (const category of categories.categories) {
      if (category.refUrls.length === 0) continue;

      const categoryFile = path.join(
        outputDir,
        `${identifier.identifier}_${category.category.replace(/\s+/g, "_")}.md`
      );

      let content = `# ${category.category}\n\n`;
      const documents = await processCategoryContent(
        category,
        crawlResult,
        openai
      );

      for (const doc of documents) {
        content += `## ${doc.title}\n\n`;
        content += `[${doc.url}](${doc.url})\n\n`;
        content += `${doc.content}\n\n`;
      }

      await fs.writeFile(categoryFile, content);
      outputFiles.push(categoryFile);
    }
  }

  return outputFiles;
}
