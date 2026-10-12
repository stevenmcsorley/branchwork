const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

function escapeHTML(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
function panelHTML(origin, url) {
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${escapeHTML(origin)}; style-src 'unsafe-inline';"><style>html,body,iframe{width:100%;height:100%;margin:0;padding:0;border:0;overflow:hidden;display:block}body{background:#0c0d12}</style></head><body><iframe title="Branchwork Pro Workspace" src="${escapeHTML(url)}" sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads"></iframe></body></html>`;
}
function createExtension(vscode, context, options = {}) {
  let runtimePromise,
    serverPromise,
    server,
    panel,
    disposed = false,
    timer,
    blameEnabled = Boolean(
      vscode.workspace.getConfiguration("branchwork").get("inlineBlame", false),
    ),
    generation = 0;
  const cache = new Map(),
    disposables = [],
    changes = new vscode.EventEmitter();
  const decoration = vscode.window.createTextEditorDecorationType({
    after: {
      color: new vscode.ThemeColor("editorCodeLens.foreground"),
      margin: "0 0 0 3em",
    },
  });
  const runtime = () =>
    (runtimePromise ||= (async () => {
      if (options.loadRuntime) return options.loadRuntime();
      const packaged = path.join(
        context.extensionPath,
        "runtime",
        "runtime.mjs",
      );
      try {
        await fs.access(packaged);
        return await import(pathToFileURL(packaged).href);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        return import(
          pathToFileURL(path.resolve(context.extensionPath, "..", "server.mjs"))
            .href
        );
      }
    })());
  async function localServer() {
    if (disposed) throw Error("Branchwork extension is disposed");
    return (serverPromise ||= (async () => {
      await fs.mkdir(context.globalStorageUri.fsPath, {
        recursive: true,
        mode: 0o700,
      });
      const module = await runtime();
      server = module.createServer({
        settingsDir: context.globalStorageUri.fsPath,
      });
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      if (disposed) {
        await new Promise((resolve) => server.close(resolve));
        throw Error("Branchwork extension is disposed");
      }
      return `http://127.0.0.1:${server.address().port}`;
    })().catch((error) => {
      serverPromise = undefined;
      throw error;
    }));
  }
  const folders = () => vscode.workspace.workspaceFolders || [];
  async function chooseRepo(repo) {
    if (typeof repo === "string" && path.isAbsolute(repo)) return repo;
    if (!folders().length)
      throw Error("Open a local repository folder in VS Code first");
    if (folders().length === 1) return folders()[0].uri.fsPath;
    const pick = await vscode.window.showQuickPick(
      folders().map((folder) => ({
        label: folder.name,
        description: folder.uri.fsPath,
        repo: folder.uri.fsPath,
      })),
      { placeHolder: "Select repository" },
    );
    return pick?.repo;
  }
  async function openWorkspace(repo, commit, view) {
    try {
      repo = await chooseRepo(repo);
      if (!repo) return;
      const origin = await localServer(),
        url = new URL(origin);
      url.searchParams.set("repo", repo);
      if (commit && /^[0-9a-f]{40,64}$/.test(commit))
        url.searchParams.set("commit", commit);
      if (view === "ai") url.searchParams.set("view", "ai");
      if (!panel) {
        panel = vscode.window.createWebviewPanel(
          "branchwork.workspace",
          "Branchwork Pro Workspace",
          vscode.ViewColumn.Active,
          {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [],
            portMapping: [
              {
                webviewPort: Number(new URL(origin).port),
                extensionHostPort: Number(new URL(origin).port),
              },
            ],
          },
        );
        panel.onDidDispose(() => {
          panel = undefined;
        });
      }
      panel.webview.html = panelHTML(origin, url.href);
      panel.reveal(vscode.ViewColumn.Active);
      return panel;
    } catch (error) {
      vscode.window.showErrorMessage("Branchwork: " + error.message);
    }
  }
  function editorFile(document) {
    if (document.uri.scheme !== "file" || document.isDirty) return null;
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!folder) return null;
    const relative = path.relative(folder.uri.fsPath, document.uri.fsPath);
    if (
      !relative ||
      relative.startsWith(".." + path.sep) ||
      path.isAbsolute(relative)
    )
      return null;
    return {
      repo: folder.uri.fsPath,
      path: relative.split(path.sep).join("/"),
    };
  }
  async function blame(document) {
    const file = editorFile(document);
    if (!file) return [];
    const key = document.uri.toString() + "\0" + document.version;
    if (cache.has(key)) return cache.get(key);
    const module = await runtime();
    const promise = module
      .read({ ...file, action: "blame-lines" })
      .then((result) => result.lines)
      .catch(() => []);
    cache.set(key, promise);
    while (cache.size > 20) cache.delete(cache.keys().next().value);
    return promise;
  }
  function markdown(item) {
    const md = new vscode.MarkdownString();
    md.isTrusted = false;
    md.supportHtml = false;
    md.appendText(
      `${item.author || "Unknown author"} · ${item.date?.slice(0, 10) || "Unknown date"}\n${item.hash}\n${item.summary || ""}`,
    );
    return md;
  }
  async function updateBlame() {
    const id = ++generation,
      editor = vscode.window.activeTextEditor;
    if (!editor) return;
    editor.setDecorations(decoration, []);
    if (!blameEnabled || !editorFile(editor.document)) return;
    const line = editor.selection.active.line,
      lines = await blame(editor.document);
    if (
      disposed ||
      id !== generation ||
      vscode.window.activeTextEditor !== editor
    )
      return;
    const item = lines.find((value) => value.line === line + 1);
    if (!item) return;
    const uncommitted = /^0+$/.test(item.hash),
      text = uncommitted
        ? "Uncommitted changes"
        : `${item.author} · ${item.date.slice(0, 10)} · ${item.summary}`;
    editor.setDecorations(decoration, [
      {
        range: new vscode.Range(
          line,
          editor.document.lineAt(line).text.length,
          line,
          editor.document.lineAt(line).text.length,
        ),
        hoverMessage: markdown(item),
        renderOptions: { after: { contentText: text.slice(0, 220) } },
      },
    ]);
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => updateBlame().catch(() => {}), 180);
  }
  const provider = {
    onDidChangeTreeData: changes.event,
    getTreeItem: (item) => item,
    getChildren: () => [
      ...folders().map((folder) => {
        const item = new vscode.TreeItem(
          folder.name,
          vscode.TreeItemCollapsibleState.None,
        );
        item.description = folder.uri.fsPath;
        item.tooltip = folder.uri.fsPath;
        item.command = {
          command: "branchwork.openWorkspace",
          title: "Open repository",
          arguments: [folder.uri.fsPath],
        };
        return item;
      }),
      ...[
        ["Open Workspace", "branchwork.openWorkspace"],
        ["AI Settings", "branchwork.openAI"],
        ["Toggle Inline Blame", "branchwork.toggleInlineBlame"],
      ].map(([label, command]) => {
        const item = new vscode.TreeItem(
          label,
          vscode.TreeItemCollapsibleState.None,
        );
        item.command = { command, title: label };
        return item;
      }),
    ],
  };
  const register = (name, fn) =>
    disposables.push(vscode.commands.registerCommand(name, fn));
  register("branchwork.openWorkspace", openWorkspace);
  register("branchwork.openAI", (repo) => openWorkspace(repo, undefined, "ai"));
  register("branchwork.refresh", () => {
    cache.clear();
    changes.fire();
    if (panel) openWorkspace();
    schedule();
  });
  register("branchwork.toggleInlineBlame", async () => {
    blameEnabled = !blameEnabled;
    await vscode.workspace
      .getConfiguration("branchwork")
      .update("inlineBlame", blameEnabled, vscode.ConfigurationTarget.Global);
    schedule();
  });
  register("branchwork.showLineCommit", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const file = editorFile(editor.document);
    if (!file)
      return vscode.window.showInformationMessage(
        "Save the local file before inspecting its line commit.",
      );
    const item = (await blame(editor.document)).find(
      (value) => value.line === editor.selection.active.line + 1,
    );
    if (!item || /^0+$/.test(item.hash))
      return vscode.window.showInformationMessage(
        "This line has no committed attribution.",
      );
    return openWorkspace(file.repo, item.hash);
  });
  disposables.push(
    vscode.window.registerTreeDataProvider("branchwork.repositories", provider),
    vscode.window.onDidChangeActiveTextEditor(schedule),
    vscode.window.onDidChangeTextEditorSelection(schedule),
    vscode.workspace.onDidSaveTextDocument(() => {
      cache.clear();
      schedule();
    }),
    vscode.workspace.onDidChangeTextDocument(() => {
      cache.clear();
      schedule();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => changes.fire()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("branchwork.inlineBlame")) {
        blameEnabled = Boolean(
          vscode.workspace
            .getConfiguration("branchwork")
            .get("inlineBlame", false),
        );
        schedule();
      }
    }),
    vscode.languages.registerHoverProvider(
      { scheme: "file" },
      {
        async provideHover(document, position) {
          const item = (await blame(document)).find(
            (value) => value.line === position.line + 1,
          );
          if (!item) return;
          return new vscode.Hover(markdown(item));
        },
      },
    ),
  );
  if (blameEnabled) schedule();
  async function dispose() {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    generation++;
    panel?.dispose();
    decoration.dispose();
    changes.dispose();
    for (const item of disposables) item.dispose();
    cache.clear();
    if (server) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
  }
  return { dispose, openWorkspace, updateBlame, provider };
}
let active;
function activate(context) {
  const vscode = require("vscode");
  active = createExtension(vscode, context);
  context.subscriptions.push({ dispose: () => active?.dispose() });
  return active;
}
async function deactivate() {
  await active?.dispose();
  active = undefined;
}
module.exports = { activate, deactivate, createExtension, panelHTML };
