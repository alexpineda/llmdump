import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import {
  sanitizeCategories,
  estimateTokens,
  estimateTokensForCategory,
  estimateTokensForAllDocuments,
  processDocument,
  processCategoryContent,
  extractHeaders,
  pruneUrlsFromCategory,
  writeDocumentsToFile,
} from "../processing.js";
import type { CategorySchema, CrawlStatusResponse } from "../types.js";
import type { OpenAIInstance } from "../ai.js";

// Use vi.hoisted to create mocks before they're used in vi.mock
const mockFunctions = vi.hoisted(() => {
  return {
    writeFileMock: vi.fn(() => Promise.resolve()),
    cleanupMarkdownDocument: vi.fn((content) =>
      Promise.resolve(`Cleaned: ${content}`)
    ),
  };
});

// Mock the AI module
vi.mock("../ai.js", () => ({
  cleanupMarkdownDocument: mockFunctions.cleanupMarkdownDocument,
}));

// Mock fs module with the hoisted mock - as default export to match how it's imported
vi.mock("node:fs/promises", () => {
  return {
    default: {
      writeFile: mockFunctions.writeFileMock,
    },
  };
});

describe("Processing Module", () => {
  let mockCrawlResult: CrawlStatusResponse;
  let mockCategories: CategorySchema;
  let mockOpenAI: OpenAIInstance;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Setup mock data
    mockCrawlResult = {
      data: [
        {
          metadata: {
            url: "https://example.com/page1",
            title: "Page 1",
          },
          markdown: "Content for page 1",
          actions: [],
        },
        {
          metadata: {
            url: "https://example.com/page2",
            title: "Page 2",
          },
          markdown: "Content for page 2",
          actions: [],
        },
        {
          metadata: {
            url: "https://example.com/page3",
            title: "Page 3",
          },
          markdown: "Content for page 3",
          actions: [],
        },
      ],
      status: "completed",
      error: null,
      id: "mock-crawl-id",
    } as unknown as CrawlStatusResponse;

    mockCategories = {
      categories: [
        {
          category: "Category 1",
          refUrls: [
            "https://example.com/page1",
            "https://example.com/page2",
            "https://nonexistent.com",
          ],
        },
        {
          category: "Category 2",
          refUrls: ["https://example.com/page3"],
        },
        {
          category: "Empty Category",
          refUrls: [],
        },
      ],
    };

    // Mock OpenAI instance
    mockOpenAI = {} as OpenAIInstance;
  });

  describe("sanitizeCategories", () => {
    it("should remove URLs that do not exist in the crawl result", () => {
      const sanitized = sanitizeCategories(mockCategories, mockCrawlResult);

      expect(sanitized.categories[0].refUrls).toHaveLength(2);
      expect(sanitized.categories[0].refUrls).toContain(
        "https://example.com/page1"
      );
      expect(sanitized.categories[0].refUrls).toContain(
        "https://example.com/page2"
      );
      expect(sanitized.categories[0].refUrls).not.toContain(
        "https://nonexistent.com"
      );

      // Other categories should remain unchanged
      expect(sanitized.categories[1].refUrls).toHaveLength(1);
      expect(sanitized.categories[2].refUrls).toHaveLength(0);
    });
  });

  describe("estimateTokens", () => {
    it("should correctly estimate tokens for a string", () => {
      expect(estimateTokens("This is a test string")).toBe(4.8);
      expect(estimateTokens("A")).toBe(0.8);
      expect(estimateTokens("")).toBe(0);
    });
  });

  describe("estimateTokensForCategory", () => {
    it("should correctly sum token estimates for all documents in a category", () => {
      const category = mockCategories.categories[0];

      const result = estimateTokensForCategory(category, mockCrawlResult);

      expect(result).toBeCloseTo(8, 0);
    });

    it("should handle categories with missing documents", () => {
      const category = {
        category: "Invalid Category",
        refUrls: ["https://nonexistent.com/page"],
      };

      const result = estimateTokensForCategory(category, mockCrawlResult);
      expect(result).toBe(0);
    });
  });

  describe("estimateTokensForAllDocuments", () => {
    it("should correctly sum token estimates for all categories", () => {
      const result = estimateTokensForAllDocuments(
        mockCategories,
        mockCrawlResult
      );

      expect(result).toBeCloseTo(12, 0);
    });

    it("should handle empty categories list", () => {
      const emptyCategories = { categories: [] };
      const result = estimateTokensForAllDocuments(
        emptyCategories,
        mockCrawlResult
      );
      expect(result).toBe(0);
    });
  });

  describe("processDocument", () => {
    it("should correctly process a document", async () => {
      const result = await processDocument(
        "https://example.com/page1",
        mockCrawlResult,
        mockOpenAI
      );

      expect(result).not.toBeNull();
      expect(result?.title).toBe("Page 1");
      expect(result?.url).toBe("https://example.com/page1");
      expect(result?.content).toBe("Cleaned: Content for page 1");
    });

    it("should return null for missing documents", async () => {
      const result = await processDocument(
        "https://nonexistent.com",
        mockCrawlResult,
        mockOpenAI
      );
      expect(result).toBeNull();
    });

    it("should return null for documents with missing fields", async () => {
      const incompleteResult = {
        ...mockCrawlResult,
        data: [
          {
            metadata: {
              url: "https://example.com/incomplete",
            },
            markdown: "Content",
            actions: [],
          },
        ],
      } as unknown as CrawlStatusResponse;

      const result = await processDocument(
        "https://example.com/incomplete",
        incompleteResult,
        mockOpenAI
      );
      expect(result).toBeNull();
    });
  });

  describe("processCategoryContent", () => {
    it("should process all documents in a category", async () => {
      const category = mockCategories.categories[0];
      const results = await processCategoryContent(
        category,
        mockCrawlResult,
        mockOpenAI
      );

      expect(results).toHaveLength(2);
      expect(results[0].title).toBe("Page 1");
      expect(results[1].title).toBe("Page 2");
    });

    it("should handle empty categories", async () => {
      const emptyCategory = { category: "Empty", refUrls: [] };
      const results = await processCategoryContent(
        emptyCategory,
        mockCrawlResult,
        mockOpenAI
      );

      expect(results).toHaveLength(0);
    });
  });

  describe("extractHeaders", () => {
    it("should extract headers from markdown content", async () => {
      const content = `# Header 1\nSome content\n## Header 2\nMore content\n### Header 3`;
      const headers = await extractHeaders(content);

      expect(headers).toHaveLength(3);
      expect(headers[0]).toBe("## Header 1");
      expect(headers[1]).toBe("### Header 2");
      expect(headers[2]).toBe("#### Header 3");
    });

    it("should handle content with no headers", async () => {
      const content = "Just some content without headers";
      const headers = await extractHeaders(content);

      expect(headers).toHaveLength(0);
    });
  });

  describe("pruneUrlsFromCategory", () => {
    it("should remove specified URLs from a category", () => {
      const result = pruneUrlsFromCategory(mockCategories, "Category 1", [
        "https://example.com/page1",
      ]);

      expect(result.categories[0].refUrls).toHaveLength(2);
      expect(result.categories[0].refUrls).not.toContain(
        "https://example.com/page1"
      );
      expect(result.categories[0].refUrls).toContain(
        "https://example.com/page2"
      );

      // Other categories should remain unchanged
      expect(result.categories[1].refUrls).toHaveLength(1);
    });

    it("should handle non-existent categories", () => {
      const result = pruneUrlsFromCategory(
        mockCategories,
        "Non-existent Category",
        ["https://example.com/page1"]
      );

      // All categories should remain unchanged
      expect(result).toEqual(mockCategories);
    });

    it("should handle empty URL list", () => {
      const result = pruneUrlsFromCategory(mockCategories, "Category 1", []);

      // All categories should remain unchanged
      expect(result).toEqual(mockCategories);
    });
  });

  describe("writeDocumentsToFile", () => {
    it("should write a single file in single mode", async () => {
      const identifier = { identifier: "test-identifier" };
      const outputDir = "/tmp/output";

      const result = await writeDocumentsToFile(
        mockCategories,
        identifier,
        mockCrawlResult,
        outputDir,
        mockOpenAI,
        "single"
      );

      expect(mockFunctions.writeFileMock).toHaveBeenCalledTimes(1);
      expect(mockFunctions.writeFileMock).toHaveBeenCalledWith(
        path.join(outputDir, "test-identifier.md"),
        expect.stringContaining("# test-identifier")
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(path.join(outputDir, "test-identifier.md"));
    });

    it("should write multiple files in multiple mode", async () => {
      const identifier = { identifier: "test-identifier" };
      const outputDir = "/tmp/output";

      const result = await writeDocumentsToFile(
        mockCategories,
        identifier,
        mockCrawlResult,
        outputDir,
        mockOpenAI,
        "multiple"
      );

      expect(mockFunctions.writeFileMock).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(2);
      expect(result[0]).toBe(
        path.join(outputDir, "test-identifier_Category_1.md")
      );
      expect(result[1]).toBe(
        path.join(outputDir, "test-identifier_Category_2.md")
      );
    });

    it("should skip empty categories", async () => {
      const categoriesWithEmpty = {
        categories: [
          {
            category: "Empty Category",
            refUrls: [],
          },
        ],
      };

      const identifier = { identifier: "test-identifier" };
      const outputDir = "/tmp/output";

      const result = await writeDocumentsToFile(
        categoriesWithEmpty,
        identifier,
        mockCrawlResult,
        outputDir,
        mockOpenAI,
        "multiple"
      );

      expect(mockFunctions.writeFileMock).not.toHaveBeenCalled();
      expect(result).toHaveLength(0);
    });
  });
});
