# 💩 LLMDump

> Automatically crawl documentation, clean up extra markup, and write to markdown for use with LLMs

## 🚀 Features

- 🔍 Crawl documentation sites with configurable depth
- 🧹 AI Clean up of extra markup and formatting (optional)
- 📚 Automatically categorizes content for better splitting into token friendly chunks
- 📝 Export raw or AI cleaned markdown files
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

### Main Menu

When you run `llmdump`, you'll see the main menu with these options:

```
┌─────────────────┐
│     LLMDump     │
│ v[current-ver]  │
└─────────────────┘

? What would you like to do?
❯ Start new crawl
  Open existing crawl
  Delete crawl
  Manage configuration
  Exit
```

### Start New Crawl

1. Enter the URL to crawl
2. Set the maximum number of pages to crawl (default: 50)
3. Wait for crawling and AI processing to complete
4. View the processing menu

### Processing Menu

After crawling, you'll see a summary of documents and categories, then:

```
? What would you like to do?
❯ View/prune documents (In case we crawled some junk)
  Export & clean documents
  Export raw documents (No AI cleanup, faster)
  Back to Main Menu
```

### Document Management

When viewing documents, you can:

- Navigate between categories
- Prune documents (remove unwanted content)
- Split categories using AI
- View token estimates for each category

### Export Options

When exporting, choose between:

1. Single file (all content in one markdown file)
2. Multiple files (one file per category)

The tool will show token estimates for each option to help you choose.

### Configuration Management

Access configuration settings to:

- Update Firecrawl API key
- Update OpenAI API key
- Open config directory
- Return to main menu

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT
