import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, GetPromptRequestSchema, ListPromptsRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "quake-fixture", version: "1.0.0" }, { capabilities: { tools: {}, prompts: {}, resources: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: "echo", description: "Echo text", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }] }));
server.setRequestHandler(CallToolRequestSchema, async (request) => ({ content: [{ type: "text", text: `echo:${request.params.arguments?.text || ""}` }] }));
server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [{ name: "hello", description: "Fixture prompt" }] }));
server.setRequestHandler(GetPromptRequestSchema, async () => ({ description: "Fixture prompt", messages: [{ role: "user", content: { type: "text", text: "Hello from fixture" } }] }));
server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [{ uri: "fixture://readme", name: "Fixture README", mimeType: "text/plain" }] }));
server.setRequestHandler(ReadResourceRequestSchema, async () => ({ contents: [{ uri: "fixture://readme", mimeType: "text/plain", text: "fixture resource" }] }));
await server.connect(new StdioServerTransport());
