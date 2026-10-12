# Branchwork Pro Workspace for VS Code

This local extension opens the Branchwork Git workspace inside VS Code and adds native line blame, safe attribution hovers, a repository sidebar, and **Branchwork: Show Line Commit**. The workspace includes Git graphs, file editing, advanced Git operations, hosting dashboards, optional cloud AI, and MCP controls.

Install the packaged VSIX using **Extensions → Install from VSIX**, open a local Git repository, then run **Branchwork: Open Workspace**. The local HTTP server starts only when a workspace panel is opened and binds to `127.0.0.1` on an available port. It stops when the extension is deactivated. Native blame reads Git locally without starting that server. Enable attribution with **Branchwork: Toggle Inline Blame**; unsaved documents are excluded to avoid attributing edited lines to disk content.

AI is disabled by default. Configure the provider in **Branchwork: Open AI Settings**, review the exact context, then explicitly send the preview. API keys and hosting tokens are session-only in this extension; configuration persists in VS Code's extension storage. The desktop application can use OS-encrypted credentials separately. Hosted dashboards contact providers only after explicit actions.

The package contains its own runtime and shared workspace assets. A development checkout falls back to the adjacent server source if the packaged runtime is absent. The extension uses a sandboxed iframe, no webview message bridge, no remote HTML in attribution hovers, and read-only native blame. MCP Git mutation tools require an explicit separate opt-in.

Source verification uses a mocked VS Code API and a real local HTTP server. This does not replace testing in a live VS Code extension host. The extension is intended for desktop VS Code with a local repository; browser-based VS Code and remote extension hosts are not supported.
