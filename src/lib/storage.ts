import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type {
  CrawlStatusResponse,
  CategorySchema,
  IdentifierSchema,
} from "./types.js";

/**
 * Default paths for data storage
 */
export const DEFAULT_PATHS = {
  configDir: path.join(os.homedir(), ".llmdump"),
  dataDir: path.join(os.homedir(), ".llmdump", "data"),
  historyDir: path.join(os.homedir(), ".llmdump", "data", "history"),
  currentCrawlPointer: path.join(
    os.homedir(),
    ".llmdump",
    "currentCrawlPointer.json"
  ),
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
 * Ensures the config directory exists in the user's home directory
 * @returns Path to the config directory
 */
export async function ensureConfigDirectory(): Promise<string> {
  await ensureDirectory(DEFAULT_PATHS.configDir);
  return DEFAULT_PATHS.configDir;
}

/**
 * Saves config to the user's home directory
 * @param config The configuration to save
 * @param filename The name of the config file
 */
export async function saveConfig(
  config: Record<string, any>,
  filename: string = "config.json"
): Promise<void> {
  const configDir = await ensureConfigDirectory();
  await fs.writeFile(
    path.join(configDir, filename),
    JSON.stringify(config, null, 2)
  );
}

/**
 * Loads config from the user's home directory
 * @param filename The name of the config file
 * @returns The loaded config, or null if not found
 */
export async function loadConfig(
  filename: string = "config.json"
): Promise<Record<string, any> | null> {
  const configDir = await ensureConfigDirectory();
  try {
    const content = await fs.readFile(path.join(configDir, filename), "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Saves crawl result to disk
 * @param crawlResult The crawl result to save
 * @param dir Optional directory to save the crawl result to
 */
export async function saveCrawlResult(
  crawlResult: CrawlStatusResponse,
  dir?: string
): Promise<void> {
  const targetDir = dir || (await getCurrentCrawlPath());
  await ensureDirectory(targetDir);
  await fs.writeFile(
    path.join(targetDir, "crawlResult.json"),
    JSON.stringify(crawlResult, null, 2)
  );
}

/**
 * Loads crawl result from disk
 * @param dir Optional directory to load the crawl result from
 * @returns The loaded crawl result, or null if not found
 */
export async function loadCrawlResult(
  dir?: string
): Promise<CrawlStatusResponse | null> {
  const targetDir = dir || (await getCurrentCrawlPath());
  try {
    const content = await fs.readFile(
      path.join(targetDir, "crawlResult.json"),
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
 * @param dir Optional directory to save the categories to
 */
export async function saveCategories(
  categories: CategorySchema,
  dir?: string
): Promise<void> {
  const targetDir = dir || (await getCurrentCrawlPath());
  await ensureDirectory(targetDir);
  await fs.writeFile(
    path.join(targetDir, "categories.json"),
    JSON.stringify(categories, null, 2)
  );
}

/**
 * Loads categories from disk
 * @param dir Optional directory to load the categories from
 * @returns The loaded categories, or null if not found
 */
export async function loadCategories(
  dir?: string
): Promise<CategorySchema | null> {
  const targetDir = dir || (await getCurrentCrawlPath());
  try {
    const content = await fs.readFile(
      path.join(targetDir, "categories.json"),
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
 * @param dir Optional directory to save the identifier to
 */
export async function saveIdentifier(
  identifier: IdentifierSchema,
  dir?: string
): Promise<void> {
  const targetDir = dir || (await getCurrentCrawlPath());
  await ensureDirectory(targetDir);
  await fs.writeFile(
    path.join(targetDir, "identifier.json"),
    JSON.stringify(identifier, null, 2)
  );
}

/**
 * Loads identifier from disk
 * @param dir Optional directory to load the identifier from
 * @returns The loaded identifier, or null if not found
 */
export async function loadIdentifier(
  dir?: string
): Promise<IdentifierSchema | null> {
  const targetDir = dir || (await getCurrentCrawlPath());
  try {
    const content = await fs.readFile(
      path.join(targetDir, "identifier.json"),
      "utf-8"
    );
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Gets a list of all crawls in history
 * @returns Array of directory names in the history directory
 */
export async function listCrawls(): Promise<string[]> {
  await ensureDirectory(DEFAULT_PATHS.historyDir);
  const entries = await fs.readdir(DEFAULT_PATHS.historyDir);
  return entries;
}

/**
 * Deletes a specific crawl
 * @param crawlName Name of the crawl to delete
 */
export async function deleteCrawl(crawlName: string): Promise<void> {
  const crawlPath = path.join(DEFAULT_PATHS.historyDir, crawlName);
  await fs.rm(crawlPath, { recursive: true });

  // If this was the current crawl, clear the pointer
  const currentPath = await getCurrentCrawlPath().catch(() => null);
  if (currentPath === crawlPath) {
    await fs.unlink(DEFAULT_PATHS.currentCrawlPointer);
  }
}

/**
 * Gets the current crawl directory path from the pointer
 * @returns The path to the current crawl directory
 */
export async function getCurrentCrawlPath(): Promise<string> {
  const pointer = await loadConfig("currentCrawlPointer.json");
  if (!pointer?.currentCrawlPath) {
    throw new Error("No current crawl selected");
  }
  return pointer.currentCrawlPath;
}

/**
 * Sets the current crawl pointer to a specific history directory
 * @param historyPath The path to the history directory to set as current
 */
export async function setCurrentCrawlPointer(
  historyPath: string
): Promise<void> {
  await saveConfig(
    { currentCrawlPath: historyPath },
    "currentCrawlPointer.json"
  );
}

/**
 * Creates a new crawl directory in history and sets it as current
 * @param identifier The identifier for the new crawl
 * @returns The path to the new crawl directory
 */
export async function createNewCrawl(
  identifier: IdentifierSchema
): Promise<string> {
  await ensureDirectory(DEFAULT_PATHS.historyDir);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const newCrawlDir = path.join(
    DEFAULT_PATHS.historyDir,
    `${identifier.identifier}-${timestamp}`
  );

  await ensureDirectory(newCrawlDir);
  await setCurrentCrawlPointer(newCrawlDir);

  return newCrawlDir;
}

/**
 * Saves crawl result to history and sets it as current
 * @param crawlResult The crawl result to save
 * @returns The path to the new crawl directory
 */
export async function saveCrawlToHistory(
  crawlResult: CrawlStatusResponse
): Promise<string> {
  // Create a temporary identifier for the directory name
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const tempId = `crawl-${timestamp}`;
  const newCrawlDir = path.join(DEFAULT_PATHS.historyDir, tempId);

  await ensureDirectory(newCrawlDir);
  await saveCrawlResult(crawlResult, newCrawlDir);
  await setCurrentCrawlPointer(newCrawlDir);

  return newCrawlDir;
}
