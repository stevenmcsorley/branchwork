# Verification record

Verified on this Ubuntu 24.04 host against GitKraken 12.6.0's supplied Linux package as a static reference.

## Automated Git integration

`npm run check` and `npm test` pass. The three tests contain actual repository operations in temporary directories, not mocked Git responses:

- Repository initialization, initial commit, status, whole-file staging/unstaging, branches and diffs.
- Index-only hunk patch application and reversal, tracked-only discard validation, worktree creation/removal, local author configuration, submodule inspection/update, validated interactive rebase planning and actual fixup rebasing.
- Real merge conflicts, base/ours/theirs reads, abort and resolution/continue, stashes, tags, cherry-picks/reverts, detached HEAD, newline/space filenames, rename parsing, clone/fetch/pull/push through a local bare remote, host/origin and malformed request checks.

The same tests passed when run with `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron --test tests/backend.test.mjs`; this exercises the generated Git sequence editor using the Electron executable.

## Interactive interface checks

Used a disposable demo repository with actual diverging branches and a merge commit. Verified opening the repo, graph rendering, working and historic diffs, stage-all, creating a commit, worktree listing, reviewing an interactive rebase plan, and staging one hunk. Git independently confirmed the resulting commit and cached patch. Commit drafts survived hunk staging. A duplicate branch-name error left the branch form and typed name intact. Browser error/warning logs were empty at the final check.

Electron starts with `npm run desktop:compat` on this host. Normal sandbox startup is blocked by this host's user-namespace/setuid configuration. See README for the compatibility flag's effect.

## Coverage limits

These checks establish selected Branchwork workflows, not equivalence with GitKraken. Original GitKraken was inspected statically, not run with authenticated remote accounts. LFS availability is detected and operations are exposed, but real LFS remote traffic was not tested. Large repository performance, signing, arbitrary hooks, binary/image diffs, line-level staging, hosted dashboards and OS variants remain unverified or unimplemented. See research/FINDINGS.md for the feature matrix.
