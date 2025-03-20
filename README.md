# 🔥 LLMDump

```
_     _     __  __ ____
 | |   | |   |  \/  |  _ \ _   _ _ __ ___  _ __
 | |   | |   | |\/| | | | | | | | '_ ` _ \| '_ \
 | |___| |___| |  | | |_| | |_| | | | | | | |_) |
 |_____|_____|_|  |_|____/ \__,_|_| |_| |_| .__/
                                          |_|
```

> Automatically crawl documentation, clean up extra markup, and write to markdown for use with LLMs

## 🚀 Features

- 🔍 Crawl documentation sites with configurable depth
- 🧹 Clean up extra markup and formatting
- 📚 Automatically categorize content
- 📝 Generate clean markdown files
- 💾 Archive and manage multiple crawls
- 🔄 Interactive document pruning and category splitting
- 📊 Token estimation for LLM context windows

## 📦 Installation

```bash
npm install -g llmdump
```

## 🔑 Setup

You'll need two API keys:

1. Firecrawl API key for web crawling
2. OpenAI API key for content processing

Set them as environment variables or provide them via CLI:

```bash
export FIRECRAWL_API_KEY="your-firecrawl-key"
export OPENAI_API_KEY="your-openai-key"
```

Or use CLI flags:

```bash
llmdump --firecrawl-key "your-key" --openai-key "your-key"
```

## 🎯 Usage

### Basic Flow

```
┌─────────────────┐
│   Start Crawl   │
└────────┬────────┘
         ▼
┌─────────────────┐
│  View Summary   │
└────────┬────────┘
         ▼
┌─────────────────┐
│  Clean & Save   │
└────────┬────────┘
         ▼
┌─────────────────┐
│    Archive      │
└─────────────────┘
```

### Examples

1. Start a new crawl:

```bash
llmdump
# Follow interactive prompts to enter URL and crawl depth
```

2. Continue from existing crawl:

```bash
llmdump
# Select "Continue from [crawl-id]" from main menu
```

3. View archived crawls:

```bash
llmdump
# Select "View Archived Crawls" from main menu
```

### Directory Structure

```
.data/
├── current-crawl/          # Active crawl data
│   ├── crawlResult.json   # Raw crawl results
│   ├── identifier.json    # Unique crawl identifier
│   ├── categories.json    # Content categorization
│   └── output/           # Generated markdown files
└── history/              # Archived crawls
    └── [crawl-id]-[timestamp]/
```

## 🛠️ Processing Options

### View Documents Summary

```
┌─────────────────────────────────┐
│ Documents: 25                   │
│ Categories: 5                   │
│ Total Tokens: ~150,000         │
│                                 │
│ Category: Getting Started (8)   │
│ Category: API Reference (12)    │
│ Category: Examples (5)          │
└─────────────────────────────────┘
```

### Clean & Concat Options

1. Single file (all content)
2. Multiple files (one per category)

### Document Management

- Prune irrelevant content
- Split categories
- Archive crawls
- View and edit categories

## 🔍 Example Workflow

```bash
# 1. Start new crawl
llmdump
> Enter URL: https://docs.example.com
> Enter limit: 20

# 2. View summary
> Select "View Documents Summary"

# 3. Process documents
> Select "Clean & Concat Documents"
> Choose output format (single/multiple)

# 4. Archive
> Select "Archive This Crawl"
```

## 📝 Output Format

### Single File Output

```markdown
# Getting Started

## Introduction

[Content...]

# API Reference

## Endpoints

[Content...]
```

### Multiple Files Output

```
output/
├── getting-started.md
├── api-reference.md
└── examples.md
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT
