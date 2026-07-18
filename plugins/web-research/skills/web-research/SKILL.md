---
name: web-research
description: Deep web search and content fetching via a local AI proxy. Use `web_search` and `web_fetch` MCP tools when Codex needs to search the web or fetch page content for deep research.
---

# Web Research Skill

This plugin exposes two MCP tools that connect to your local AI proxy at `http://localhost:20128`.

## Tools

### `web_search`

Search the web using Gemini. Returns a list of search results with titles, URLs, and snippets.

**Parameters:**
- `query` (string, required): The search query
- `max_results` (integer, optional, default 5, max 20): Number of results

**Usage:** Use this as the first step in research — gather links, then fetch key pages.

### `web_fetch`

Fetch a web page and extract its content as Markdown.

**Parameters:**
- `url` (string, required): The URL to fetch
- `model` (string, optional, "jina-reader" or "exa", default "jina-reader"):
  - `jina-reader` — Fast, good for articles and blog posts
  - `exa` — Better for structured content
- `max_characters` (integer, optional, default 50000, 0 = unlimited): Character limit

## Research Workflow

For best results when doing deep research:

1. Use `web_search` with targeted queries to find relevant pages
2. Use `web_fetch` on the most promising URLs to get full content
3. Iterate: search deeper based on what you find

## Configuration

The plugin connects to a local API proxy. These are configured in the MCP server script:

- **Base URL:** `http://localhost:20128`
- **Auth:** Bearer token authentication (configured in `scripts/mcp_server.py`)
