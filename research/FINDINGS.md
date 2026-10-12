# Evidence, feature coverage, and limits

## Reference evidence

The supplied Linux installer was GitKraken Desktop **12.6.0**. Its SHA-256 was `e2e278ffc3b99cb71502b476a7b59aa6b580a5554b3e3eb9e0535ff61fc6b370`.

Read-only package inspection found separate Electron main/renderer/worker/request-handler bundles, React/Redux dependencies, native Git bindings, bundled Git executables, localization resources, stylesheet colors, and keybindings. These are **static observations**, not proof of runtime reachability, behavior, subscription availability, or equivalence. The original application was not inspected with an authenticated account.

The full ASAR REA call timed out after 300 seconds without retaining a record. Focused helper inventories succeeded:

| Helper | Retained parent Evidence | Semantic limits |
| --- | --- | --- |
| AskPass | `ev_08ad1e895586b55e53b116ce173f3734ca5e2cc34b993e462ff9516ecafa8cb6` | 272 unknown semantic items; inventory is not a complete authentication specification. |
| Git sequence editor | `ev_8eac46b3583246bd2693a7c4400f97d88e671e80f874f16d81af5be06c0ee9e1` | 77 unknown semantic items; inventory is not the visual rebase algorithm. |

Static helper reads show an environment-selected loopback socket, a ready handshake, and NUL-terminated JSON for credential requests or Git todo paths. These protocols were not reproduced as vendor services. Branchwork uses newly written code, the installed Git CLI, and standard MCP transports.

Original extraction and detailed generated inventory remain ignored local research material. They are not included in the public repository or release binaries.

The user also supplied a GitLens screenshot and the [GitLens Pro feature page](https://gitkraken.com/gitlens/pro-features). That reference informed the editor-above-graph layout, Home/Launchpad organization, file-history navigation, advanced graph controls, and optional AI workflow. It is a product reference, not a claim that the original extension's implementation was recovered. Branchwork has its own VS Code extension and desktop shell.

## Current implementation matrix

| Area | Implemented in Branchwork | Verification / boundary |
| --- | --- | --- |
| Repository status, init/clone, commits/amend, branches, tags | Real allowlisted Git commands; annotation/deletion, upstream tracking | Temporary repository and local bare-remote tests. |
| Graph and history | Parent lanes, refs, search fields, regex, author chronology, multi-select batch cherry-pick, activity for loaded history | Actual Git history and browser rendering; activity is not complete repository telemetry. History loads up to 10,000 commits. |
| Code/editor | File explorer, working and committed text, line numbers, lightweight syntax colors, explicit editing/saving | Hash-based stale-save rejection, path containment, binary/2 MB limits, browser editor checks. Not a full IDE language server. |
| Blame and file history | Working/revision line attribution, line-to-commit inspection, rename-following historical paths | Tests include two renames with spaces/newlines and opening all returned revisions. Native VS Code attribution uses the same backend. |
| Staging/discard | Files, individual hunks, selected changed lines, index-only patches and reverse patches | Real index/worktree assertions, untracked files, distant hunks, insertions/deletions, replacement selections, missing final newline. |
| Diffs/images | Revision comparisons, file diffs, raster versions, side-by-side/opacity overlay | Raster data tests and UI controls. SVG is not rendered as trusted active content; image preview is capped at 10 MB. |
| Conflict resolution | Base/ours/theirs text, edited output, binary side selection, delete resolution, abort/continue | Actual conflicting merge and rebase fixtures. No claim of equivalent vendor automatic conflict resolution. |
| Interactive rebase | Reorder, pick/drop/squash/fixup/reword/edit, durable message editor through conflicts, continuation | Reordering/reword/conflict/edit tests under Node and Electron. The editable plan currently requires linear history. |
| Merge-preserving rebase | Standard `git rebase --rebase-merges` option | A fixture verifies retained merge parents and branch content after rebasing. Arbitrary editing of merge todo labels is not provided. |
| Gitflow | Repository-local branch/prefix configuration; feature/release/hotfix start/finish | Real branch merges and release/hotfix tags. Conflicts remain explicit Git operations to resolve. |
| Worktrees/submodules | Create/open/remove/lock/unlock/prune; add/status/init/update modules | Real worktree and local submodule tests. Destructive force removal is not silently used. |
| LFS and signing | Optional LFS install/track/untrack/pull/push/checkout/prune; repository signing settings | Availability/configuration tests. Real remote LFS traffic and key-based signing need user tools/credentials and were not production-tested. |
| Stashes/reset/ignore | Show/apply/keep/pop/drop; soft/mixed/hard reset with preview/confirmation; ignore editing | Real stash/reset tests; hard reset requires an explicit confirmation flag. |
| Home and Launchpad | Local repository tabs/activity/files; explicit provider loading; status groups from reported evidence | No fabricated review data or automatic hosted reads. Missing provider status is unknown, not inferred success. |
| Hosting | GitHub/GitLab/Bitbucket Cloud/Azure PR or MR lists/details/create, issues/work items, comments, supported reviews/merge methods, checks/files | Local HTTP/response fixtures validate request shape, auth, partial permissions, unsupported actions, and false merge responses. Production accounts are not authenticated or verified. Lists bounded at 100. |
| Issue autolinks | User-configured safe HTTP(S) patterns in commit messages | Local rendering. This is not a complete Jira/enterprise SSO integration. |
| AI | On/off, cloud-compatible endpoint/model/key or MCP tool, explanations, commit/stash drafts, reviews, PR descriptions, changelog contexts | Disabled/no-transmission checks, immutable approved previews, bounded context, response/error handling, actual MCP protocol fixtures. No live paid model call. |
| MCP server | Root-bounded state/history/diff/blame/optional AI, write tool only with explicit server opt-in | Real SDK stdio discovery/calls, denied out-of-root requests, absent default write tool. MCP alone is not an AI model. |
| VS Code | Shared local webview, workspace sidebar, native selected-line blame/hover, commit navigation | Unit fixtures plus actual development-host activation, loopback API, webview creation, and decoration exercise. |

## Intentionally excluded

GitKraken-hosted cloud patches, shared cloud workspaces, vendor account/profile sync, vendor AI token service, SSO administration, and DORA cloud analytics are outside the user's selected scope. This implementation does not bypass or depend on their subscription services.

## Remaining limits

This is a working independent implementation, **not a verified complete GitLens/GitKraken clone**. The public functionality reflects the implemented matrix above. Native Windows/macOS installers, arbitrary merge-todo editing, complete IDE language/debug/terminal support, provider OAuth/SSO, Bitbucket Data Center-specific APIs, all hosted edge cases, and very-large-repository performance have not been implemented or fully verified.

Hosted permissions and provider features differ. The UI exposes supported review/merge choices and reports unavailable supplementary details. Azure voting requires reviewer identity; GitLab request-changes semantics are not supplied by this adapter. Bitbucket/Azure file summaries do not promise complete inline patch review.

Changelog context is bounded. If a comparison range is supplied, the diff covers that range; accompanying recent commit metadata is disclosed as repository-wide and may not be a complete release history. No automatic background network or AI request runs on opening a repository.

See [TESTING.md](../TESTING.md) for executable checks and recorded UI verification.
