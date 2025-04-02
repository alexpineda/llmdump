#!/usr/bin/env node

import { createOpenAI } from "@ai-sdk/openai";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import inquirer from "inquirer";
import chalk from "chalk";
import cliMarkdown from "cli-markdown";
import boxen from "boxen";
import path from "node:path";
import { exec } from "child_process";
import fs from "node:fs/promises";
import dotenv from "dotenv";
import * as lib from "./lib/index.js";
import { createRequire } from "node:module";
import semver from "semver";
import https from "node:https";

// Create require function for ES modules
const require = createRequire(import.meta.url);
// Get package version
const packageJson = require("../package.json");
const currentVersion = packageJson.version;

// Load environment variables
dotenv.config();

/**
 * Checks if a newer version of the package is available
 */
async function checkForUpdates(): Promise<{
  hasUpdate: boolean;
  latestVersion: string;
}> {
  return new Promise((resolve) => {
    const req = https.get(
      "https://registry.npmjs.org/llmdump/latest",
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            const latest = JSON.parse(data);
            const latestVersion = latest.version;
            const hasUpdate = semver.gt(latestVersion, currentVersion);
            resolve({ hasUpdate, latestVersion });
          } catch (error) {
            // If there's an error, assume no update is needed
            resolve({ hasUpdate: false, latestVersion: currentVersion });
          }
        });
      }
    );

    req.on("error", () => {
      // If there's an error, assume no update is needed
      resolve({ hasUpdate: false, latestVersion: currentVersion });
    });

    req.end();
  });
}

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
  .option("firecrawl-key", {
    type: "string",
    alias: "k",
    description: "The API key for Firecrawl",
  })
  .option("openai-key", {
    type: "string",
    alias: "o",
    description: "The API key for OpenAI",
  })
  .parseSync();

// Extract API keys from arguments or environment variables
const firecrawlApiKey = (argv["firecrawl-key"] ||
  process.env.FIRECRAWL_API_KEY) as string;
const openaiApiKey = (argv["openai-key"] ||
  process.env.OPENAI_API_KEY) as string;

// Load API keys from config if not provided
let configKeys: Record<string, any> | null = null;
if (!firecrawlApiKey || !openaiApiKey) {
  try {
    configKeys = await lib.storage.loadConfig();
  } catch (error) {
    // Ignore errors - we'll prompt for keys if needed
  }
}

// If API keys are still missing, try to get them from config
const firecrawlKey = firecrawlApiKey || (configKeys?.firecrawlApiKey as string);
const openaiKey = openaiApiKey || (configKeys?.openaiApiKey as string);

// Validate API keys
if (!firecrawlKey) {
  console.error(
    chalk.red(
      "Please provide an API key for Firecrawl either as an argument with --firecrawl-key or as an environment variable"
    )
  );
  process.exit(1);
}

if (!openaiKey) {
  console.error(
    chalk.red(
      "Please provide an API key for OpenAI either as an argument with --openai-key or as an environment variable"
    )
  );
  process.exit(1);
}

// Save keys to config if they were provided via arguments or env vars
if (
  (firecrawlApiKey || openaiApiKey) &&
  (!configKeys || !configKeys.firecrawlApiKey || !configKeys.openaiApiKey)
) {
  await lib.storage.saveConfig({
    ...configKeys,
    firecrawlApiKey: firecrawlKey,
    openaiApiKey: openaiKey,
  });
}

// Initialize OpenAI client
const openai = createOpenAI({
  apiKey: openaiKey,
});

// Initialize state variables
let crawlResult: lib.CrawlStatusResponse;
let categories: lib.CategorySchema;
let identifier: lib.IdentifierSchema;

// Initialize data directories
(async () => {
  try {
    // Ensure config directory in user's home
    await lib.storage.ensureConfigDirectory();

    // Ensure data directories
    await lib.storage.ensureDirectory(lib.storage.DEFAULT_PATHS.dataDir);
    await lib.storage.ensureDirectory(lib.storage.DEFAULT_PATHS.historyDir);

    // Check for updates
    const { hasUpdate, latestVersion } = await checkForUpdates();
    if (hasUpdate) {
      console.log(
        boxen(
          chalk.yellow.bold(`Update Available! 🚀`) +
            `\n\n` +
            chalk.gray(`Current version: ${currentVersion}`) +
            `\n` +
            chalk.green(`Latest version: ${latestVersion}`) +
            `\n\n` +
            chalk.blue(`Run the following command to update:`) +
            `\n` +
            chalk.white.bold(`bun install -g llmdump`),
          { padding: 1, borderColor: "yellow", margin: 1 }
        )
      );
    }

    await showMainMenu();
  } catch (error) {
    console.error(chalk.red("Error initializing application:"), error);
    process.exit(1);
  }
})();

