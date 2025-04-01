import fs from "node:fs/promises";
import path from "node:path";
import type {
  CrawlStatusResponse,
  CategorySchema,
  IdentifierSchema,
} from "./types.js";

/**
 * Default paths for data storage
 */
export const DEFAULT_PATHS = {
  dataDir: ".data",
  currentCrawlDir: ".data/current-crawl",
  historyDir: ".data/history",
};

/**
 * Ensures a directory exists, creating it if necessary
 * @param dir Directory path to ensure
 */
export async function ensureDirectory(dir: string): Promise<void> {
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

/**
 * Saves crawl result to disk
 * @param crawlResult The crawl result to save
 * @param dir Directory to save the crawl result to
 */
export async function saveCrawlResult(
  crawlResult: CrawlStatusResponse,
  dir: string = DEFAULT_PATHS.currentCrawlDir
): Promise<void> {
  await ensureDirectory(dir);
  await fs.writeFile(
    path.join(dir, "crawlResult.json"),
    JSON.stringify(crawlResult, null, 2)
  );
}

/**
 * Loads crawl result from disk
 * @param dir Directory to load the crawl result from
 * @returns The loaded crawl result, or null if not found
 */
export async function loadCrawlResult(
  dir: string = DEFAULT_PATHS.currentCrawlDir
): Promise<CrawlStatusResponse | null> {
  try {
    const content = await fs.readFile(
      path.join(dir, "crawlResult.json"),
      "utf-8"
    );
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Saves categories to disk
 * @param categories The categories to save
 * @param dir Directory to save the categories to
 */
export async function saveCategories(
  categories: CategorySchema,
  dir: string = DEFAULT_PATHS.currentCrawlDir
): Promise<void> {
  await ensureDirectory(dir);
  await fs.writeFile(
    path.join(dir, "categories.json"),
    JSON.stringify(categories, null, 2)
  );
}

/**
 * Loads categories from disk
 * @param dir Directory to load the categories from
 * @returns The loaded categories, or null if not found
 */
export async function loadCategories(
  dir: string = DEFAULT_PATHS.currentCrawlDir
): Promise<CategorySchema | null> {
  try {
    const content = await fs.readFile(
      path.join(dir, "categories.json"),
      "utf-8"
    );
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Saves identifier to disk
 * @param identifier The identifier to save
 * @param dir Directory to save the identifier to
 */
export async function saveIdentifier(
  identifier: IdentifierSchema,
  dir: string = DEFAULT_PATHS.currentCrawlDir
): Promise<void> {
  await ensureDirectory(dir);
  await fs.writeFile(
    path.join(dir, "identifier.json"),
    JSON.stringify(identifier, null, 2)
  );
}

/**
 * Loads identifier from disk
 * @param dir Directory to load the identifier from
 * @returns The loaded identifier, or null if not found
 */
export async function loadIdentifier(
  dir: string = DEFAULT_PATHS.currentCrawlDir
): Promise<IdentifierSchema | null> {
  try {
    const content = await fs.readFile(
      path.join(dir, "identifier.json"),
      "utf-8"
    );
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Archives current crawl to history
 * @param identifier The identifier to use for the archive name
 * @returns The path to the archived directory
 */
export async function archiveCrawl(
  identifier: IdentifierSchema
): Promise<string> {
  await ensureDirectory(DEFAULT_PATHS.historyDir);

  // Create timestamped directory name
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archiveDir = path.join(
    DEFAULT_PATHS.historyDir,
    `${identifier.identifier}-${timestamp}`
  );

  // Move current crawl to archive
  await fs.rename(DEFAULT_PATHS.currentCrawlDir, archiveDir);

  // Create new empty current-crawl directory
  await ensureDirectory(DEFAULT_PATHS.currentCrawlDir);

  return archiveDir;
}

/**
 * Gets a list of archived crawls
 * @returns Array of directory names in the history directory
 */
export async function listArchivedCrawls(): Promise<string[]> {
  await ensureDirectory(DEFAULT_PATHS.historyDir);
  const entries = await fs.readdir(DEFAULT_PATHS.historyDir);
  return entries;
}

/**
 * Deletes a specific archived crawl
 * @param archiveName Name of the archive to delete
 */
export async function deleteArchivedCrawl(archiveName: string): Promise<void> {
  const archivePath = path.join(DEFAULT_PATHS.historyDir, archiveName);
  await fs.rm(archivePath, { recursive: true });
}

/**
 * Deletes the current crawl
 */
export async function deleteCurrentCrawl(): Promise<void> {
  await fs.rm(DEFAULT_PATHS.currentCrawlDir, { recursive: true });
  await ensureDirectory(DEFAULT_PATHS.currentCrawlDir);
}
