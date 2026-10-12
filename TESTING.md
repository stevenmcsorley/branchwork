# Verification record

Verified on this Ubuntu 24.04 host against GitKraken 12.6.0's supplied Linux package as a static reference.

## Automated Git integration

`npm run check` passes and `npm test` reports 38 passing subtests. They exercise real Git repositories in temporary directories, alongside mocked HTTP provider responses and local AI/MCP fixtures:

- Repository initialization, initial commit, status, whole-file staging/unstaging, branches and diffs.
- Index-only hunk patch application and reversal, tracked-only discard validation, worktree creation/removal, local author configuration, submodule inspection/update, validated interactive rebase planning and actual fixup rebasing.
- Real merge conflicts, base/ours/theirs reads, abort and resolution/continue, stashes, tags, cherry-picks/reverts, detached HEAD, newline/space filenames, rename parsing, clone/fetch/pull/push through a local bare remote, host/origin and malformed request checks.

The same tests passed when run with `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron --test tests/backend.test.mjs`; this exercises the generated Git sequence editor using the Electron executable.

## Interactive interface checks

Used a disposable demo repository with actual diverging branches and a merge commit. Verified opening the repo, graph rendering, working and historic diffs, stage-all, creating a commit, worktree listing, reviewing an interactive rebase plan, and staging one hunk. Git independently confirmed the resulting commit and cached patch. Commit drafts survived hunk staging. A duplicate branch-name error left the branch form and typed name intact. Browser error/warning logs were empty at the final check.

The 0.2.2 GitHub Actions release workflow passed on Ubuntu, macOS and Windows. Each packaged desktop app was started in Node mode and smoke-tested against its bundled HTTP server; the VS Code VSIX installed into an isolated extension directory. Linux DEB metadata and its root-owned setuid sandbox helper were inspected locally. `npm run desktop:compat` opens the source Electron app on this host. The 0.2.3 portable Linux app also opened from a fresh user-owned extraction when invoked without arguments. Its launcher detected the non-root-owned sandbox helper and supplied Electron's `--no-sandbox` flag automatically.

## Coverage limits

These checks establish selected Branchwork workflows, not equivalence with GitKraken. Original GitKraken was inspected statically, not run with authenticated remote accounts. LFS availability is detected and operations are exposed, but real LFS remote traffic was not tested. Large repository performance, signing, arbitrary hooks, hosted-service credentials, and end-user installation on every operating system remain unverified. See research/FINDINGS.md for the feature matrix.
