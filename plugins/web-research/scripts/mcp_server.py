"""
MCP Server for Web Research plugin.
Provides web_search and web_fetch tools via a local AI proxy API.
"""
from __future__ import annotations

import json
import logging
import os
import sys
from typing import Any

import httpx

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s: %(message)s",
    stream=sys.stderr,
)
log = logging.getLogger("web-research-mcp")

PROXY_BASE_URL = "http://localhost:20128"
API_KEY = os.environ.get("QUAKE_WEB_RESEARCH_API_KEY", "")

# ── JSON-RPC helpers ──────────────────────────────────────────────────────────

def jsonrpc_error(req_id: Any, code: int, message: str, data: Any = None) -> dict:
    err: dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        err["data"] = data
    return {"jsonrpc": "2.0", "id": req_id, "error": err}


def jsonrpc_result(req_id: Any, result: Any) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


# ── Tool definitions ──────────────────────────────────────────────────────────

TOOLS: list[dict[str, Any]] = [
    {
        "name": "web_search",
        "description": (
            "Search the web using Gemini. Returns a list of search results "
            "with titles, URLs, and snippets. Use this for general web research."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query string",
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum number of search results (default 5, max 20)",
                    "default": 5,
                },
            },
            "required": ["query"],
        },
    },
    {
        "name": "web_fetch",
        "description": (
            "Fetch and extract the content of a web page as Markdown. "
            "Uses Jina Reader (fast, good for articles) by default, or Exa "
            "(better for structured content). Returns the page title and markdown body."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The URL of the web page to fetch",
                },
                "model": {
                    "type": "string",
                    "description": (
                        "Parser to use: \"jina-reader\" (default, fast article extraction) "
                        "or \"exa\" (structured content)"
                    ),
                    "default": "jina-reader",
                    "enum": ["jina-reader", "exa"],
                },
                "max_characters": {
                    "type": "integer",
                    "description": "Maximum characters to return (0 = no limit, default 50000)",
                    "default": 50000,
                },
            },
            "required": ["url"],
        },
    },
]

TOOL_MAP = {t["name"]: t for t in TOOLS}


# ── API callers ───────────────────────────────────────────────────────────────

async def call_search(query: str, max_results: int) -> str:
    """Call the local proxy search endpoint."""
    payload = {
        "model": "gemini",
        "query": query,
        "search_type": "web",
        "max_results": min(max_results, 20),
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}",
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            f"{PROXY_BASE_URL}/v1/search",
            json=payload,
            headers=headers,
        )
        resp.raise_for_status()
        return resp.text


async def call_fetch(url: str, model: str, max_characters: int) -> str:
    """Call the local proxy web fetch endpoint."""
    payload: dict[str, Any] = {
        "model": model,
        "url": url,
        "format": "markdown",
    }
    if max_characters > 0:
        payload["max_characters"] = max_characters
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}",
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            f"{PROXY_BASE_URL}/v1/web/fetch",
            json=payload,
            headers=headers,
        )
        resp.raise_for_status()
        return resp.text


# ── MCP request handler ──────────────────────────────────────────────────────

async def handle_request(req: dict) -> dict | None:
    req_id = req.get("id")
    method = req.get("method", "")
    params = req.get("params", {})

    # ── Lifecycle ──
    if method == "initialize":
        return jsonrpc_result(req_id, {
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "tools": {},
            },
            "serverInfo": {
                "name": "web-research",
                "version": "0.1.0",
            },
        })

    if method == "notifications/initialized":
        return None  # no response expected

    if method == "notifications/cancelled":
        return None

    # ── Tools ──
    if method == "tools/list":
        return jsonrpc_result(req_id, {"tools": TOOLS})

    if method == "tools/call":
        name = params.get("name", "")
        arguments = params.get("arguments", {})
        tool = TOOL_MAP.get(name)
        if tool is None:
            return jsonrpc_error(req_id, -32601, f"Unknown tool: {name}")

        try:
            if name == "web_search":
                query = arguments.get("query", "")
                max_results = arguments.get("max_results", 5)
                if not query:
                    return jsonrpc_error(req_id, -32602, "Missing required argument: query")
                result_text = await call_search(query, max_results)

            elif name == "web_fetch":
                url = arguments.get("url", "")
                model = arguments.get("model", "jina-reader")
                max_characters = arguments.get("max_characters", 50000)
                if not url:
                    return jsonrpc_error(req_id, -32602, "Missing required argument: url")
                result_text = await call_fetch(url, model, max_characters)

            else:
                return jsonrpc_error(req_id, -32601, f"Unknown tool: {name}")

            return jsonrpc_result(req_id, {
                "content": [
                    {
                        "type": "text",
                        "text": result_text,
                    }
                ],
                "isError": False,
            })

        except httpx.HTTPStatusError as e:
            return jsonrpc_error(req_id, -32000, f"API error: {e.response.status_code}", str(e))
        except httpx.RequestError as e:
            return jsonrpc_error(req_id, -32000, f"Connection error: {e}", str(e))
        except Exception as e:
            log.exception("Unexpected error in %s", name)
            return jsonrpc_error(req_id, -32603, f"Internal error: {e}", str(e))

    return jsonrpc_error(req_id, -32601, f"Method not found: {method}")


# ── Main loop ─────────────────────────────────────────────────────────────────

async def main() -> None:
    log.info("Web Research MCP server starting (stdio)...")
    line_buffer = ""
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        line_buffer += line
        # Try to parse one complete JSON-RPC message per line
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            log.error("Invalid JSON received: %s", e)
            resp = jsonrpc_error(None, -32700, "Parse error")
            sys.stdout.write(json.dumps(resp) + "\n")
            sys.stdout.flush()
            continue

        resp = await handle_request(req)
        if resp is not None:
            sys.stdout.write(json.dumps(resp) + "\n")
            sys.stdout.flush()

    log.info("Web Research MCP server shutting down.")


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
