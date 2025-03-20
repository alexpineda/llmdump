import { crawl } from "./lib/firecrawl";
import { generateObject, generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import type { CrawlStatusResponse } from "@mendable/firecrawl-js";
import fs from "node:fs";
import path from "node:path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import cliMarkdown from "cli-markdown";
import chalk from "chalk";
import inquirer from "inquirer";
import { url } from "node:inspector";

const dataDir = ".data";
const currentCrawlDir = path.join(dataDir, "current-crawl");
const historyDir = path.join(dataDir, "history");

function ensureDirectory(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

ensureDirectory(dataDir);
ensureDirectory(currentCrawlDir);
ensureDirectory(historyDir);

let crawlResult: CrawlStatusResponse;

const argv = yargs(hideBin(process.argv))
  .option("crawlUrl", {
    type: "string",
    description: "The URL to crawl",
    required: true,
    alias: "u",
  })
  .option("limit", {
    type: "number",
    alias: "l",
    description: "The number of pages to crawl",
    default: 10,
  })
  .option("api-key", {
    type: "string",
    alias: "k",
    description: "The API key for Firecrawl",
  })
  .parseSync();

const apiKey = argv["api-key"] || process.env.FIRECRAWL_API_KEY;

if (!apiKey) {
  console.error(
    "Please provide an API key for Firecrawl either as an argument or as an environment variable"
  );
  process.exit(1);
}

if (fs.existsSync(path.join(currentCrawlDir, "crawlResult.json"))) {
  crawlResult = JSON.parse(
    await fs.promises.readFile(
      path.join(currentCrawlDir, "crawlResult.json"),
      "utf-8"
    )
  );
} else {
  crawlResult = await crawl(argv.crawlUrl, { limit: argv.limit }, apiKey);
  await fs.promises.writeFile(
    path.join(currentCrawlDir, "crawlResult.json"),
    JSON.stringify(crawlResult, null, 2)
  );
}

const orderInput = crawlResult.data.map((d: any) => ({
  url: d.metadata.url,
  title: d.metadata.title,
  description: d.metadata.description,
}));

// console.log(orderInput);

const identifierSchema = z.object({
  identifier: z.string(),
});

type IdentifierSchema = z.infer<typeof identifierSchema>;

let identifier: IdentifierSchema;

if (fs.existsSync(path.join(currentCrawlDir, "identifier.json"))) {
  identifier = JSON.parse(
    await fs.promises.readFile(
      path.join(currentCrawlDir, "identifier.json"),
      "utf-8"
    )
  );
} else {
  const result = await generateObject({
    model: openai("gpt-4o-mini"),
    schema: identifierSchema,
    prompt: `Provide a unique identifier for the following links: ${orderInput
      .map((d) => `${d.url} - ${d.title} - ${d.description}`)
      .join("\n")}
      
      The identifier should be a unique identifier for the links.
      It should be a short string that is easy to remember.


      Example:
      {
        "identifier": "tanstack-router-react-docs"
      }
  
      Your output should be a JSON object with the following fields:
      - identifier: a unique identifier for the links
      `,
  });

  identifier = result.object;

  await fs.promises.writeFile(
    path.join(currentCrawlDir, "identifier.json"),
    JSON.stringify(identifier, null, 2)
  );
}
const categorySchema = z.object({
  categories: z.array(
    z.object({
      category: z.string(),
      refUrls: z.array(z.string()),
    })
  ),
});

type CategorySchema = z.infer<typeof categorySchema>;

let categories: CategorySchema;

async function categorizeSites(
  sites: { url: string; title: string; description: string }[]
) {
  const result = await generateObject({
    model: openai("gpt-4o-mini"),
    schema: categorySchema,
    prompt: `Order the following links by semantic categories: ${sites
      .map((d) => `${d.url} - ${d.title} - ${d.description}`)
      .join("\n")}
        
        Categories should be relavent to the content of the links.
        We'll use the categories to concatenate the content of the links together.
    
        Your output should be a JSON object with the following fields:
        - categories: an array of objects with the following fields:
          - category: the category of the link
          - refUrls: an array of URLs that are related to the category
        `,
  });

  return result.object;
}

if (fs.existsSync(path.join(currentCrawlDir, "original-categories.json"))) {
  categories = JSON.parse(
    await fs.promises.readFile(
      path.join(currentCrawlDir, "original-categories.json"),
      "utf-8"
    )
  );
} else {
  // order these by semantic categories
  const result = await generateObject({
    model: openai("gpt-4o-mini"),
    schema: categorySchema,
    prompt: `Order the following links by semantic categories: ${orderInput
      .map((d) => `${d.url} - ${d.title} - ${d.description}`)
      .join("\n")}
    
    Categories should be relavent to the content of the links.
    We'll use the categories to concatenate the content of the links together.

    Your output should be a JSON object with the following fields:
    - categories: an array of objects with the following fields:
      - category: the category of the link
      - refUrls: an array of URLs that are related to the category
    `,
  });

  //   console.log(result.object);
  categories = result.object;

  await fs.promises.writeFile(
    path.join(currentCrawlDir, "original-categories.json"),
    JSON.stringify(result.object, null, 2)
  );
}
categories.categories = categories.categories
  .filter((c) => c.refUrls.length > 0)
  .map((c) => ({
    ...c,
    refUrls: c.refUrls.filter((u) =>
      crawlResult.data.find((d) => d.metadata?.url === u)
    ),
  }));

async function categoriesSummary() {
  const allTokens = estimateTokensForAllDocuments();
  console.log(
    chalk.green(
      `Documents found ${
        categories.categories.flatMap((c) => c.refUrls).length
      } - Categories found ${
        categories.categories.length
      } ~ ${allTokens} tokens`
    )
  );
  for (const category of categories.categories) {
    const tokens = estimateTokensForCategory(category);
    console.log(
      chalk.green(
        `Category: ${category.category} (${category.refUrls.length}) ~ ${tokens} tokens`
      )
    );
  }
}

categoriesSummary();

async function viewExpandedCategories() {
  const categoryContent = categories.categories.map((c) => {
    const title = `## ${c.category}`;
    const formattedSiteData = c.refUrls.map((u) => {
      const siteData = crawlResult.data.find((d) => d.metadata?.url === u);
      const title = `**${siteData?.metadata?.title}**`;
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
    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: `Navigation - ${currentCategory.category}`,
        choices: [
          { name: "Next Page", value: "next" },
          { name: "Previous Page", value: "prev" },
          {
            name: `Prune Sites from ${currentCategory.category}`,
            value: "prune",
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

        // Remove selected sites from the category
        currentCategory.refUrls = currentCategory.refUrls.filter(
          (url) => !selectedSites.includes(url)
        );

        // Update the content for this category
        categoryContent[currentIndex] = `## ${
          currentCategory.category
        }\n${currentCategory.refUrls
          .map((u) => {
            const siteData = crawlResult.data.find(
              (d) => d.metadata?.url === u
            );
            const description = `**Description:** ${siteData?.metadata?.description}`;
            const url = `**URL:** ${siteData?.metadata?.url}`;
            return `${url}\n\n${description}\n`;
          })
          .join("\n")}`;

        // Remove empty categories
        if (currentCategory.refUrls.length === 0) {
          categories.categories = categories.categories.filter(
            (c) => c.refUrls.length > 0
          );
          categoryContent.splice(currentIndex, 1);
          currentIndex = Math.min(currentIndex, categoryContent.length - 1);
        }

        // Save pruned categories
        await fs.promises.writeFile(
          path.join(currentCrawlDir, "finalized-categories.json"),
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

function estimateTokens(content: string) {
  return Math.ceil(content.length / 4);
}

function estimateTokensForCategory(category: any) {
  return category.refUrls.reduce((acc: number, u: any) => {
    const siteData = crawlResult.data.find((d) => d.metadata?.url === u);
    return acc + estimateTokens(siteData?.markdown ?? "");
  }, 0);
}

function estimateTokensForAllDocuments() {
  return categories.categories.reduce((acc: number, c: any) => {
    return acc + estimateTokensForCategory(c);
  }, 0);
}

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
        { name: "Exit", value: "exit" },
      ],
    },
  ]);

  switch (action) {
    case "summary":
      categoriesSummary();
      await showProcessingMenu();
      break;
    case "view":
      await viewExpandedCategories();
      await showProcessingMenu();
      break;
    case "concat":
      const allContentLength = estimateTokensForAllDocuments();

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
              name:
                "All to one file (estimated tokens: " + allContentLength + ")",
              value: "single",
            },
            {
              name:
                "One file per category (avg est. tokens: " +
                averageContentLength +
                ")",
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

      if (concatAction === "single") {
        const outputDir = path.join(currentCrawlDir, "output");
        ensureDirectory(outputDir);

        const outputPath = path.join(outputDir, `${identifier.identifier}.md`);

        fs.writeFileSync(outputPath, "");

        for (const category of categories.categories) {
          await fs.promises.appendFile(
            outputPath,
            `# ${category.category}\n\n`
          );
          for (const url of category.refUrls) {
            const siteData = crawlResult.data.find(
              (d) => d.metadata?.url === url
            );
            if (siteData?.metadata?.title && siteData?.metadata?.url) {
              console.log(chalk.bgGrey(`cleaning ${siteData.metadata.url}`));
              const cleanedContent = await cleanupMarkdownDocument(
                siteData.markdown!
              );
              const title = `## ${siteData.metadata.title}`;
              const url = `[${siteData.metadata.url}](${siteData.metadata.url})`;
              await fs.promises.appendFile(
                outputPath,
                `${title}\n${url}\n\n${cleanedContent}\n\n`
              );
            }
          }
        }

        console.log(
          chalk.green(`Documents concatenated and saved to ${outputPath}`)
        );
      } else {
        const outputDir = path.join(currentCrawlDir, "output");
        ensureDirectory(outputDir);

        for (const category of categories.categories) {
          const outputPath = path.join(
            outputDir,
            `${identifier.identifier}-${category.category
              .toLowerCase()
              .replace(/\s+/g, "-")}.md`
          );
          fs.writeFileSync(outputPath, `# ${category.category}\n\n`);

          for (const url of category.refUrls) {
            const siteData = crawlResult.data.find(
              (d) => d.metadata?.url === url
            );
            if (siteData?.metadata?.title && siteData?.metadata?.url) {
              console.log(chalk.bgGrey(`cleaning ${siteData.metadata.url}`));
              const cleanedContent = await cleanupMarkdownDocument(
                siteData.markdown!
              );
              const title = `## ${siteData.metadata.title}`;
              const url = `[${siteData.metadata.url}](${siteData.metadata.url})`;
              await fs.promises.appendFile(
                outputPath,
                `${title}\n${url}\n\n${cleanedContent}\n\n`
              );
            }
          }
        }

        console.log(
          chalk.green(`Documents concatenated and saved to ${outputDir}`)
        );
      }

      await showProcessingMenu();
      break;
    case "exit":
      console.log(chalk.blue("Goodbye!"));
      process.exit(0);
      break;
  }
}

await showProcessingMenu();

async function cleanupMarkdownDocument(document: string) {
  const result = await generateText({
    model: openai("gpt-4o-mini"),
    prompt: `Clean the following document. Remove extranous markup, links, etc. Keep only the content that is relevant to the topic such as explanations, code examples, etc: 

    Please return the cleaned content as a markdown document. Do not include any other text or markup.
   
    <content>
    ${document}
    </content>
    `,
  });
  return result.text;
}