/**
 * Helper to run terminal commands
 */
async function runTerminalCommand(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * Shows the main menu
 */
async function showMainMenu(clear = true) {
  if (clear) {
    console.clear();

    console.log(
      boxen(
        chalk.blue("LLMDump") +
          "\n" +
          chalk.gray(
            "Automatically crawl documentation, clean up extra markup, and write to markdown for use with LLMs"
          ) +
          "\n" +
          chalk.gray(`v${currentVersion}`),
        { padding: 1 }
      )
    );
    console.log(
      chalk.yellow(
        "Warning: This is alpha software. It is not ready for production use."
      )
    );
  }

  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: "What would you like to do?",
      choices: [
        { name: "Start new crawl", value: "new" },
        { name: "Open existing crawl", value: "open" },
        { name: "Delete crawl", value: "delete" },
        { name: "Manage configuration", value: "config" },
        { name: "Exit", value: "exit" },
      ],
    },
  ]);

  switch (action) {
    case "new":
      await startNewCrawl();
      break;
    case "open":
      await openExistingCrawl();
      break;
    case "delete":
      await deleteCrawl();
      break;
    case "config":
      await manageConfiguration();
      break;
    case "exit":
      console.log(chalk.blue("Goodbye!"));
      process.exit(0);
  }
}

/**
 * Starts a new crawl
 */
async function startNewCrawl() {
  // Get URL from user first
  const { url } = await inquirer.prompt([
    {
      type: "input",
      name: "url",
      message: "Enter the URL to crawl:",
      validate: (input: string) => {
        if (!input.trim()) return true;
        try {
          new URL(input);
          return true;
        } catch {
          return "Please enter a valid URL";
        }
      },
    },
  ]);

  if (!url.trim()) {
    await showMainMenu();
    return;
  }

  // Get limit after confirming URL
  const { limit } = await inquirer.prompt([
    {
      type: "number",
      name: "limit",
      message: "Enter the maximum number of pages to crawl:",
      default: 50,
    },
  ]);

  console.log(
    chalk.blue(`Firecrawl is crawling ${url} with limit ${limit}...`)
  );

  try {
    // Perform the crawl
    crawlResult = await lib.crawl.crawlWebsite(url, { limit }, firecrawlKey);

    // Extract documents from the crawl result
    const documents = lib.crawl.extractDocuments(crawlResult);

    // Generate identifier first
    identifier = await lib.ai.generateIdentifier(documents, openai);

    // Save crawl result to history with identifier
    const crawlPath = await lib.storage.saveCrawlToHistory(
      crawlResult,
      identifier
    );

    // Generate categories
    categories = await lib.ai.categorizeSites(documents, openai);
    await lib.storage.saveCategories(
      categories,
      crawlPath,
      "original-categories.json"
    );

    // Save to the working file as well
    await lib.storage.saveCategories(categories, crawlPath, "categories.json");

    // Save identifier
    await lib.storage.saveIdentifier(identifier, crawlPath);

    // Set this as the current crawl
    await lib.storage.setCurrentCrawlPointer(crawlPath);

    // Sanitize categories
    categories = lib.processing.sanitizeCategories(categories, crawlResult);

    // Show processing menu
    await showProcessingMenu();
  } catch (error) {
    console.error(chalk.red("Error crawling website:"), error);
    await showMainMenu();
  }
}

/**
 * Opens an existing crawl
 */
