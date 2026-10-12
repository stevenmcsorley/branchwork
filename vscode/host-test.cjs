const assert = require("node:assert/strict");
const vscode = require("vscode");
module.exports.run = async () => {
  const extension = vscode.extensions.getExtension(
    "branchwork-local.branchwork-pro-workspace",
  );
  assert.ok(extension, "Extension is discovered");
  const api = await extension.activate();
  const commands = await vscode.commands.getCommands();
  assert.ok(commands.includes("branchwork.openWorkspace"));
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "A disposable repository is open");
  const panel = await api.openWorkspace(folder.uri.fsPath);
  assert.ok(panel, "Workspace webview is created");
  const match = panel.webview.html.match(
    /src="(http:\/\/127\.0\.0\.1:\d+[^\"]*)"/,
  );
  assert.ok(match, "Workspace uses the local loopback server");
  const url = new URL(match[1].replaceAll("&amp;", "&"));
  assert.equal(url.searchParams.get("repo"), folder.uri.fsPath);
  const response = await fetch(new URL("/api/read", url.origin), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo: folder.uri.fsPath, action: "files" }),
  });
  assert.equal(response.status, 200);
  assert.ok(Array.isArray((await response.json()).files));
  if (process.env.BRANCHWORK_CAPTURE_WAIT_MS) {
    await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
    await vscode.commands.executeCommand("notifications.clearAll");
    console.log("BRANCHWORK_CAPTURE_READY");
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.min(60000, Number(process.env.BRANCHWORK_CAPTURE_WAIT_MS) || 0),
      ),
    );
  }
  const document = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(folder.uri, "README.md"),
  );
  await vscode.window.showTextDocument(document);
  await vscode.commands.executeCommand("branchwork.toggleInlineBlame");
  await api.updateBlame();
  await api.dispose();
  console.log("BRANCHWORK_EXTENSION_HOST_OK");
};
