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

// Load environment variables
dotenv.config();

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

// Validate API keys
if (!firecrawlApiKey) {
  console.error(
    chalk.red(
      "Please provide an API key for Firecrawl either as an argument with --firecrawl-key or as an environment variable"
    )
  );
  process.exit(1);
}

if (!openaiApiKey) {
  console.error(
    chalk.red(
      "Please provide an API key for OpenAI either as an argument with --openai-key or as an environment variable"
    )
  );
  process.exit(1);
}

// Initialize OpenAI client
const openai = createOpenAI({
  apiKey: openaiApiKey,
});

// Initialize state variables
let crawlResult: lib.CrawlStatusResponse;
let categories: lib.CategorySchema;
let identifier: lib.IdentifierSchema;

// Initialize data directories
(async () => {
  try {
    await lib.storage.ensureDirectory(lib.storage.DEFAULT_PATHS.dataDir);
    await lib.storage.ensureDirectory(
      lib.storage.DEFAULT_PATHS.currentCrawlDir
    );
    await lib.storage.ensureDirectory(lib.storage.DEFAULT_PATHS.historyDir);
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
 * Starts a new crawl
 */
async function startNewCrawl() {
  const currentCrawlId = await getCurrentCrawlIdIfAny();
  if (currentCrawlId) {
    console.log(
      chalk.yellow(
        `A current crawl already exists: ${currentCrawlId}. What would you like to do?`
      )
    );

    // inquirer to archive current crawl or continue from it
    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: "What would you like to do?",
        choices: [
          { name: "Continue from Previous Crawl", value: "continue" },
          { name: "Archive & Start New Crawl", value: "archive" },
          { name: "Delete & Start New Crawl", value: "delete" },
          { name: "Cancel", value: "cancel" },
        ],
      },
    ]);

    if (action === "archive") {
      await archiveCrawl();
    } else if (action === "delete") {
      await deleteCurrentCrawl();
    } else if (action === "continue") {
      await continueFromCurrentCrawl();
      return;
    } else {
      await showMainMenu();
      return;
    }
  }

  // Get URL and limit from user
  const { url, limit } = await inquirer.prompt([
    {
      type: "input",
      name: "url",
      message: "Enter the URL to crawl:",
      validate: (input: string) => {
        try {
          new URL(input);
          return true;
        } catch {
          return "Please enter a valid URL";
        }
      },
    },
    {
      type: "number",
      name: "limit",
      message: "Enter the number of pages to crawl:",
      default: 10,
    },
  ]);

  console.log(chalk.blue(`Crawling ${url} with limit ${limit}...`));

  try {
    // Perform the crawl
    crawlResult = await lib.crawl.crawlWebsite(url, { limit }, firecrawlApiKey);

    // Save crawl result
    await lib.storage.saveCrawlResult(crawlResult);

    // Extract documents from the crawl result
    const documents = lib.crawl.extractDocuments(crawlResult);

    // Generate categories
    categories = await lib.ai.categorizeSites(documents, openai);
    await lib.storage.saveCategories(categories);

    // Save original categories for reference
    await fs.writeFile(
      path.join(
        lib.storage.DEFAULT_PATHS.currentCrawlDir,
        "original-categories.json"
      ),
      JSON.stringify(categories, null, 2)
    );

    // Generate identifier
    identifier = await lib.ai.generateIdentifier(documents, openai);
    await lib.storage.saveIdentifier(identifier);

    // Sanitize categories
    categories = lib.processing.sanitizeCategories(categories, crawlResult);

    // Show categories summary
    await showCategoriesSummary();

    // Show processing menu
    await showProcessingMenu();
  } catch (error) {
    console.error(chalk.red("Error crawling website:"), error);
    await showMainMenu();
  }
}

/**
 * Gets the current crawl identifier if any
 */
async function getCurrentCrawlIdIfAny() {
  const identifier = await lib.storage.loadIdentifier();
  return identifier?.identifier || null;
}

/**
 * Archives the current crawl
 */
async function archiveCrawl() {
  const identifier = await lib.storage.loadIdentifier();
  if (!identifier) {
    console.log(chalk.yellow("No current crawl to archive"));
    return;
  }

  const archiveDir = await lib.storage.archiveCrawl(identifier);
  console.log(chalk.green(`Archived crawl to ${archiveDir}`));
}

/**
 * Deletes the current crawl
 */
async function deleteCurrentCrawl() {
  await lib.storage.deleteCurrentCrawl();
  console.log(chalk.green(`Deleted current crawl`));
}

