const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
let repo = "",
  state = null,
  selected = null,
  loading = false,
  historyLimit = 250,
  viewVersion = 0,
  diffVersion = 0,
  refreshVersion = 0;
const drafts = new Map();
const colors = [
  "#53dcc2",
  "#aa8ff7",
  "#74aaff",
  "#f3c46b",
  "#f58cab",
  "#8dda80",
];
async function api(action, data = {}, write = false) {
  const r = await fetch(write ? "/api/write" : "/api/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo, action, ...data }),
  });
  const x = await r.json();
  if (!r.ok || x.error)
    throw Error(
      typeof x.error === "string"
        ? x.error
        : x.error?.message || "Git command failed",
    );
  return x;
}
function toast(message, error = false) {
  const n = $("#toast");
  n.textContent = message;
  n.className = error ? "error" : "";
  n.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (n.hidden = true), error ? 9000 : 3500);
}
function button(label, fn, cls = "") {
  const n = el("button", cls, label);
  n.type = "button";
  n.onclick = fn;
  return n;
}
function empty(target, title, body) {
  target.replaceChildren();
  const n = el("div", "empty-state");
  n.append(el("strong", "", title), el("span", "", body));
  target.append(n);
}
function recent() {
  let paths = JSON.parse(localStorage.getItem("branchwork-recent") || "[]");
  const n = $("#recent");
  n.replaceChildren();
  if (paths.length) n.append(el("div", "", "RECENT WORKSPACES"));
  paths.forEach((p) => n.append(button(p, () => openRepo(p))));
}
recent();
if (localStorage.getItem("branchwork-theme") === "light")
  document.body.classList.add("light");
async function openRepo(path) {
  if (!path) return false;
  const oldRepo = repo;
  repo = path;
  selected = null;
  historyLimit = 250;
  viewVersion++;
  try {
    if ((await refresh()) === false) return false;
    $("#welcome").hidden = true;
    $("#workspace").hidden = false;
    const paths = [
      repo,
      ...JSON.parse(localStorage.getItem("branchwork-recent") || "[]").filter(
        (p) => p !== repo,
      ),
    ].slice(0, 7);
    localStorage.setItem("branchwork-recent", JSON.stringify(paths));
    recent();
    return true;
  } catch (e) {
    if (repo === path) {
      repo = oldRepo;
      toast(e.message, true);
    }
    return false;
  }
}
async function refresh() {
  const requestedRepo = repo,
    request = ++refreshVersion;
  const next = await api("state", { limit: historyLimit });
  if (request !== refreshVersion || repo !== requestedRepo) return false;
  state = next;
  repo = state.repo || repo;
  $("#repo-name").textContent = repo.split("/").filter(Boolean).pop();
  $("#repo-location").textContent = repo;
  $("#branch-label").textContent = "⑂ " + (state.branch || "Detached HEAD");
  $("#change-count").textContent = state.files.length;
  const footer = $("#history-footer");
  footer.replaceChildren(
    el(
      "span",
      "",
      `${state.commits.length} commits loaded${state.historyLimited ? (historyLimit >= 10000 ? " · Maximum 10,000 displayed" : " · More history available") : ""} · ${state.branch || "Detached HEAD"}`,
    ),
  );
  if (state.historyLimited && historyLimit < 10000)
    footer.append(
      button("Load more", () => {
        historyLimit = Math.min(10000, historyLimit + 250);
        refresh().catch((e) => toast(e.message, true));
      }),
    );
  renderSidebar();
  renderLog();
  renderOperation();
  if (selected) await detailCommit(selected);
  else renderWorking();
  return true;
}
async function mutate(action, data = {}) {
  if (loading) return false;
  loading = true;
  document.body.classList.add("busy");
  try {
    await api(action, data, true);
    if (action === "commit") drafts.delete(repo);
    selected = null;
    await refresh();
    toast(`${action} completed`);
    return true;
  } catch (e) {
    toast(e.message, true);
    return false;
  } finally {
    loading = false;
    document.body.classList.remove("busy");
  }
}
function modal(title, fields, onSubmit, label = "Continue") {
  const dialog = $("#modal");
  $("#modal-title").textContent = title;
  const body = $("#modal-body");
  body.replaceChildren();
  for (const f of fields) {
    if (f.note) {
      body.append(el("p", "", f.note));
      continue;
    }
    const l = el("label", "", f.label);
    l.htmlFor = "field-" + f.name;
    const i = el(f.type === "textarea" ? "textarea" : "input");
    i.id = l.htmlFor;
    i.name = f.name;
    i.type = f.type || "text";
    i.value = f.value || "";
    i.placeholder = f.placeholder || "";
    i.required = !!f.required;
    body.append(l, i);
  }
  $("#modal-submit").textContent = label;
  $("#modal-submit").hidden = false;
  $("#modal-form").onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    try {
      const result = await onSubmit(data);
      if (result !== false) dialog.close();
    } catch (e) {
      let err = body.querySelector(".error");
      if (!err) {
        err = el("p", "error");
        body.append(err);
      }
      err.textContent = e.message;
    }
  };
  dialog.showModal();
  body.querySelector("input,textarea")?.focus();
}
$("#modal-close").onclick = $("#modal-cancel").onclick = () =>
  $("#modal").close();
