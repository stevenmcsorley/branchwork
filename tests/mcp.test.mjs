import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMCPServer } from "../mcp-server.mjs";
import { createServices } from "../integrations.mjs";
const run = promisify(execFile);
test("MCP AI adapter discovers and calls an actual suggestion tool with prompt and context", async () => {
  const config = {
    ai: {
      enabled: true,
      mode: "mcp",
      mcp: {
        transport: "stdio",
        command: process.execPath,
        args: [
          fileURLToPath(new URL("./fixtures/ai-mcp.mjs", import.meta.url)),
        ],
        tool: "suggest",
        argumentsTemplate: { prompt: "{{prompt}}", context: "{{context}}" },
      },
    },
  };
  const services = createServices({
    settings: { load: async () => config },
    read: async (body) =>
      body.action === "state"
        ? { branch: "main", files: [], commits: [] }
        : { diff: "actual staged patch" },
  });
  const list = await services.handle({ action: "mcp-tools" });
  assert.ok(list.tools.find((tool) => tool.name === "suggest"));
  const preview = await services.handle({
    action: "ai-preview",
    repo: "/repo",
    task: "commit-message",
    prompt: "short subject",
  });
  const result = await services.handle({
    action: "ai-run",
    repo: "/repo",
    previewId: preview.previewId,
    confirmed: true,
  });
  assert.match(result.text, /Fixture suggestion/);
  assert.match(result.text, /short subject/);
  assert.match(result.text, /actual staged patch/);
});
test("real stdio MCP lists read tools, reads Git and enforces root without advertising writes", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "branchwork-mcp-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await run("git", ["init", dir]);
  const client = new Client({ name: "test", version: "1" }),
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL("../mcp-server.mjs", import.meta.url))],
      env: {
        ...process.env,
        BRANCHWORK_MCP_ROOT: dir,
        BRANCHWORK_MCP_ALLOW_WRITES: "0",
        BRANCHWORK_SETTINGS_DIR: path.join(dir, "settings"),
      },
      stderr: "pipe",
    });
  t.after(() => client.close());
  await client.connect(transport);
  const list = await client.listTools();
  assert.equal(
    list.tools.some((v) => v.name === "branchwork_git_write"),
    false,
  );
  assert.ok(list.tools.some((v) => v.name === "branchwork_diff"));
  const state = await client.callTool({
    name: "branchwork_state",
    arguments: { repo: dir },
  });
  assert.equal(state.isError, undefined);
  assert.equal(JSON.parse(state.content[0].text).commits.length, 0);
  const outside = await client.callTool({
    name: "branchwork_state",
    arguments: { repo: os.tmpdir() },
  });
  assert.equal(outside.isError, true);
  assert.match(outside.content[0].text, /outside/);
  const relative = await client.callTool({
    name: "branchwork_state",
    arguments: { repo: "." },
  });
  assert.equal(relative.isError, true);
  const denied = await client.callTool({
    name: "branchwork_git_write",
    arguments: { repo: dir, action: "commit", message: "no" },
  });
  assert.equal(denied.isError, true);
  assert.equal(
    (await run("git", ["-C", dir, "status", "--porcelain"])).stdout,
    "",
  );
});
test("MCP AI client calls a real stdio tool with substituted context and no automatic mutations", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "branchwork-mcp-ai-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await run("git", ["init", dir]);
  const script = fileURLToPath(new URL("../mcp-server.mjs", import.meta.url));
  const config = {
    ai: {
      enabled: true,
      mode: "mcp",
      mcp: {
        transport: "stdio",
        command: process.execPath,
        cwd: dir,
        args: [script],
        tool: "branchwork_state",
        argumentsTemplate: { repo: dir },
      },
    },
  };
  const settings = { load: async () => config };
  const services = createServices({
    settings,
    read: async (b) =>
      b.action === "state"
        ? { branch: "main", commits: [], files: [] }
        : { diff: "actual context" },
  });
  const tools = await services.handle({ action: "mcp-tools" });
  assert.ok(tools.tools.find((t) => t.name === "branchwork_state"));
  const preview = await services.handle({
    action: "ai-preview",
    repo: dir,
    task: "chat",
    prompt: "Read state",
  });
  const result = await services.handle({
    action: "ai-run",
    repo: dir,
    previewId: preview.previewId,
    confirmed: true,
  });
  assert.equal(JSON.parse(result.text).repo, dir);
});
test("write tool requires explicit server opt-in", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "branchwork-mcp-write-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let writes = 0;
  const server = await createMCPServer({
    root: dir,
    allowWrites: true,
    read: async () => ({}),
    write: async () => {
      writes++;
      return { output: "done" };
    },
    services: { handle: async () => ({}) },
  });
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  t.after(() => client.close());
  t.after(() => server.close());
  assert.ok(
    (await client.listTools()).tools.find(
      (t) => t.name === "branchwork_git_write",
    ),
  );
  assert.equal(writes, 0);
  await client.callTool({
    name: "branchwork_git_write",
    arguments: { repo: dir, action: "commit", message: "explicit" },
  });
  assert.equal(writes, 1);
});