async function openExistingCrawl() {
  const crawls = await lib.storage.listCrawls();
  if (crawls.length === 0) {
    console.clear();
    console.log(chalk.yellow("No existing crawls found."));
    await showMainMenu(false);
    return;
  }

  const { selectedCrawl } = await inquirer.prompt([
    {
      type: "list",
      name: "selectedCrawl",
      message: "Select a crawl to open:",
      choices: [...crawls, "cancel"],
    },
  ]);

  if (selectedCrawl === "cancel") {
    await showMainMenu();
    return;
  }

  try {
    const crawlPath = path.join(
      lib.storage.DEFAULT_PATHS.historyDir,
      selectedCrawl
    );

    // Set this as the current crawl
    await lib.storage.setCurrentCrawlPointer(crawlPath);

    // Load the crawl data
    const loadedCrawlResult = await lib.storage.loadCrawlResult(crawlPath);
    const loadedCategories = await lib.storage.loadCategories(crawlPath);
    const loadedIdentifier = await lib.storage.loadIdentifier(crawlPath);

    if (!loadedCrawlResult || !loadedCategories || !loadedIdentifier) {
      console.log(chalk.yellow("Missing data from selected crawl."));
      await showMainMenu();
      return;
    }

    // Update state variables
    crawlResult = loadedCrawlResult;
    categories = loadedCategories;
    identifier = loadedIdentifier;

    // Sanitize categories
    categories = lib.processing.sanitizeCategories(categories, crawlResult);

    await showProcessingMenu();
  } catch (error) {
    console.error(chalk.red("Error loading crawl:"), error);
    await showMainMenu();
  }
}

/**
 * Deletes a crawl
 */
async function deleteCrawl() {
  const crawls = await lib.storage.listCrawls();
  if (crawls.length === 0) {
    console.log(chalk.yellow("No existing crawls found."));
    await showMainMenu();
    return;
  }

  const { selectedCrawl } = await inquirer.prompt([
    {
      type: "list",
      name: "selectedCrawl",
      message: "Select a crawl to delete:",
      choices: [...crawls, "cancel"],
    },
  ]);

  if (selectedCrawl === "cancel") {
    await showMainMenu();
    return;
  }

  const { confirm } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: `Are you sure you want to delete ${selectedCrawl}?`,
    },
  ]);

  if (confirm) {
    await lib.storage.deleteCrawl(selectedCrawl);
    console.log(chalk.green(`Successfully deleted ${selectedCrawl}`));
  }

  await showMainMenu();
}

/**
 * Shows the processing menu
 */
async function showProcessingMenu() {
  await showCategoriesSummary();

  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: "What would you like to do?",
      choices: [
        {
          name: "View/prune documents (In case we crawled some junk)",
          value: "view",
        },
        { name: "Export & clean documents", value: "clean_export" },
        {
          name: "Export raw documents (No AI cleanup, faster)",
          value: "export",
        },
        { name: "Back to Main Menu", value: "back" },
      ],
    },
  ]);

  switch (action) {
    case "view":
      await viewExpandedCategories();
      await showProcessingMenu();
      break;
    case "clean_export":
    case "export":
      const shouldClean = action === "clean_export";
      const allContentLength = lib.processing.estimateTokensForAllDocuments(
        categories,
        crawlResult
      );
      const averageContentLength = Math.ceil(
        allContentLength / categories.categories.length
      );

      const { concatAction } = await inquirer.prompt([
        {
          type: "list",
          name: "concatAction",
          message: "How would you like to concatenate the documents?",
          choices: [
            {
              name: `All to one file ~ ${allContentLength} tokens`,
              value: "single",
            },
            {
              name: `One file per category ~ ${averageContentLength} tokens`,
              value: "multiple",
            },
            { name: "Back", value: "back" },
          ],
        },
      ]);

      if (concatAction === "back") {
        await showProcessingMenu();
        break;
      }

      await writeDocumentsToFile(
        concatAction as "single" | "multiple",
        shouldClean
      );
      await showProcessingMenu();
      break;
    case "back":
      await showMainMenu();
      break;
  }
}

/**
 * Shows a menu for viewing the expanded categories and allows pruning and splitting
 */
