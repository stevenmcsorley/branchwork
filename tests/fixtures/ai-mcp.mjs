import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const server = new McpServer({ name: "test-ai-tool", version: "1" });
server.registerTool(
  "suggest",
  { inputSchema: { prompt: z.string(), context: z.string() } },
  async ({ prompt, context }) => ({
    content: [
      { type: "text", text: "Fixture suggestion: " + prompt + "\n" + context },
    ],
  }),
);
await server.connect(new StdioServerTransport());
