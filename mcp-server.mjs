import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

export async function createMCPServer({
  read,
  write,
  services,
  root = process.env.BRANCHWORK_MCP_ROOT || process.cwd(),
  allowWrites = process.env.BRANCHWORK_MCP_ALLOW_WRITES === "1",
}) {
  const allowed = await fs.realpath(root),
    server = new McpServer({ name: "branchwork", version: "0.2.1" });
  async function repoBoundary(repo) {
    if (!path.isAbsolute(repo))
      throw new Error("Absolute repository path required");
    const real = await fs.realpath(repo);
    if (real !== allowed && !real.startsWith(allowed + path.sep))
      throw new Error("Repository outside configured MCP root");
    return real;
  }
  const schema = {
    repo: z
      .string()
      .describe("Absolute repository path inside BRANCHWORK_MCP_ROOT"),
  };
  const answer = (x) => ({
    content: [{ type: "text", text: JSON.stringify(x) }],
  });
  function register(name, description, extra, action) {
    server.registerTool(
      name,
      {
        description,
        inputSchema: { ...schema, ...extra },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async (body) => {
        try {
          return answer(
            await read({
              ...body,
              repo: await repoBoundary(body.repo),
              action,
            }),
          );
        } catch (e) {
          return {
            isError: true,
            content: [{ type: "text", text: e.message }],
          };
        }
      },
    );
  }
  register(
    "branchwork_state",
    "Read branch, commit graph, status and refs.",
    {},
    "state",
  );
  register(
    "branchwork_diff",
    "Read a working, staged, or commit diff.",
    {
      path: z.string().optional(),
      commit: z.string().optional(),
      staged: z.boolean().optional(),
    },
    "diff",
  );
  register(
    "branchwork_history",
    "Read repository history.",
    {
      limit: z.number().int().min(250).max(10000).optional(),
      offset: z.number().int().nonnegative().optional(),
    },
    "history",
  );
  register(
    "branchwork_blame",
    "Read line attribution for a tracked file.",
    { path: z.string() },
    "blame",
  );
  server.registerTool(
    "branchwork_ai",
    {
      description:
        "Request an AI suggestion. Disabled by default in Branchwork settings. Preview context with confirmed=false; confirmed=true and the returned previewId sends exactly that context to the configured AI destination. Never executes suggestions.",
      inputSchema: {
        ...schema,
        task: z.enum([
          "explain-commit",
          "explain-changes",
          "commit-message",
          "stash-message",
          "changelog",
          "review-changes",
          "pr-description",
          "conflict-help",
          "chat",
        ]),
        prompt: z.string().optional(),
        commit: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        previewId: z.string().optional(),
        confirmed: z.boolean().default(false),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (body) => {
      try {
        return answer(
          await services.handle({
            ...body,
            repo: await repoBoundary(body.repo),
            action: body.confirmed ? "ai-run" : "ai-preview",
          }),
        );
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    },
  );
  if (allowWrites)
    server.registerTool(
      "branchwork_git_write",
      {
        description:
          "Perform an explicit Git mutation. Available only when BRANCHWORK_MCP_ALLOW_WRITES=1. Must be requested by the user.",
        inputSchema: {
          ...schema,
          action: z.enum([
            "stage",
            "unstage",
            "commit",
            "branch",
            "checkout",
            "fetch",
            "pull",
            "push",
          ]),
          paths: z.array(z.string()).optional(),
          message: z.string().optional(),
          name: z.string().optional(),
          ref: z.string().optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: true,
        },
      },
      async (body) => {
        try {
          return answer(
            await write({ ...body, repo: await repoBoundary(body.repo) }),
          );
        } catch (e) {
          return {
            isError: true,
            content: [{ type: "text", text: e.message }],
          };
        }
      },
    );
  return server;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { read, write } = await import("./server.mjs");
    const { createServices } = await import("./integrations.mjs");
    const { createSettingsStore } = await import("./settings.mjs");
    const settings = createSettingsStore();
    const services = createServices({ read, write, settings });
    const server = await createMCPServer({ read, write, services });
    await server.connect(new StdioServerTransport());
  } catch {
    process.stderr.write(
      "Branchwork MCP initialization failed; check root and settings configuration.\n",
    );
    process.exitCode = 1;
  }
}