async function viewExpandedCategories() {
  // Create formatted content for each category
  const categoryContent = categories.categories.map((c) => {
    const title = `## ${c.category}`;
    const formattedSiteData = c.refUrls.map((u) => {
      const siteData = crawlResult.data.find((d) => d.metadata?.url === u);
      const estTokens = lib.processing.estimateTokens(siteData?.markdown || "");
      const title = `**${siteData?.metadata?.title}** ~ ${estTokens} tokens`;
      const description = `${
        siteData?.metadata?.description || "No description"
      }`;
      const url = `*${siteData?.metadata?.url}*`;
      return `${title}\n${url}\n\n${description}\n`;
    });
    return `${title}\n${formattedSiteData.join("\n\n")}`;
  });

  let currentIndex = 0;
  let done = false;

  while (!done) {
    // Show content first
    console.clear();
    console.log(cliMarkdown(categoryContent[currentIndex]));
    console.log(`\nPage ${currentIndex + 1} of ${categoryContent.length}`);

    const currentCategory = categories.categories[currentIndex];
    const estTokens = lib.processing.estimateTokensForCategory(
      currentCategory,
      crawlResult
    );

    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: `Navigation - ${currentCategory.category} ~ ${estTokens} tokens`,
        choices: [
          ...(currentIndex < categoryContent.length - 1
            ? [{ name: "Next Page", value: "next" }]
            : []),
          ...(currentIndex > 0
            ? [{ name: "Previous Page", value: "prev" }]
            : []),
          {
            name: `Prune documents (Guided removal wizard)`,
            value: "prune",
          },
          {
            name: `Split category into multiple categories (AI)`,
            value: "split",
          },
          { name: "Back to menu", value: "back" },
        ],
        pageSize: 10,
      },
    ]);

    switch (action) {
      case "next":
        currentIndex = Math.min(currentIndex + 1, categoryContent.length - 1);
        break;
      case "prev":
        currentIndex = Math.max(currentIndex - 1, 0);
        break;
      case "split":
        // Add confirmation prompt
        const { confirmSplit } = await inquirer.prompt([
          {
            type: "confirm",
            name: "confirmSplit",
            message: `Are you sure you want to split "${currentCategory.category}" into multiple categories using AI? This will recategorize ${currentCategory.refUrls.length} sites.`,
          },
        ]);

        if (!confirmSplit) {
          console.log(chalk.yellow("Category split cancelled."));
          break;
        }

        // Gather sites in current category for AI recategorization
        const sitesToSplit = currentCategory.refUrls.map((url) => {
          const siteData = crawlResult.data.find(
            (d) => d.metadata?.url === url
          );
          return {
            url: siteData?.metadata?.url || url,
            title: siteData?.metadata?.title || url,
            description: siteData?.metadata?.description || "",
            content: siteData?.markdown || "",
          };
        });

        try {
          // Use AI to recategorize this subset
          const newCategories = await lib.ai.categorizeSites(
            sitesToSplit,
            openai
          );

          // Check for duplicate categories and merge if found
          for (const newCat of newCategories.categories) {
            const existingCat = categories.categories.find(
              (c) =>
                c.category.toLowerCase() === newCat.category.toLowerCase() &&
                c !== currentCategory
            );

            if (existingCat) {
              // Merge with existing category
              existingCat.refUrls = [
                ...new Set([...existingCat.refUrls, ...newCat.refUrls]),
              ];
              console.log(
                chalk.yellow(
                  `Merged with existing category: ${newCat.category}`
                )
              );
            } else {
              // Add as new category
              categories.categories.push(newCat);
              console.log(
                chalk.green(`Created new category: ${newCat.category}`)
              );
            }
          }

          // Remove the original category
          categories.categories = categories.categories.filter(
            (c) => c !== currentCategory
          );

          // Update category content
          const newCategoryContent = categories.categories.map((c) => {
            const title = `## ${c.category}`;
            const formattedSiteData = c.refUrls.map((u) => {
              const siteData = crawlResult.data.find(
                (d) => d.metadata?.url === u
              );
              const estTokens = lib.processing.estimateTokens(
                siteData?.markdown || ""
              );
              const title = `**${siteData?.metadata?.title}** ~ ${estTokens} tokens`;
              const description = `${
                siteData?.metadata?.description || "No description"
              }`;
              const url = `*${siteData?.metadata?.url}*`;
              return `${title}\n${url}\n\n${description}\n`;
            });
            return `${title}\n${formattedSiteData.join("\n\n")}`;
          });

          // Update the category content array
          categoryContent.splice(
            0,
            categoryContent.length,
            ...newCategoryContent
          );

          // Adjust current index if needed
          if (categoryContent.length === 0) {
            done = true; // Exit if no categories left
          } else {
            currentIndex = Math.min(currentIndex, categoryContent.length - 1);
          }

          // Save updated categories
          await lib.storage.saveCategories(
            categories,
            await lib.storage.getCurrentCrawlPath(),
            "categories.json"
          );

          // Show the changes
          console.log(chalk.blue("\nCategory Split Results:"));
          for (const cat of newCategories.categories) {
            console.log(chalk.blue(`\n${cat.category}:`));
            for (const url of cat.refUrls) {
              const siteData = crawlResult.data.find(
                (d) => d.metadata?.url === url
              );
              console.log(chalk.gray(`- ${siteData?.metadata?.title || url}`));
            }
          }

          // Wait for user to review changes
          await inquirer.prompt([
            {
              type: "input",
              name: "continue",
              message: "Press enter to continue...",
            },
          ]);
        } catch (error) {
          console.error(chalk.red("Failed to split category:", error));
          await inquirer.prompt([
            {
              type: "input",
              name: "continue",
              message: "Press enter to continue...",
            },
          ]);
        }
        break;
      case "prune":
        const { selectedSites } = await inquirer.prompt([
          {
            type: "checkbox",
            name: "selectedSites",
            message: `Select sites to remove from ${currentCategory.category}:`,
            choices: [
              ...currentCategory.refUrls.map((url) => {
                const siteData = crawlResult.data.find(
                  (d) => d.metadata?.url === url
                );
                return {
                  name: `${siteData?.metadata?.title || url}\n${url}`,
                  value: url,
                };
              }),
              { name: "Cancel", value: "cancel" },
            ],
          },
        ]);

        if (selectedSites.includes("cancel")) {
          console.log(chalk.yellow("Pruning cancelled."));
          break;
        }

        // Use the processing library to prune URLs
        categories = lib.processing.pruneUrlsFromCategory(
          categories,
          currentCategory.category,
          selectedSites
        );

        // Remove empty categories
        categories = {
          categories: categories.categories.filter((c) => c.refUrls.length > 0),
        };

        // Rebuild the entire categoryContent array from scratch
        const newContent = categories.categories.map((c) => {
          const title = `## ${c.category}`;
          const formattedSiteData = c.refUrls.map((u) => {
            const siteData = crawlResult.data.find(
              (d) => d.metadata?.url === u
            );
            const estTokens = lib.processing.estimateTokens(
              siteData?.markdown || ""
            );
            const title = `**${siteData?.metadata?.title}** ~ ${estTokens} tokens`;
            const description = `${
              siteData?.metadata?.description || "No description"
            }`;
            const url = `*${siteData?.metadata?.url}*`;
            return `${title}\n${url}\n\n${description}\n`;
          });
          return `${title}\n${formattedSiteData.join("\n\n")}`;
        });

        // Replace the content of categoryContent
        categoryContent.splice(0, categoryContent.length, ...newContent);

        // Adjust current index if needed
        if (categoryContent.length === 0) {
          done = true; // Exit if no categories left
        } else {
          currentIndex = Math.min(currentIndex, categoryContent.length - 1);
        }

        // Save pruned categories
        await lib.storage.saveCategories(
          categories,
          await lib.storage.getCurrentCrawlPath(),
          "categories.json"
        );

        console.log(chalk.green("Sites pruned successfully!"));
        break;
      case "back":
        done = true;
        console.clear();
        break;
    }
  }
}