/**
 * Continues from the current crawl
 */
async function continueFromCurrentCrawl() {
  try {
    // Load data from storage
    crawlResult =
      (await lib.storage.loadCrawlResult()) as lib.CrawlStatusResponse;

    // Try to load original categories first, then fallback to regular categories
    try {
      const originalCategoriesPath = path.join(
        lib.storage.DEFAULT_PATHS.currentCrawlDir,
        "original-categories.json"
      );
      const content = await fs.readFile(originalCategoriesPath, "utf-8");
      categories = JSON.parse(content);
    } catch {
      categories = (await lib.storage.loadCategories()) as lib.CategorySchema;
    }

    identifier = (await lib.storage.loadIdentifier()) as lib.IdentifierSchema;

    if (!crawlResult || !categories || !identifier) {
      console.log(
        chalk.yellow("Missing data from current crawl. Starting a new crawl...")
      );
      await startNewCrawl();
      return;
    }

    // Sanitize categories
    categories = lib.processing.sanitizeCategories(categories, crawlResult);

    console.log(chalk.green(`Continuing from crawl: ${identifier.identifier}`));
    await showCategoriesSummary();
    await showProcessingMenu();
  } catch (error) {
    console.error(chalk.red("Error loading current crawl:"), error);
    await showMainMenu();
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

  console.log(
    chalk.green(
      `Documents found: ${
        categories.categories.flatMap((c) => c.refUrls).length
      } - Categories found: ${
        categories.categories.length
      } ~ ${allTokens} tokens`
    )
  );

  for (const category of categories.categories) {
    const tokens = lib.processing.estimateTokensForCategory(
      category,
      crawlResult
    );
    console.log(
      chalk.green(
        `Category: ${category.category} (${category.refUrls.length}) ~ ${tokens} tokens`
      )
    );
  }
}

/**
 * Writes documents to file
 */
async function writeDocumentsToFile(concatAction: "single" | "multiple") {
  const outputDir = path.join(
    lib.storage.DEFAULT_PATHS.currentCrawlDir,
    "output"
  );
  await lib.storage.ensureDirectory(outputDir);

  try {
    const outputFiles = await lib.processing.writeDocumentsToFile(
      categories,
      identifier,
      crawlResult,
      outputDir,
      openai,
      concatAction
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
 * Shows the main menu
 */
async function showMainMenu() {
  console.clear();
  console.log(
    boxen(
      chalk.blue("LLMDump") +
        "\n" +
        chalk.gray(
          "Automatically crawl documentation, clean up extra markup, and write to markdown for use with LLMs"
        ),
      { padding: 1 }
    )
  );
  console.log(
    chalk.yellow(
      "Warning: This is alpha software. It is not ready for production use."
    )
  );

  const currentCrawlId = await getCurrentCrawlIdIfAny();

  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: "What would you like to do?",
      choices: [
        ...(currentCrawlId
          ? [{ name: `Continue from ${currentCrawlId}`, value: "continue" }]
          : []),
        { name: "Start New Crawl", value: "new" },
        { name: "View Archived Crawls", value: "archives" },
        { name: "Delete Archived Crawl", value: "delete" },
        { name: "Open Data Directory", value: "open" },
        { name: "Exit", value: "exit" },
      ],
    },
  ]);

  switch (action) {
    case "new":
      await startNewCrawl();
      break;
    case "continue":
      await continueFromCurrentCrawl();
      break;
    case "archives":
      await viewArchivedCrawls();
      break;
    case "delete":
      await deleteArchivedCrawl();
      break;
    case "open":
      await openDataDirectory();
      break;
    case "exit":
      console.log(chalk.blue("Goodbye!"));
      process.exit(0);
  }
}

/**
 * Shows the processing menu
 */
async function showProcessingMenu() {
  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: "What would you like to do?",
      choices: [
        { name: "View Documents Summary", value: "summary" },
        { name: "View & Prune Documents", value: "view" },
        { name: "Clean & Concat Documents", value: "concat" },
        { name: "Archive This Crawl", value: "archive" },
        { name: "Back to Main Menu", value: "back" },
      ],
    },
  ]);

  switch (action) {
    case "archive":
      await archiveCrawl();
      await showMainMenu();
      break;
    case "summary":
      await showCategoriesSummary();
      await showProcessingMenu();
      break;
    case "view":
      await viewExpandedCategories();
      await showProcessingMenu();
      break;
    case "concat":
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

      await writeDocumentsToFile(concatAction as "single" | "multiple");
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
          { name: "Next Page", value: "next" },
          { name: "Previous Page", value: "prev" },
          {
            name: `Prune Sites from ${currentCategory.category}`,
            value: "prune",
          },
          {
            name: `Split Category ${currentCategory.category}`,
            value: "split",
          },
          { name: "Back to Menu", value: "back" },
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
          currentIndex = Math.min(currentIndex, categoryContent.length - 1);

          // Save updated categories
          await lib.storage.saveCategories(categories);
          await fs.writeFile(
            path.join(
              lib.storage.DEFAULT_PATHS.currentCrawlDir,
              "finalized-categories.json"
            ),
            JSON.stringify(categories, null, 2)
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

        // Update the content for this category
        const updatedCategoryContent = categories.categories.map((c) => {
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

        // Remove empty categories
        categories = {
          categories: categories.categories.filter((c) => c.refUrls.length > 0),
        };

        // Replace content array with updated content
        categoryContent.splice(
          0,
          categoryContent.length,
          ...updatedCategoryContent
        );
        currentIndex = Math.min(currentIndex, categoryContent.length - 1);

        // Save pruned categories
        await lib.storage.saveCategories(categories);
        await fs.writeFile(
          path.join(
            lib.storage.DEFAULT_PATHS.currentCrawlDir,
            "finalized-categories.json"
          ),
          JSON.stringify(categories, null, 2)
        );

        console.log(chalk.green("Sites pruned successfully!"));
        break;
      case "back":
        done = true;
        break;
    }
  }
}

/**
 * Views archived crawls
 */
async function viewArchivedCrawls() {
  const archives = await lib.storage.listArchivedCrawls();
  if (archives.length === 0) {
    console.log(chalk.yellow("No archived crawls found."));
    await showMainMenu();
    return;
  }

  const { selectedArchive } = await inquirer.prompt([
    {
      type: "list",
      name: "selectedArchive",
      message: "Select an archived crawl to view:",
      choices: [...archives, "cancel"],
    },
  ]);

  if (selectedArchive === "cancel") {
    await showMainMenu();
    return;
  }

  const archivePath = path.join(
    lib.storage.DEFAULT_PATHS.historyDir,
    selectedArchive
  );

  try {
    const archiveFiles = await fs.readdir(archivePath);

    console.log(chalk.green(`\nContents of ${selectedArchive}:`));
    for (const file of archiveFiles) {
      console.log(chalk.blue(`- ${file}`));
    }

    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: "What would you like to do with this archive?",
        choices: [
          { name: "Copy to Current Crawl", value: "copy" },
          { name: "Back", value: "back" },
        ],
      },
    ]);

    if (action === "copy") {
      const currentCrawlId = await getCurrentCrawlIdIfAny();
      if (currentCrawlId) {
        const { confirm } = await inquirer.prompt([
          {
            type: "confirm",
            name: "confirm",
            message: `A current crawl exists (${currentCrawlId}). Do you want to overwrite it?`,
          },
        ]);

        if (!confirm) {
          await showMainMenu();
          return;
        }

        // Delete current crawl
        await lib.storage.deleteCurrentCrawl();
      }

      // Copy archive to current crawl
      await fs.cp(archivePath, lib.storage.DEFAULT_PATHS.currentCrawlDir, {
        recursive: true,
      });
      console.log(
        chalk.green(`Successfully copied ${selectedArchive} to current crawl`)
      );

      // Load the copied data
      await continueFromCurrentCrawl();
    } else {
      await showMainMenu();
    }
  } catch (error) {
    console.error(chalk.red("Error accessing archive:"), error);
    await showMainMenu();
  }
}

/**
 * Deletes an archived crawl
 */
async function deleteArchivedCrawl() {
  const archives = await lib.storage.listArchivedCrawls();
  if (archives.length === 0) {
    console.log(chalk.yellow("No archived crawls found."));
    await showMainMenu();
    return;
  }

  const { selectedArchive } = await inquirer.prompt([
    {
      type: "list",
      name: "selectedArchive",
      message: "Select an archived crawl to delete:",
      choices: [...archives, "cancel"],
    },
  ]);

  if (selectedArchive === "cancel") {
    await showMainMenu();
    return;
  }

  const { confirm } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: `Are you sure you want to delete ${selectedArchive}?`,
    },
  ]);

  if (confirm) {
    await lib.storage.deleteArchivedCrawl(selectedArchive);
    console.log(chalk.green(`Successfully deleted ${selectedArchive}`));
  }

  await showMainMenu();
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