$("#open-form").onsubmit = (e) => {
  e.preventDefault();
  openRepo($("#repo-path").value.trim());
};
$("#open").onclick = async () => {
  if (window.desktop?.chooseDirectory) {
    const path = await window.desktop.chooseDirectory();
    if (path) openRepo(path);
  } else
    modal(
      "Open repository",
      [
        {
          name: "path",
          label: "Repository folder",
          value: repo,
          required: true,
        },
      ],
      (d) => openRepo(d.path),
      "Open",
    );
};
$("#refresh").onclick = () => refresh().catch((e) => toast(e.message, true));
$("#init").onclick = () =>
  modal(
    "Initialize repository",
    [{ name: "path", label: "Folder to initialize", required: true }],
    async (d) => {
      await api("init", { ...d, repo: d.path }, true);
      return openRepo(d.path);
    },
    "Initialize",
  );
$("#clone").onclick = () =>
  modal(
    "Clone repository",
    [
      { name: "url", label: "Repository URL", required: true },
      { name: "path", label: "Destination folder", required: true },
    ],
    async (d) => {
      toast("Cloning repository…");
      await api("clone", { ...d, repo: d.path }, true);
      return openRepo(d.path);
    },
    "Clone",
  );
function command(action) {
  if (["fetch", "pull", "push"].includes(action)) {
    modal(
      action[0].toUpperCase() + action.slice(1),
      [
        {
          note: `Run git ${action} using this repository’s configured remotes and credentials.`,
        },
      ],
      () => mutate(action),
      action,
    );
    return;
  }
  if (action === "branch")
    modal(
      "Create branch",
      [
        { name: "name", label: "Branch name", required: true },
        {
          name: "start",
          label: "Starting revision (optional)",
          placeholder: "HEAD",
        },
      ],
      (d) => mutate(action, d),
      "Create branch",
    );
  if (action === "stash")
    modal(
      "Stash changes",
      [{ name: "message", label: "Stash description (optional)" }],
      (d) => mutate(action, { ...d, includeUntracked: true }),
      "Stash changes",
    );
}
document
  .querySelectorAll("[data-command]")
  .forEach((n) => (n.onclick = () => command(n.dataset.command)));