/**
 * Writes documents to file
 */
async function writeDocumentsToFile(
  concatAction: "single" | "multiple",
  shouldClean: boolean
) {
  const currentPath = await lib.storage.getCurrentCrawlPath();
  const outputDir = path.join(currentPath, "output");
  await lib.storage.ensureDirectory(outputDir);

  try {
    const outputFiles = await lib.processing.writeDocumentsToFile(
      categories,
      identifier,
      crawlResult,
      outputDir,
      openai,
      concatAction,
      shouldClean
    );

    console.log(chalk.green(`Documents written to:`));
    for (const file of outputFiles) {
      console.log(chalk.blue(`- ${file}`));
    }
  } catch (error) {
    console.error(chalk.red("Error writing documents to file:"), error);
  }
}

/**
 * Shows a summary of the categories
 */
async function showCategoriesSummary() {
  const allTokens = lib.processing.estimateTokensForAllDocuments(
    categories,
    crawlResult
  );

  console.log("");
  console.log(
    chalk.underline(
      `Documents: ${
        categories.categories.flatMap((c) => c.refUrls).length
      } - Categories: ${categories.categories.length} ~ ${allTokens} tokens`
    )
  );

  for (const category of categories.categories) {
    const tokens = lib.processing.estimateTokensForCategory(
      category,
      crawlResult
    );
    console.log(
      chalk.green(
        `${category.category} (${category.refUrls.length} documents) ~ ${tokens} tokens`
      )
    );
    console.log("");
  }
}

