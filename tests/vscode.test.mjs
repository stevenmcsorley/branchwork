import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createExtension, panelHTML } = require("../vscode/extension.cjs");
function mockVSCode(repo) {
  const commands = new Map(),
    errors = [],
    panels = [],
    events = {};
  const disposable = () => ({ dispose() {} });
  class EventEmitter {
    constructor() {
      this.event = () => disposable();
    }
    fire() {}
    dispose() {}
  }
  class MarkdownString {
    constructor() {
      this.value = "";
    }
    appendText(text) {
      this.value += text;
      return this;
    }
  }
  const editor = {
    document: {
      uri: {
        scheme: "file",
        fsPath: path.join(repo, "file.txt"),
        toString: () => path.join(repo, "file.txt"),
      },
      version: 1,
      isDirty: false,
      lineAt: () => ({ text: "hello" }),
    },
    selection: { active: { line: 0 } },
    decorations: [],
    setDecorations(type, values) {
      this.decorations = values;
    },
  };
  let enabled = false;
  const vscode = {
    EventEmitter,
    MarkdownString,
    ThemeColor: class {
      constructor(id) {
        this.id = id;
      }
    },
    TreeItem: class {
      constructor(label) {
        this.label = label;
      }
    },
    TreeItemCollapsibleState: { None: 0 },
    ViewColumn: { Active: 1 },
    ConfigurationTarget: { Global: 1 },
    Range: class {
      constructor(...args) {
        this.args = args;
      }
    },
    Hover: class {
      constructor(contents) {
        this.contents = contents;
      }
    },
    commands: {
      registerCommand(name, fn) {
        commands.set(name, fn);
        return disposable();
      },
    },
    workspace: {
      workspaceFolders: [{ name: "repo", uri: { fsPath: repo } }],
      getWorkspaceFolder: () => ({ uri: { fsPath: repo } }),
      getConfiguration: () => ({
        get: () => enabled,
        update: async (key, value) => {
          enabled = value;
        },
      }),
      onDidSaveTextDocument: (fn) => {
        events.save = fn;
        return disposable();
      },
      onDidChangeTextDocument: (fn) => {
        events.change = fn;
        return disposable();
      },
      onDidChangeWorkspaceFolders: () => disposable(),
      onDidChangeConfiguration: () => disposable(),
    },
    window: {
      activeTextEditor: editor,
      createTextEditorDecorationType: () => disposable(),
      showErrorMessage: (message) => errors.push(message),
      showInformationMessage: (message) => errors.push(message),
      showQuickPick: async (values) => values[0],
      createWebviewPanel(type, title, column, options) {
        let callback;
        const panel = {
          webview: { html: "" },
          options,
          onDidDispose(fn) {
            callback = fn;
            return disposable();
          },
          dispose() {
            callback?.();
          },
          reveal() {},
        };
        panels.push(panel);
        return panel;
      },
      registerTreeDataProvider: () => disposable(),
      onDidChangeActiveTextEditor: () => disposable(),
      onDidChangeTextEditorSelection: () => disposable(),
    },
    languages: {
      registerHoverProvider(selector, provider) {
        events.hover = provider;
        return disposable();
      },
    },
  };
  return { vscode, commands, errors, panels, editor, events };
}
test("VS Code workspace lazily starts a local server and embeds safe encoded repository URL", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "branchwork-vscode-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const mock = mockVSCode(path.join(dir, "repo with & spaces"));
  let loads = 0,
    starts = 0;
  const extension = createExtension(
    mock.vscode,
    {
      extensionPath: dir,
      globalStorageUri: { fsPath: path.join(dir, "storage") },
    },
    {
      loadRuntime: async () => {
        loads++;
        return {
          createServer() {
            starts++;
            return http.createServer((req, res) => res.end("ok"));
          },
          read: async () => ({ lines: [] }),
        };
      },
    },
  );
  t.after(() => extension.dispose());
  assert.equal(loads, 0);
  assert.equal(starts, 0);
  assert.ok(mock.commands.has("branchwork.openWorkspace"));
  await mock.commands.get("branchwork.openWorkspace")();
  assert.equal(starts, 1);
  const html = mock.panels[0].webview.html;
  assert.match(html, /default-src 'none'/);
  assert.match(html, /sandbox="allow-scripts allow-same-origin/);
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /repo=.*repo\+with\+%26\+spaces/);
  const origin = html.match(/frame-src (http:\/\/127\.0\.0\.1:\d+)/)[1];
  assert.equal(await (await fetch(origin)).text(), "ok");
  await mock.commands.get("branchwork.openAI")();
  assert.equal(starts, 1);
  assert.match(mock.panels[0].webview.html, /view=ai/);
  assert.equal(mock.panels[0].options.localResourceRoots.length, 0);
  assert.equal(mock.errors.length, 0);
  await extension.dispose();
  await assert.rejects(fetch(origin));
});
test("native VS Code blame reads real response lines without starting server and safely hovers", async (t) => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "branchwork-vscode-blame-"),
  );
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const mock = mockVSCode(dir),
    calls = [];
  const item = {
    line: 1,
    hash: "a".repeat(40),
    author: "Alice <img onerror=x>",
    date: "2026-10-12T00:00:00Z",
    summary: "Fix [link](command:evil)",
  };
  const extension = createExtension(
    mock.vscode,
    {
      extensionPath: dir,
      globalStorageUri: { fsPath: path.join(dir, "storage") },
    },
    {
      loadRuntime: async () => ({
        read: async (body) => {
          calls.push(body);
          return { lines: [item] };
        },
        createServer() {
          throw Error("Native blame must not start HTTP");
        },
      }),
    },
  );
  t.after(() => extension.dispose());
  await mock.commands.get("branchwork.toggleInlineBlame")();
  await extension.updateBlame();
  assert.equal(calls[0].action, "blame-lines");
  assert.equal(calls[0].path, "file.txt");
  assert.match(
    mock.editor.decorations[0].renderOptions.after.contentText,
    /Alice/,
  );
  const hover = await mock.events.hover.provideHover(mock.editor.document, {
    line: 0,
  });
  assert.equal(hover.contents.isTrusted, false);
  assert.equal(hover.contents.supportHtml, false);
  assert.match(hover.contents.value, /command:evil/);
  mock.editor.document.isDirty = true;
  await extension.updateBlame();
  assert.deepEqual(mock.editor.decorations, []);
  assert.equal(calls.length, 1);
});
test("webview HTML escapes attributes and allows only the configured loopback frame", () => {
  const html = panelHTML(
    "http://127.0.0.1:1234",
    "http://127.0.0.1:1234/?repo=%22%3E&view=ai",
  );
  assert.match(html, /&amp;view=ai/);
  assert.doesNotMatch(html, /http:\/\/\*|unsafe-eval|allow-top-navigation/);
});