function renderSidebar() {
  const sidebar = $("#sidebar");
  sidebar.replaceChildren();
  const sections = [
    [
      "LOCAL BRANCHES",
      state.branches
        .filter((b) => !b.remote)
        .map((b) => ({
          label: (b.current ? "● " : "⑂ ") + b.name,
          current: b.current,
          fn: () => checkout(b.name),
        })),
    ],
    [
      "REMOTE BRANCHES",
      state.branches
        .filter((b) => b.remote)
        .map((b) => ({ label: "⑂ " + b.name, fn: () => checkout(b.name) })),
    ],
    [
      "TAGS",
      state.tags.map((t) => ({
        label: "◇ " + (t.name || t),
        fn: () => checkout(t.name || t),
      })),
    ],
    [
      "STASHES",
      state.stash.map((s) => ({
        label: s.ref + " " + s.subject,
        fn: () => stashDetail(s),
      })),
    ],
    [
      "REMOTES",
      state.remotes.map((r) => ({
        label: "◈ " + r.name,
        fn: () =>
          modal(
            "Remote " + r.name,
            [{ note: r.fetch || r.url || "Configured remote" }],
            () => {},
            "Close",
          ),
      })),
    ],
  ];
  sections.forEach(([title, items]) => {
    const section = el("div", "sidebar-section");
    section.append(el("h3", "", `${title}  ${items.length}`));
    if (!items.length) section.append(el("div", "empty", "None"));
    items.forEach((i) =>
      section.append(button(i.label, i.fn, i.current ? "current" : "")),
    );
    sidebar.append(section);
  });
}
function checkout(ref) {
  modal(
    "Checkout " + ref,
    [
      {
        note: "Switch your working directory to this revision. Git will check for overlapping local changes.",
      },
    ],
    () => mutate("checkout", { ref }),
    "Checkout",
  );
}
function branchActions(name) {
  modal(
    "Branch " + name,
    [
      {
        note: "Choose a local branch operation. Delete uses Git’s merged-branch check.",
      },
    ],
    () => {},
    "Close",
  );
  const n = el("div", "detail-actions");
  n.append(
    button("Checkout", () => {
      $("#modal").close();
      checkout(name);
    }),
    button("Merge into current", () => {
      $("#modal").close();
      modal(
        "Merge " + name,
        [{ note: "Merge this branch into your currently checked-out branch." }],
        () => mutate("merge", { ref: name }),
        "Merge",
      );
    }),
    button("Rebase current onto branch", () => {
      $("#modal").close();
      modal(
        "Rebase onto " + name,
        [
          {
            note: "Replay commits from the current branch onto this branch. Existing local commit hashes will change.",
          },
        ],
        () => mutate("rebase", { ref: name }),
        "Rebase",
      );
    }),
    button("Rename", () => {
      $("#modal").close();
      modal(
        "Rename branch",
        [{ name: "newName", label: "New name", value: name, required: true }],
        (d) => mutate("branch-rename", { name, ...d }),
        "Rename",
      );
    }),
    button("Delete", () => {
      if (confirm("Delete local branch " + name + "?")) {
        mutate("branch-delete", { name });
        $("#modal").close();
      }
    }),
  );
  $("#modal-body").append(n);
}
$("#sidebar").addEventListener("contextmenu", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const section = b.closest(".sidebar-section");
  if (section?.querySelector("h3")?.textContent.startsWith("LOCAL BRANCHES")) {
    e.preventDefault();
    branchActions(b.textContent.slice(2));
  }
});
function stashDetail(s) {
  modal(
    s.ref,
    [{ note: s.subject }],
    () => mutate("stash-pop", { ref: s.ref }),
    "Apply and remove",
  );
  $("#modal-body").append(
    button("Drop stash", () => {
      if (confirm(`Permanently drop ${s.ref}?`)) {
        mutate("stash-drop", { ref: s.ref });
        $("#modal").close();
      }
    }),
  );
}
function graphRows() {
  let lanes = [];
  return state.commits.map((c) => {
    let lane = lanes.indexOf(c.hash);
    if (lane < 0) {
      lane = lanes.indexOf(null);
      if (lane < 0) lane = lanes.length;
      lanes[lane] = c.hash;
    }
    const before = [...lanes],
      after = [...lanes];
    after[lane] = null;
    c.parents.forEach((p, index) => {
      if (!after.includes(p)) {
        let free =
          index === 0 && after[lane] === null ? lane : after.indexOf(null);
        if (free < 0) free = after.length;
        after[free] = p;
      }
    });
    const segments = [];
    before.forEach((h, i) => {
      if (h && i !== lane) {
        const j = after.indexOf(h);
        if (j >= 0) segments.push([i, j]);
      }
    });
    c.parents.forEach((p) => {
      const j = after.indexOf(p);
      if (j >= 0) segments.push([lane, j]);
    });
    lanes = after;
    while (lanes.at(-1) === null) lanes.pop();
    return { c, lane, segments, before };
  });
}
function renderLog() {
  diffVersion++;
  const query = $("#search").value.trim().toLowerCase(),
    n = $("#commits"),
    rows = graphRows();
  n.replaceChildren();
  let count = 0;
  const laneCount = Math.max(
    1,
    ...rows.map((r) =>
      Math.max(r.before.length, ...r.segments.map((s) => Math.max(...s) + 1)),
    ),
  );
  const graphWidth = Math.max(65, Math.min(190, laneCount * 13 + 15));
  document.documentElement.style.setProperty(
    "--graph-width",
    graphWidth + "px",
  );
  rows.forEach(({ c, lane, segments, before }) => {
    if (
      query &&
      !`${c.subject} ${c.author} ${c.hash} ${c.refs}`
        .toLowerCase()
        .includes(query)
    )
      return;
    count++;
    const row = button(
      "",
      () => detailCommit(c),
      "commit-row" + (selected?.hash === c.hash ? " active" : ""),
    );
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${graphWidth} 58`);
    svg.setAttribute("width", graphWidth);
    svg.setAttribute("aria-label", "Commit parent graph");
    const shape = (tag, attrs) => {
      const node = document.createElementNS(svg.namespaceURI, tag);
      Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
      svg.append(node);
    };
    const x = (i) => 8 + (i * (graphWidth - 16)) / Math.max(1, laneCount - 1);
    before.forEach((h, i) => {
      if (h)
        shape("path", {
          d: `M ${x(i)} 0 L ${x(i)} 29`,
          stroke: colors[i % 6],
          "stroke-width": 2,
          fill: "none",
        });
    });
    segments.forEach(([a, b]) =>
      shape("path", {
        d: `M ${x(a)} 29 C ${x(a)} 46 ${x(b)} 40 ${x(b)} 58`,
        stroke: colors[b % 6],
        "stroke-width": 2,
        fill: "none",
      }),
    );
    shape("circle", {
      cx: x(lane),
      cy: 29,
      r: 4,
      fill: colors[lane % 6],
      stroke: "#171a1f",
      "stroke-width": 2,
    });
    const text = el("div", "commit-text");
    text.append(el("div", "subject", c.subject));
    const hash = el("div", "hash", c.hash.slice(0, 8));
    const refs = Array.isArray(c.refs) ? c.refs.join(", ") : c.refs;
    if (refs) hash.append(el("span", "ref", refs));
    text.append(hash);
    const a = el("div", "author", c.author);
    a.append(
      el(
        "small",
        "",
        new Date(c.date).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
      ),
    );
    row.append(svg, text, a);
    n.append(row);
  });
  if (!count)
    empty(
      n,
      state.commits.length ? "No matching commits" : "Your history starts here",
      state.commits.length
        ? "Try a different search."
        : "Stage files and make your first commit.",
    );
}
$("#search").oninput = renderLog;
$("#changes-nav").onclick = () => {
  selected = null;
  renderLog();
  renderWorking();
};
function renderOperation() {
  const n = $("#operation");
  n.replaceChildren();
  n.hidden = !state.operation;
  if (state.operation) {
    const op =
      typeof state.operation === "string"
        ? state.operation
        : state.operation.type || "Git operation";
    n.append(
      el("span", "", op + " in progress"),
      button("Continue", () => mutate("continue", { operation: op })),
      button("Abort", () => {
        if (confirm(`Abort ${op}?`)) mutate("abort", { operation: op });
      }),
    );
  }
}
function section(title) {
  const s = el("div", "detail-section");
  const h = el("div", "section-title", title);
  s.append(h);
  return [s, h];
}
function diffView(diff) {
  const pre = el("pre", "diff");
  String(diff || "No differences.")
    .split("\n")
    .forEach((line) => {
      const span = el(
        "div",
        line.startsWith("+") && !line.startsWith("+++")
          ? "add"
          : line.startsWith("-") && !line.startsWith("---")
            ? "del"
            : line.startsWith("@@")
              ? "hunk"
              : "",
        line || " ",
      );
      pre.append(span);
    });
  return pre;
}
async function showDiff(path, staged = false, commit = null) {
  const version = viewVersion,
    request = ++diffVersion,
    targetRepo = repo;
  try {
    const d = await api("diff", {
      path,
      staged,
      ...(commit ? { commit } : {}),
    });
    if (
      version !== viewVersion ||
      request !== diffVersion ||
      repo !== targetRepo ||
      commit !== (selected?.hash || null)
    )
      return;
    let n = $("#diff-section");
    if (!n) {
      n = el("div", "detail-section");
      n.id = "diff-section";
      $("#details").append(n);
    }
    n.replaceChildren(
      el("div", "section-title", path || "Commit diff"),
      diffView(d.diff),
    );
    if (path && !commit) {
      n.append(
        button("View HEAD file", () => viewFile(path)),
        button("Blame", () => viewFile(path, true)),
      );
      const f = state.files.find((f) => f.path === path);
      if (
        f &&
        (f.index === "U" ||
          f.worktree === "U" ||
          ["AA", "DD"].includes(f.index + f.worktree))
      )
        n.append(button("Resolve conflict", () => resolveFile(path)));
      else if (f?.index !== "?") appendHunks(n, d.diff, staged);
    }
    n.scrollIntoView({ block: "nearest" });
  } catch (e) {
    if (version === viewVersion) toast(e.message, true);
  }
}
function appendHunks(target, diff, staged) {
  const lines = diff.split("\n"),
    first = lines.findIndex((l) => l.startsWith("@@ "));
  if (first < 0) return;
  const header = lines.slice(0, first);
  if (
    header.some(
      (l) =>
        l.startsWith("new file mode") ||
        l.startsWith("deleted file mode") ||
        l.startsWith("rename from"),
    )
  )
    return;
  const starts = lines.flatMap((l, i) => (l.startsWith("@@ ") ? [i] : []));
  const fold = el("details", "hunk-list");
  fold.append(
    el(
      "summary",
      "",
      `${staged ? "Unstage" : "Stage"} individual hunks (${starts.length})`,
    ),
  );
  starts.forEach((start, i) => {
    const patch = [
      ...header,
      ...lines.slice(start, starts[i + 1] ?? lines.length),
    ]
      .join("\n")
      .replace(/\n*$/, "\n");
    const item = el("div", "hunk-item");
    item.append(
      button(`${staged ? "Unstage" : "Stage"} hunk ${i + 1}`, () =>
        mutate("apply-patch", { patch, reverse: staged }),
      ),
      el("span", "hash", lines[start]),
    );
    fold.append(item);
  });
  target.append(fold);
}
async function viewFile(path, blame = false) {
  try {
    const d = await api(blame ? "blame" : "show", { path, commit: "HEAD" });
    modal((blame ? "Blame: " : "HEAD file: ") + path, [], () => {}, "Close");
    const pre = el("pre", "diff");
    pre.textContent = d.content || "Empty file";
    $("#modal-body").append(pre);
  } catch (e) {
    toast(e.message, true);
  }
}
async function resolveFile(path) {
  try {
    const d = await api("conflict", { path });
    modal(
      "Resolve " + path,
      [
        {
          note: "Compare the three versions, then edit the working file to remove conflict markers. Saving stages the resolved content.",
        },
        {
          name: "content",
          label: "Resolved file content",
          type: "textarea",
          value: d.content,
        },
      ],
      (x) => mutate("resolve-conflict", { path, content: x.content }),
      "Save and stage",
    );
    const versions = el("div", "conflict-versions");
    for (const key of ["base", "ours", "theirs"]) {
      const fold = el("details");
      fold.append(el("summary", "", key[0].toUpperCase() + key.slice(1)));
      const pre = el("pre", "diff");
      pre.textContent = d[key] || "(empty)";
      fold.append(pre);
      versions.append(fold);
    }
    $("#modal-body").prepend(versions);
    $("#modal-body textarea").style.minHeight = "270px";
  } catch (e) {
    toast(e.message, true);
  }
}
function renderWorking() {
  viewVersion++;
  const n = $("#details");
  n.replaceChildren();
  const head = el("div", "detail-heading");
  head.append(
    el("p", "eyebrow", "WORKING DIRECTORY"),
    el("h2", "", "Your next commit"),
    el(
      "p",
      "",
      `${state.files.length} changed files · ${state.branch || "Detached HEAD"}`,
    ),
  );
  n.append(head);
  const staged = state.files.filter(
    (f) => f.index && f.index !== " " && f.index !== "?",
  );
  const unstaged = state.files.filter(
    (f) => (f.worktree && f.worktree !== " ") || f.index === "?",
  );
  [
    ["Unstaged files", unstaged, false],
    ["Staged files", staged, true],
  ].forEach(([title, files, isStaged]) => {
    const [s, h] = section(title + " · " + files.length);
    if (files.length)
      h.append(
        button(isStaged ? "Unstage all" : "Stage all", () =>
          mutate(isStaged ? "unstage" : "stage", {
            paths: files.map((f) => f.path),
          }),
        ),
      );
    else
      s.append(
        el(
          "div",
          "empty",
          isStaged ? "Ready when you are." : "Working directory is clean.",
        ),
      );
    files.forEach((f) => {
      const row = el("div", "file-row");
      row.append(
        el("span", "status", (isStaged ? f.index : f.worktree) || "?"),
        button(f.path, () => showDiff(f.path, isStaged), "path"),
        button(isStaged ? "−" : "+", () =>
          mutate(isStaged ? "unstage" : "stage", { paths: [f.path] }),
        ),
      );
      if (!isStaged && f.index !== "?" && f.index !== "U" && f.worktree !== "U")
        row.append(
          button("×", () => {
            if (
              confirm(
                `Discard unstaged tracked changes in ${f.path}? This cannot be undone.`,
              )
            )
              mutate("discard", { paths: [f.path] });
          }),
        );
      s.append(row);
    });
    n.append(s);
  });
  const [s] = section("Commit");
  const form = el("form", "commit-form");
  const msg = el("textarea");
  msg.placeholder = "Describe your changes…";
  msg.required = true;
  msg.value = drafts.get(repo) || "";
  msg.oninput = () => drafts.set(repo, msg.value);
  msg.setAttribute("aria-label", "Commit message");
  const amend = el("label", "checkbox");
  const cb = el("input");
  cb.type = "checkbox";
  amend.append(cb, el("span", "", "Amend previous commit"));
  const submit = el("button", "primary", "Commit " + staged.length + " files");
  submit.disabled = !staged.length;
  form.append(msg, amend, submit);
  form.onsubmit = (e) => {
    e.preventDefault();
    if (
      cb.checked &&
      !confirm("Replace the last commit with an amended commit?")
    )
      return;
    mutate("commit", { message: msg.value, amend: cb.checked });
  };
  s.append(form);
  n.append(s);
}
async function detailCommit(c) {
  const version = ++viewVersion;
  selected = c;
  renderLog();
  const n = $("#details");
  n.replaceChildren();
  const head = el("div", "detail-heading");
  head.append(
    el("p", "eyebrow", "COMMIT DETAILS"),
    el("h2", "", c.subject),
    el("p", "", `${c.author} · ${new Date(c.date).toLocaleString()}`),
    el("p", "hash", c.hash),
  );
  n.append(head);
  const [s] = section("Actions");
  const actions = el("div", "detail-actions");
  actions.append(
    button("Checkout", () => checkout(c.hash)),
    button("New branch", () =>
      modal(
        "Branch from commit",
        [{ name: "name", label: "Branch name", required: true }],
        (d) => mutate("branch", { ...d, start: c.hash }),
        "Create branch",
      ),
    ),
    button("Tag", () =>
      modal(
        "Create tag",
        [{ name: "name", label: "Tag name", required: true }],
        (d) => mutate("tag", { ...d, ref: c.hash }),
        "Create tag",
      ),
    ),
  );
  ["cherry-pick", "revert", "merge", "rebase"].forEach((action) =>
    actions.append(
      button(action[0].toUpperCase() + action.slice(1), () =>
        modal(
          action[0].toUpperCase() + action.slice(1) + " commit",
          [
            {
              note: `Apply git ${action} ${c.hash.slice(0, 8)} to the current branch.`,
            },
          ],
          () => {
            if (
              action === "revert" &&
              !confirm("Create a commit reverting these changes?")
            )
              return false;
            return mutate(action, { ref: c.hash });
          },
          action,
        ),
      ),
    ),
  );
  s.append(actions);
  n.append(s);
  try {
    const d = await api("commit-files", { commit: c.hash });
    if (selected?.hash !== c.hash || version !== viewVersion) return;
    const [files] = section("Changed files");
    d.files.forEach((f) =>
      files.append(
        button(f.path, () => showDiff(f.path, false, c.hash), "path"),
      ),
    );
    n.append(files);
    await showDiff(null, false, c.hash);
  } catch (e) {
    if (version === viewVersion) toast(e.message, true);
  }
}
async function showReflog() {
  try {
    const d = await api("reflog");
    modal(
      "Repository reflog",
      [{ note: "Recent movements of HEAD and local references." }],
      () => {},
      "Close",
    );
    const pre = el("pre", "diff");
    pre.textContent = d.entries
      .map((e) => `${e.selector} ${e.hash.slice(0, 8)} ${e.subject}`)
      .join("\n");
    $("#modal-body").append(pre);
  } catch (e) {
    toast(e.message, true);
  }
}
$("#more").onclick = () => {
  modal("Repository tools", [], () => {}, "Close");
  const list = el("div", "tool-list");
  [
    ["Worktrees", showWorktrees],
    ["Submodules", showSubmodules],
    ["Git LFS", showLfs],
    ["Remotes", showRemotes],
    ["Repository identity", showIdentity],
    ["Interactive rebase", showInteractiveRebase],
    ["Reflog", showReflog],
  ].forEach(([label, fn]) =>
    list.append(
      button(label + " →", () => {
        $("#modal").close();
        fn().catch?.((e) => toast(e.message, true));
      }),
    ),
  );
  $("#modal-body").append(list);
};
async function showIdentity() {
  const d = await api("config");
  modal(
    "Repository identity",
    [
      {
        note: "Author identity is saved in this repository’s local Git configuration.",
      },
      { name: "name", label: "Author name", value: d.name, required: true },
      { name: "email", label: "Author email", value: d.email, required: true },
    ],
    (x) => mutate("config", x),
    "Save identity",
  );
}
async function showWorktrees() {
  const d = await api("worktrees");
  modal(
    "Worktrees",
    [
      {
        note: "Each worktree has a separate working folder sharing this repository’s history.",
      },
    ],
    () => {},
    "Close",
  );
  const body = $("#modal-body");
  d.worktrees.forEach((w) => {
    const row = el("div", "management-row");
    row.append(
      el("strong", "", w.branch || w.head?.slice(0, 8) || "Bare repository"),
      el("small", "", w.path),
      button("Open", () => {
        $("#modal").close();
        openRepo(w.path);
      }),
    );
    if (w.path !== repo && !w.bare)
      row.append(
        button("Remove", async () => {
          if (
            confirm(
              `Remove worktree ${w.path}? Git will refuse uncommitted changes.`,
            ) &&
            (await mutate("worktree-remove", { path: w.path }))
          ) {
            $("#modal").close();
            showWorktrees();
          }
        }),
      );
    body.append(row);
  });
  body.append(
    button("Add worktree", () => {
      $("#modal").close();
      modal(
        "Add worktree",
        [
          { name: "path", label: "New working folder", required: true },
          { name: "ref", label: "Starting revision", placeholder: "HEAD" },
          { name: "branch", label: "New branch name (optional)" },
        ],
        (x) => mutate("worktree-add", x),
        "Add worktree",
      );
    }),
  );
}
async function showSubmodules() {
  const d = await api("submodules");
  modal(
    "Submodules",
    [{ note: "Submodules track other repositories at specific revisions." }],
    () => {},
    "Close",
  );
  const body = $("#modal-body");
  d.submodules.forEach((s) => {
    const row = el("div", "management-row");
    row.append(
      el("strong", "", s.path),
      el("small", "", `${s.status} ${s.hash?.slice(0, 12)}`),
      button("Initialize / update", () =>
        mutate("submodule-update", { path: s.path }),
      ),
    );
    body.append(row);
  });
  if (!d.submodules.length)
    body.append(el("p", "", "No submodules configured."));
  body.append(
    button("Update all recursively", () => mutate("submodule-update")),
    button("Add submodule", () => {
      $("#modal").close();
      modal(
        "Add submodule",
        [
          { name: "url", label: "Repository URL", required: true },
          { name: "path", label: "Submodule path", required: true },
        ],
        (x) => mutate("submodule-add", x),
        "Add submodule",
      );
    }),
  );
}
async function showLfs() {
  const d = await api("lfs");
  modal(
    "Git LFS",
    [
      {
        note: d.installed
          ? "Manage large-file tracking patterns. Commit .gitattributes after changing patterns."
          : "Git LFS is not installed. Install git-lfs on your system to use this feature.",
      },
    ],
    () => {},
    "Close",
  );
  const body = $("#modal-body");
  if (!d.installed) return;
  body.append(
    button("Enable LFS for repository", () => mutate("lfs-install")),
    button("Pull LFS objects", () => mutate("lfs-pull")),
  );
  d.patterns.forEach((p) => {
    const row = el("div", "management-row");
    row.append(
      el("strong", "", p),
      button("Untrack", () => {
        if (confirm("Stop tracking pattern " + p + "?"))
          mutate("lfs-untrack", { pattern: p });
      }),
    );
    body.append(row);
  });
  body.append(
    button("Track pattern", () => {
      $("#modal").close();
      modal(
        "Track large files",
        [
          {
            name: "pattern",
            label: "File pattern",
            placeholder: "*.psd",
            required: true,
          },
        ],
        (x) => mutate("lfs-track", x),
        "Track",
      );
    }),
  );
  const pre = el("pre", "diff");
  pre.textContent = d.files.join("\n") || "No LFS files tracked.";
  body.append(pre);
}
async function showRemotes() {
  modal("Repository remotes", [], () => {}, "Close");
  const body = $("#modal-body");
  state.remotes.forEach((r) => {
    const row = el("div", "management-row");
    row.append(
      el("strong", "", r.name),
      el("small", "", r.fetch),
      button("Remove", async () => {
        if (
          confirm(`Remove remote ${r.name}? Local branches will remain.`) &&
          (await mutate("remote-remove", { name: r.name }))
        ) {
          $("#modal").close();
          showRemotes();
        }
      }),
    );
    body.append(row);
  });
  body.append(
    button("Add remote", () => {
      $("#modal").close();
      modal(
        "Add remote",
        [
          {
            name: "name",
            label: "Remote name",
            placeholder: "origin",
            required: true,
          },
          { name: "url", label: "Repository URL", required: true },
        ],
        (x) => mutate("remote-add", x),
        "Add remote",
      );
    }),
  );
}
async function showInteractiveRebase() {
  modal(
    "Interactive rebase",
    [
      {
        note: "Replay a clean linear branch after a chosen base. This rewrites local commit hashes. The next screen lets you pick, drop, squash, or fix up each commit.",
      },
      {
        name: "onto",
        label: "Base revision",
        placeholder: "HEAD~3",
        required: true,
      },
    ],
    async (d) => {
      const onto = d.onto,
        { commits } = await api("rebase-plan", { onto });
      if (!commits.length) throw Error("No commits selected");
      $("#modal").close();
      modal(
        "Review rebase plan",
        [
          {
            note: `Replay ${commits.length} commits onto ${onto}, oldest first. This rewrites the current branch’s local history.`,
          },
        ],
        () => {
          if (
            !confirm("Rewrite this local commit history according to the plan?")
          )
            return false;
          return mutate("interactive-rebase", {
            onto,
            steps: commits.map((c) => ({
              hash: c.hash,
              action: $("#rebase-" + c.hash).value,
            })),
          });
        },
        "Start rebase",
      );
      commits.forEach((c, i) => {
        const row = el("div", "rebase-row");
        const select = el("select");
        select.id = "rebase-" + c.hash;
        select.setAttribute("aria-label", "Action for " + c.subject);
        ["pick", "drop", ...(i ? ["squash", "fixup"] : [])].forEach(
          (action) => {
            const option = el("option", "", action);
            option.value = action;
            select.append(option);
          },
        );
        const text = el("div");
        text.append(
          el("span", "", c.subject),
          el("small", "hash", c.hash.slice(0, 8)),
        );
        row.append(select, text);
        $("#modal-body").append(row);
      });
      return false;
    },
    "Review plan",
  );
}
$("#settings").onclick = () => {
  modal(
    "Workspace settings",
    [
      {
        note: "Branchwork is an independent local Git client. Git commands use installed Git and existing credentials. Supported workflows include local history, staging, hunks, branches, tags, remotes, stash, merge/rebase, conflicts, worktrees, submodules and Git LFS. Hosted-service accounts, pull-request dashboards, proprietary integrations and GitKraken feature parity are not implemented.",
      },
      {
        note: "Keyboard shortcuts: / search · Ctrl+B branch · Ctrl+R refresh · Ctrl+Shift+S stage all · Ctrl+Shift+U unstage all · Ctrl+Enter commit. Right-click a local branch for branch actions.",
      },
    ],
    () => {},
    "Done",
  );
  $("#modal-body").append(
    button(
      document.body.classList.contains("light")
        ? "Use dark theme"
        : "Use light theme",
      () => {
        document.body.classList.toggle("light");
        localStorage.setItem(
          "branchwork-theme",
          document.body.classList.contains("light") ? "light" : "dark",
        );
        $("#modal").close();
      },
    ),
  );
};
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $("#modal").close();
  if (!state || $("#modal").open) return;
  const key = e.key.toLowerCase(),
    ctrl = e.ctrlKey || e.metaKey;
  if (key === "/" && !["INPUT", "TEXTAREA"].includes(e.target.tagName)) {
    e.preventDefault();
    $("#search").focus();
  }
  if (ctrl && key === "r") {
    e.preventDefault();
    refresh().catch((e) => toast(e.message, true));
  }
  if (ctrl && key === "b") {
    e.preventDefault();
    command("branch");
  }
  if (ctrl && e.shiftKey && ["s", "u"].includes(key)) {
    e.preventDefault();
    const files = state.files.filter((f) =>
      key === "s"
        ? (f.worktree && f.worktree !== " ") || f.index === "?"
        : f.index && f.index !== " " && f.index !== "?",
    );
    if (files.length)
      mutate(key === "s" ? "stage" : "unstage", {
        paths: files.map((f) => f.path),
      });
  }
  if (ctrl && key === "enter") {
    const form = $(".commit-form");
    if (form && !form.querySelector("button").disabled) {
      e.preventDefault();
      form.requestSubmit();
    }
  }
});