/**
 * Opens the data directory in the file explorer
 */
async function openDataDirectory() {
  const { platform } = process;
  let command = "";

  switch (platform) {
    case "darwin":
      command = "open";
      break;
    case "win32":
      command = "explorer";
      break;
    default:
      command = "xdg-open";
  }

  try {
    await runTerminalCommand(`${command} ${lib.storage.DEFAULT_PATHS.dataDir}`);
    console.log(
      chalk.green(`Opened ${lib.storage.DEFAULT_PATHS.dataDir} directory`)
    );
  } catch (error) {
    console.error(chalk.red("Error opening data directory:"), error);
  }

  await showMainMenu();
}

/**
 * Manages configuration settings
 */
async function manageConfiguration(clear = true) {
  if (clear) {
    console.clear();
  }
  // Load current config
  const config = (await lib.storage.loadConfig()) || {};

  console.log(chalk.blue("\nCurrent Configuration:"));
  console.log(
    chalk.gray("API Keys are stored in:"),
    chalk.green(lib.storage.DEFAULT_PATHS.configDir)
  );

  if (config.firecrawlApiKey) {
    console.log(
      chalk.gray("Firecrawl API Key:"),
      chalk.green("•".repeat(5) + config.firecrawlApiKey.slice(-4))
    );
  } else {
    console.log(chalk.gray("Firecrawl API Key:"), chalk.red("Not set"));
  }

  if (config.openaiApiKey) {
    console.log(
      chalk.gray("OpenAI API Key:"),
      chalk.green("•".repeat(5) + config.openaiApiKey.slice(-4))
    );
  } else {
    console.log(chalk.gray("OpenAI API Key:"), chalk.red("Not set"));
  }

  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: "What would you like to do?",
      choices: [
        { name: "Update Firecrawl API key", value: "firecrawl" },
        { name: "Update OpenAI API key", value: "openai" },
        { name: "Open config directory", value: "open" },
        { name: "Back to main menu", value: "back" },
      ],
    },
  ]);

  switch (action) {
    case "firecrawl":
      const { firecrawlKey } = await inquirer.prompt([
        {
          type: "input",
          name: "firecrawlKey",
          message: "Enter your Firecrawl API Key:",
        },
      ]);

      if (!firecrawlKey.trim()) {
        console.log(chalk.yellow("No API key entered, returning to menu."));
        await manageConfiguration();
        break;
      }

      await lib.storage.saveConfig({
        ...config,
        firecrawlApiKey: firecrawlKey.trim(),
      });
      console.log(chalk.green("Firecrawl API Key updated successfully!"));
      await manageConfiguration();
      break;

    case "openai":
      const { openaiKey } = await inquirer.prompt([
        {
          type: "input",
          name: "openaiKey",
          message: "Enter your OpenAI API Key:",
        },
      ]);

      if (!openaiKey.trim()) {
        console.log(chalk.yellow("No API key entered, returning to menu."));
        await manageConfiguration();
        break;
      }

      await lib.storage.saveConfig({
        ...config,
        openaiApiKey: openaiKey.trim(),
      });
      console.log(chalk.green("OpenAI API Key updated successfully!"));
      await manageConfiguration();
      break;

    case "open":
      const { platform } = process;
      let command = "";

      switch (platform) {
        case "darwin":
          command = "open";
          break;
        case "win32":
          command = "explorer";
          break;
        default:
          command = "xdg-open";
      }

      try {
        await runTerminalCommand(
          `${command} ${lib.storage.DEFAULT_PATHS.configDir}`
        );
        console.log(
          chalk.green(`Opened ${lib.storage.DEFAULT_PATHS.configDir} directory`)
        );
      } catch (error) {
        console.error(chalk.red("Error opening config directory:"), error);
      }

      await manageConfiguration();
      break;

    case "back":
      await showMainMenu();
      break;
  }
}
