import { generateObject, generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type {
  CrawledDocument,
  CategorySchema,
  IdentifierSchema,
} from "./types.js";
import { categorySchema, identifierSchema } from "./types.js";

// Define type for OpenAI instance
export type OpenAIInstance = ReturnType<typeof createOpenAI>;

/**
 * Categorizes crawled sites into semantic categories
 * @param sites Array of crawled documents
 * @param openai OpenAI instance
 * @returns A categorization of the sites
 */
export async function categorizeSites(
  sites: CrawledDocument[],
  openai: OpenAIInstance
): Promise<CategorySchema> {
  if (!sites.length) {
    throw new Error("No sites provided for categorization");
  }

  const result = await generateObject({
    model: openai("gpt-4o-mini"),
    schema: categorySchema,
    prompt: `Order the following links by semantic categories: ${sites
      .map((d) => `${d.url} - ${d.title} - ${d.description}`)
      .join("\n")}
          
      Categories should be relevant to the content of the links.
      We'll use the categories to concatenate the content of the links together.
  
      Your output should be a JSON object with the following fields:
      - categories: an array of objects with the following fields:
        - category: the category of the link
        - refUrls: an array of URLs that are related to the category
      `,
  });

  return result.object;
}

/**
 * Generates a unique identifier for a collection of documents
 * @param documents Array of crawled documents
 * @param openai OpenAI instance
 * @returns An identifier object
 */
export async function generateIdentifier(
  documents: CrawledDocument[],
  openai: OpenAIInstance
): Promise<IdentifierSchema> {
  if (!documents.length) {
    throw new Error("No documents provided for identifier generation");
  }

  const result = await generateObject({
    model: openai("gpt-4o-mini"),
    schema: identifierSchema,
    prompt: `Create a descriptive identifier for this collection of documents. The identifier should:
    - Be a short, memorable string that describes the content
    - Use lowercase letters, numbers, and hyphens only
    - Include the main topic/technology/product name
    - Be between 3-5 words maximum
    - Not include timestamps or version numbers
    
    Documents to analyze:
    ${documents
      .map((d) => `${d.url} - ${d.title} - ${d.description}`)
      .join("\n")}
    
    Example good identifiers:
    - "react-router-docs"
    - "kubernetes-networking-guide" 
    - "typescript-handbook"
    - "aws-lambda-tutorial"
    
    Your output should be a JSON object with the following fields:
    - identifier: the descriptive identifier string
    `,
  });

  return result.object;
}

/**
 * Cleans a markdown document by removing extraneous markup, links, etc.
 * @param document The markdown document to clean
 * @param openai OpenAI instance
 * @returns The cleaned markdown document
 */
export async function cleanupMarkdownDocument(
  document: string,
  openai: OpenAIInstance
): Promise<string> {
  if (!document) {
    return "";
  }

  const result = await generateText({
    model: openai("gpt-4o-mini"),
    prompt: `Clean the following document. Remove extraneous markup, links, etc. Keep only the content that is relevant to the topic such as explanations, code examples, etc: 

    Please return the cleaned content as a markdown document. Do not include any other text or markup.
   
    <content>
    ${document}
    </content>
    `,
  });

  return result.text;
}
