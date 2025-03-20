import { crawl } from "./lib/firecrawl";
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import type { CrawlStatusResponse } from "@mendable/firecrawl-js";
import fs from "node:fs";
import path from "node:path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import cliMarkdown from "cli-markdown";
import chalk from "chalk";

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
  crawlResult = await Bun.file(
    path.join(currentCrawlDir, "crawlResult.json")
  ).json();
} else {
  crawlResult = await crawl(argv.crawlUrl, { limit: argv.limit }, apiKey);
  Bun.write(
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
  identifier = await Bun.file(
    path.join(currentCrawlDir, "identifier.json")
  ).json();
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

  Bun.write(
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

if (fs.existsSync(path.join(currentCrawlDir, "categories.json"))) {
  categories = await Bun.file(
    path.join(currentCrawlDir, "categories.json")
  ).json();
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

  Bun.write(
    path.join(currentCrawlDir, "categories.json"),
    JSON.stringify(result.object, null, 2)
  );
}

console.log(chalk.green(`Categories found ${categories.categories.length}`));
for (const category of categories.categories) {
  console.log(
    chalk.green(`Category: ${category.category} (${category.refUrls.length})`)
  );
}

const formatted = categories.categories
  .map((c) => {
    const title = `## ${c.category}`;
    const formattedSiteData = c.refUrls.map((u) => {
      const siteData = crawlResult.data.find((d) => d.metadata.url === u);
      const description = `**Description:** ${siteData?.metadata.description}`;
      const url = `**URL:** ${siteData?.metadata.url}`;
      return `${url}\n\n${description}\n`;
    });
    const markdown = `${title}\n${formattedSiteData.join("\n")}`;
    return markdown;
  })
  .join("\n");

// console.log(cliMarkdown(formatted));
