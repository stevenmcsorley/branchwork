Branchwork is a local Git workbench for Windows, macOS, Linux and VS Code.

## What's new in 0.2.1

- **Windows and macOS builds:** a Windows installer and portable zip, and macOS builds for Apple Silicon and Intel.
- **Full-width diffs:** expand any diff over the editor and graph, and switch between unified and side-by-side split views. Line staging still works while the diff is expanded, and the view stays open after staging.
- **Full-width file history:** the editor's History button opens the commit list beside each commit's diff of that file. Use the arrow keys to step through commits.
- **The editor's Diff button opens full-width**, including on historical file versions. Previously it did nothing while a commit was selected in the graph.
- **Closable editor tabs:** each tab has a × button, and middle-click also closes a tab. Unsaved edits ask before closing.
- **Maximize the editor** to hide the commit graph, and drag the editor/graph divider further than before.
- **Visual overhaul:** a consistent icon set, a readable type scale, and redesigned header, rail, toolbar, graph rows and inspector.
- **Blame gutter:** blame appears as a sticky gutter showing author, relative age and an age heat bar, once per run of lines from the same commit. It replaces the scattered inline notes.
- **Diff toolbar:** click changed lines to select them (shift-click for a range), then use **Stage / Unstage / Discard N lines**. **Stage hunk** sits on each hunk header.
- **Fixed:** merge commits showed "No differences". Their diff, file list and line counts now compare against the first parent.
- **Fixed:** the VS Code panel was clipped on the right by the webview's default padding.

## Downloads

| Platform | File |
|---|---|
| Windows x64 | `branchwork-*-windows-x64-setup.exe` (installer) or `-windows-x64.zip` (portable) |
| macOS Apple Silicon | `branchwork-*-macos-arm64.dmg` (or `.zip`) |
| macOS Intel | `branchwork-*-macos-x64.dmg` (or `.zip`) |
| Debian/Ubuntu x64 | `branchwork_*_amd64.deb` |
| Linux x64 portable | `branchwork-*-linux-x64.tar.gz` |
| VS Code | `branchwork-pro-workspace-*.vsix` |
| MCP server (Node.js 22+) | `branchwork-mcp-*.tar.gz` |

Checksums are in the `SHA256SUMS-*.txt` files. Git must be installed on every platform.

Windows and macOS builds aren't code-signed yet. On Windows, choose **More info → Run anyway** in SmartScreen. On macOS, use **System Settings → Privacy & Security → Open Anyway**. See the [installation guide](https://github.com/stevenmcsorley/branchwork#install).

AI is off by default and uses only endpoints and keys you configure. This project is not affiliated with GitKraken or GitLens.
