/* Independent editor + Git workspace. No remote request runs on page load. */
const pro = {
  files: [],
  file: null,
  tabs: [],
  fileRequest: 0,
  showBlame: true,
  editing: false,
  dirty: false,
  selection: new Set(),
  regex: false,
  chronology: false,
  launchpad: null,
  sidebarMode: "home",
  activity: new Map(),
  stats: new Map(),
};
function safeAsync(fn) {
  return (...args) =>
    Promise.resolve()
      .then(() => fn(...args))
      .catch((e) => toast(e.message, true));
}
function setupProShell() {
  const history = $(".history"),
    graph = el("section", "graph-pane");
  graph.setAttribute("aria-label", "Commit graph");
  [...history.children].forEach((n) => graph.append(n));
  history.append(graph);
  const editor = el("section", "editor-pane");
  editor.setAttribute("aria-label", "File editor");
  editor.id = "editor-pane";
  const tabs = el("nav", "editor-tabs");
  tabs.id = "editor-tabs";
  tabs.setAttribute("aria-label", "Open file tabs");
  const bar = el("div", "editor-bar");
  bar.id = "editor-bar";
  const code = el("div", "editor-code");
  code.id = "editor-code";
  editor.append(tabs, bar, code);
  const handle = el("div", "panel-resizer");
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-label", "Resize editor and graph");
  handle.tabIndex = 0;
  handle.onpointerdown = (e) => {
    handle.setPointerCapture(e.pointerId);
    const area = history.getBoundingClientRect();
    handle.onpointermove = (x) => {
      const percent = Math.max(
        23,
        Math.min(70, ((x.clientY - area.top) / area.height) * 100),
      );
      document.documentElement.style.setProperty(
        "--editor-height",
        percent + "%",
      );
    };
    handle.onpointerup = () => (handle.onpointermove = null);
  };
  handle.onkeydown = (e) => {
    if (["ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      const value =
        parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--editor-height",
          ),
        ) || 45;
      document.documentElement.style.setProperty(
        "--editor-height",
        Math.max(23, Math.min(70, value + (e.key === "ArrowUp" ? -3 : 3))) +
          "%",
      );
    }
  };
  history.prepend(editor, handle);
  const rail = el("nav", "icon-rail");
  rail.setAttribute("aria-label", "Workspace sections");
  for (const [symbol, label, fn] of [
    ["⌂", "Home", () => switchHome("home")],
    ["◈", "Launchpad", () => switchHome("launchpad")],
    [
      "▤",
      "File explorer",
      () => {
        $("#files-section")?.scrollIntoView();
        $("#file-filter")?.focus();
      },
    ],
    ["⑂", "Commit graph", () => $("#search").focus()],
    ["✧", "AI assistant", showAiAssistant],
    [
      "☷",
      "Toggle inspector",
      () => $(".details").classList.toggle("inspector-open"),
    ],
    ["⚙", "Workspace settings", () => $("#settings").click()],
  ]) {
    const b = button(
      symbol,
      safeAsync(fn),
      label === "Toggle inspector" ? "inspector-toggle" : "",
    );
    b.title = label;
    b.setAttribute("aria-label", label);
    if (label === "Home") b.classList.add("active");
    rail.append(b);
  }
  $("#workspace").prepend(rail);
  const side = $("main>aside"),
    heading = el("div", "home-header", "Branchwork");
  heading.append(el("span", "pro-pill", "WORKSPACE"));
  const nav = el("div", "home-switch");
  nav.append(
    button("Home", () => switchHome("home"), "active"),
    button("Launchpad", () => switchHome("launchpad")),
  );
  side.prepend(heading, nav);
  const home = el("div");
  home.id = "home-content";
  $("#changes-nav").after(home);
  const info = el("div", "inspector-top");
  info.append(
    el("p", "eyebrow", "CONNECTED TO YOUR CODE"),
    el("h2", "", "Your repository.\nEvery detail."),
    el(
      "p",
      "",
      "Read the code above. Follow its history below. Branchwork keeps your working files and Git history together.",
    ),
  );
  const block = el("div", "status-block"),
    dot = el("span", "status-dot"),
    text = el("div");
  text.append(
    el("strong", "", "Local workspace"),
    el("small", "", "Direct Git · no GitKraken account"),
  );
  block.append(dot, text);
  info.append(
    block,
    button("✧ AI assistant", safeAsync(showAiAssistant)),
    el("div", "helper-shortcut", "/ Search  ·  Ctrl+R Refresh"),
  );
  $(".details").prepend(info);
  $("#search").placeholder = "Search · author: message: branch: sha:";
  const extra = el("div", "graph-extra");
  const mode = el("label", "search-mode"),
    cb = el("input");
  cb.type = "checkbox";
  cb.setAttribute("aria-label", "Use regular expressions in search");
  cb.onchange = () => {
    pro.regex = cb.checked;
    renderLog();
  };
  mode.append(cb, el("span", "", ".*"));
  extra.append(
    mode,
    button("Authors", () => {
      pro.chronology = !pro.chronology;
      renderLog();
    }),
    button("Filters", showFilters),
  );
  $(".history-title").append(extra);
  const batch = el("div", "batch-controls");
  batch.id = "batch-controls";
  batch.hidden = true;
  batch.append(
    el("span"),
    button("Cherry-pick selected", safeAsync(batchCherryPick)),
    button("Clear", () => {
      pro.selection.clear();
      renderLog();
    }),
  );
  $(".log-head").before(batch);
  $(".log-head").replaceChildren(
    el("span", "", "GRAPH"),
    el("span", "", "COMMIT / REFERENCES"),
    el("span", "", "AUTHOR / DATE"),
    el("span", "changes-column", "CHANGES"),
  );
  renderEditor();
}
setupProShell();
function switchHome(mode) {
  pro.sidebarMode = mode;
  document
    .querySelectorAll(".home-switch button")
    .forEach((b, i) =>
      b.classList.toggle("active", i === (mode === "home" ? 0 : 1)),
    );
  document
    .querySelectorAll(".icon-rail button")
    .forEach((b, i) =>
      b.classList.toggle("active", i === (mode === "home" ? 0 : 1)),
    );
  renderHome();
}
function homeSection(title) {
  const n = el("section", "home-section");
  n.append(el("h3", "", title));
  return n;
}
function renderHome() {
  const n = $("#home-content");
  n.replaceChildren();
  if (!state) return;
  let card = $(".repo-card-branch");
  if (!card) {
    card = el("div", "repo-card-branch");
    $(".repo-heading>div").append(card);
  }
  card.textContent = "⑂ " + (state.branch || "Detached HEAD");
  if (pro.sidebarMode === "launchpad") {
    renderLaunchpad(n);
    return;
  }
  const activity = homeSection("REPOSITORY ACTIVITY");
  const dates = new Map();
  for (const c of state.commits) {
    const key = c.date?.slice(0, 10);
    if (key) dates.set(key, (dates.get(key) || 0) + 1);
  }
  const now = new Date(),
    bars = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    bars.push({ key, count: dates.get(key) || 0 });
  }
  const max = Math.max(1, ...bars.map((b) => b.count)),
    spark = el("div", "activity-sparkline");
  spark.setAttribute(
    "aria-label",
    "Loaded commits by date over the last 14 days",
  );
  bars.forEach((b) => {
    const bar = el("span");
    bar.style.height = (b.count ? Math.max(5, (b.count / max) * 30) : 2) + "px";
    bar.title = `${b.key}: ${b.count} loaded commits`;
    spark.append(bar);
  });
  activity.append(spark);
  const counts = el("div", "activity-stat");
  counts.append(
    el("strong", "", String(state.commits.length)),
    el("span", "", "loaded commits"),
  );
  activity.append(
    counts,
    el("div", "activity-caption", "Last 14 days · loaded history only"),
  );
  n.append(activity);
  const files = homeSection("FILES");
  files.id = "files-section";
  const search = el("input", "file-filter");
  search.id = "file-filter";
  search.placeholder = "Find a file…";
  search.setAttribute("aria-label", "Filter repository files");
  const list = el("div", "files-explorer");
  function draw() {
    list.replaceChildren();
    const query = search.value.toLowerCase();
    pro.files
      .filter((f) => f.path.toLowerCase().includes(query))
      .slice(0, 250)
      .forEach((f) => {
        const b = button(
          "",
          safeAsync(() => openEditor(f.path)),
          pro.file?.path === f.path ? "active" : "",
        );
        b.title = f.path;
        const depth = f.path.split("/").length - 1;
        b.style.paddingLeft = Math.min(depth * 8 + 6, 38) + "px";
        b.append(
          el("span", "file-symbol", "▤"),
          el("span", "file-name", f.path),
        );
        const changed = state.files.find((x) => x.path === f.path);
        if (changed)
          b.append(
            el(
              "span",
              "file-status",
              (changed.index + changed.worktree).trim(),
            ),
          );
        list.append(b);
      });
    if (!pro.files.length)
      list.append(el("p", "launchpad-hint", "No files in this repository."));
  }
  search.oninput = draw;
  draw();
  files.append(search, list);
  n.append(files);
  const recent = homeSection("RECENT WORKSPACES"),
    recentList = el("div", "recent-list");
  JSON.parse(localStorage.getItem("branchwork-recent") || "[]")
    .slice(0, 5)
    .forEach((p) => {
      const b = button("▣ " + p.split("/").filter(Boolean).pop(), () =>
        openRepo(p),
      );
      b.title = p;
      recentList.append(b);
    });
  recent.append(recentList);
  n.append(recent);
}
function renderLaunchpad(target) {
  const section = homeSection("PULL REQUEST LAUNCHPAD");
  section.append(
    el(
      "p",
      "launchpad-hint",
      "Load pull requests directly from your configured hosting provider. No provider requests run automatically.",
    ),
  );
  section.append(
    button(
      pro.launchpad ? "Refresh pull requests" : "Load pull requests",
      safeAsync(async () => {
        const requestedRepo = repo,
          data = await service("provider-list", { kind: "pulls" });
        if (requestedRepo !== repo) return;
        pro.launchpad = data;
        renderHome();
      }),
      "launchpad-load",
    ),
    button(
      "Configure hosting",
      safeAsync(showProviderSettings),
      "launchpad-load",
    ),
  );
  if (pro.launchpad) {
    if (pro.launchpad.limited)
      section.append(
        el(
          "p",
          "launchpad-hint",
          "First 100 results. Additional items may exist on the provider.",
        ),
      );
    const groups = new Map();
    for (const item of pro.launchpad.items || []) {
      const stateName = String(item.state || "").toLowerCase(),
        group = item.draft
          ? "Draft"
          : item.conflicts
            ? "Conflicts"
            : item.checksState &&
                /failed|failure|error|canceled/.test(item.checksState)
              ? "Checks failed"
              : item.reviewState === "review-requested"
                ? "Review requested"
                : /merged|closed|declined|completed/.test(stateName)
                  ? "Closed / merged"
                  : "Open";
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(item);
    }
    for (const [name, items] of groups) {
      const group = el("div", "launchpad-group");
      group.append(el("h4", "", name + " · " + items.length));
      for (const item of items) {
        const b = button(
          "",
          safeAsync(() => providerDetail("pulls", item.number)),
          "launchpad-item",
        );
        b.append(
          el("strong", "", `#${item.number} ${item.title}`),
          el(
            "small",
            "",
            `${item.author || "Unknown author"}${item.head ? " · " + item.head + " → " + item.base : ""}`,
          ),
        );
        group.append(b);
      }
      section.append(group);
    }
    if (!groups.size)
      section.append(el("p", "launchpad-hint", "No pull requests returned."));
  }
  target.append(section);
}
const proOpenRepo = openRepo;
openRepo = async function (path) {
  if (
    pro.dirty &&
    !confirm("Discard unsaved editor changes before switching repositories?")
  )
    return false;
  const old = repo,
    ok = await proOpenRepo(path);
  if (ok) {
    if (old !== repo) {
      pro.tabs = [];
      pro.file = null;
      pro.launchpad = null;
      pro.selection.clear();
      pro.stats.clear();
      pro.editing = false;
      pro.dirty = false;
    }
    await loadRepositoryFiles();
    renderHome();
    renderEditor();
    if (!pro.file && pro.files.length) {
      const first =
        pro.files.find((f) => /^readme\./i.test(f.path)) ||
        pro.files.find((f) =>
          /\.(js|mjs|ts|py|json|md|txt|css|html)$/i.test(f.path),
        ) ||
        pro.files[0];
      await openEditor(first.path);
    }
  }
  return ok;
};
async function loadRepositoryFiles() {
  const currentRepo = repo;
  try {
    const d = await api("files");
    if (currentRepo === repo) {
      pro.files = d.files || [];
      renderHome();
    }
  } catch (e) {
    if (currentRepo === repo) toast(e.message, true);
  }
}
const proRefresh = refresh;
refresh = async function () {
  const ok = await proRefresh();
  if (ok) {
    renderHome();
    await loadRepositoryFiles();
    if (pro.file && pro.file.repo === repo && !pro.dirty && !pro.editing) {
      try {
        await openEditor(pro.file.path, pro.file.revision, { quiet: true });
      } catch (e) {
        toast(e.message, true);
      }
    }
  }
  return ok;
};
async function openEditor(path, revision = null, { quiet = false } = {}) {
  if (
    pro.dirty &&
    !quiet &&
    !confirm("Discard unsaved changes and open this file?")
  )
    return;
  const request = ++pro.fileRequest,
    currentRepo = repo,
    d = await api("file-content", { path, ...(revision ? { revision } : {}) });
  if (request !== pro.fileRequest || repo !== currentRepo) return;
  pro.file = { ...d, path, revision, repo: currentRepo, blame: [] };
  pro.editing = false;
  pro.dirty = false;
  const key = path + "@" + (revision || "working");
  if (!pro.tabs.some((t) => t.key === key))
    pro.tabs.push({ key, path, revision });
  renderEditor();
  renderHome();
  if (pro.showBlame && !d.binary) {
    try {
      const blame = await api("blame-lines", {
        path,
        ...(revision ? { revision } : {}),
      });
      if (request === pro.fileRequest && repo === currentRepo) {
        pro.file.blame = blame.lines || [];
        renderEditor();
      }
    } catch (e) {
      if (!quiet && request === pro.fileRequest)
        $("#editor-bar").append(el("span", "", "Blame unavailable"));
    }
  }
}
function syntaxLine(text, path) {
  const out = document.createDocumentFragment();
  if (/\.(md|txt|lock)$/i.test(path)) {
    out.append(document.createTextNode(text || " "));
    return out;
  }
  const tokens = text.match(
    /(?:\/\/.*|#.*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b(?:const|let|var|function|return|async|await|import|export|from|if|else|for|while|class|new|try|catch|throw|def|with|as|True|False|None|true|false|null|public|private|static|void|int|string)\b|\b\d+(?:\.\d+)?\b|[^\s\w]|\s+|\w+)/g,
  ) || [text];
  tokens.forEach((token) => {
    let cls = "";
    if (/^(\/\/|#)/.test(token)) cls = "code-comment";
    else if (/^["'`]/.test(token)) cls = "code-string";
    else if (
      /^(const|let|var|function|return|async|await|import|export|from|if|else|for|while|class|new|try|catch|throw|def|with|as|True|False|None|true|false|null|public|private|static|void|int|string)$/.test(
        token,
      )
    )
      cls = "code-keyword";
    else if (/^\d/.test(token)) cls = "code-number";
    else if (/^[{}()[\];.]$/.test(token)) cls = "code-symbol";
    out.append(cls ? el("span", cls, token) : document.createTextNode(token));
  });
  return out;
}
function renderEditor() {
  const tabs = $("#editor-tabs"),
    bar = $("#editor-bar"),
    code = $("#editor-code");
  tabs.replaceChildren();
  bar.replaceChildren();
  code.replaceChildren();
  for (const tab of pro.tabs) {
    const key = pro.file
        ? pro.file.path + "@" + (pro.file.revision || "working")
        : null,
      b = button(
        tab.path.split("/").pop() +
          (tab.revision ? " · " + tab.revision.slice(0, 7) : ""),
        safeAsync(() => openEditor(tab.path, tab.revision)),
        tab.key === key ? "active" : "",
      );
    tabs.append(b);
  }
  if (!pro.file) {
    tabs.append(el("span", "editor-tab-empty", "WORKSPACE"));
    const empty = el("div", "editor-empty");
    empty.append(
      el("div", "editor-symbol", "⌘"),
      el("strong", "", "Open a file to explore its history"),
      el(
        "p",
        "",
        "Choose a file from the explorer.\nLine authors, commit details, and your working changes stay close together.",
      ),
    );
    code.append(empty);
    return;
  }
  const f = pro.file;
  bar.append(
    el(
      "span",
      "breadcrumb",
      repo.split("/").filter(Boolean).pop() + "  ›  " + f.path,
    ),
    el(
      "span",
      "revision-label",
      f.revision ? f.revision.slice(0, 10) : "Working tree",
    ),
  );
  if (f.binary) {
    bar.append(
      button(
        "Image diff",
        safeAsync(() => imageDiff(f.path, false, f.revision)),
      ),
    );
    code.append(
      el("div", "editor-empty", "Binary file · text editor unavailable"),
    );
    return;
  }
  bar.append(
    button(
      pro.showBlame ? "Blame on" : "Blame off",
      safeAsync(async () => {
        pro.showBlame = !pro.showBlame;
        await openEditor(f.path, f.revision);
      }),
    ),
    button(
      "History",
      safeAsync(() => fileHistory(f.path)),
    ),
    button(
      "Diff",
      safeAsync(() => showDiff(f.path, false, f.revision)),
    ),
  );
  if (!f.revision) {
    bar.append(
      button(pro.editing ? "Preview" : "Edit", () => {
        if (pro.editing) {
          f.content = $("#editor-textarea").value;
          pro.editing = false;
        } else pro.editing = true;
        renderEditor();
      }),
    );
    if (pro.editing || pro.dirty)
      bar.append(button("Save", safeAsync(saveEditor), "primary"));
  }
  if (pro.editing) {
    const textarea = el("textarea", "editor-textarea");
    textarea.id = "editor-textarea";
    textarea.value = f.content;
    textarea.setAttribute("aria-label", "Edit " + f.path);
    textarea.oninput = () => {
      pro.dirty = true;
      f.content = textarea.value;
    };
    code.append(textarea);
    return;
  }
  const blameByLine = new Map((f.blame || []).map((b) => [b.line, b]));
  f.content.split("\n").forEach((text, i) => {
    const row = el("div", "code-line");
    row.append(el("span", "line-number", String(i + 1)));
    const line = el("span", "line-text");
    line.append(syntaxLine(text || " ", f.path));
    row.append(line);
    const blame = pro.showBlame ? blameByLine.get(i + 1) : null;
    if (blame) {
      const uncommitted = /^0+$/.test(blame.hash),
        note = button(
          uncommitted
            ? "Uncommitted changes"
            : blame.author +
                " · " +
                new Date(blame.date).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                }),
          safeAsync(async () => {
            if (uncommitted) {
              selected = null;
              renderWorking();
              return;
            }
            const d = await api("commit-detail", { commit: blame.hash });
            await detailCommit(d.commit);
          }),
          "inline-blame",
        );
      note.title = uncommitted
        ? "Uncommitted line"
        : `${blame.author} <${blame.email}>\n${blame.date}\n${blame.hash}\n${blame.summary}`;
      row.append(note);
    }
    code.append(row);
  });
}
async function saveEditor() {
  const f = pro.file;
  if (!f || f.revision) return;
  const content = $("#editor-textarea")?.value ?? f.content,
    currentRepo = repo,
    result = await api(
      "save-file",
      { path: f.path, content, expectedSha256: f.sha256 },
      true,
    );
  if (repo !== currentRepo) return;
  f.content = content;
  f.sha256 = result.sha256;
  pro.dirty = false;
  pro.editing = false;
  toast("File saved");
  await refresh();
}
function parseCommitQuery(query, regex = false) {
  const tokens = query.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [],
    rules = [];
  for (let raw of tokens) {
    const match = raw.match(
      /^(author|message|branch|ref|before|after|sha|hash):(.+)$/i,
    );
    const key = match ? match[1].toLowerCase() : "all",
      value = (match ? match[2] : raw).replace(/^(["'])(.*)\1$/, "$2");
    if (key === "after" || key === "before") {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value))
      )
        throw Error("Dates must use YYYY-MM-DD");
      rules.push((c) =>
        key === "after"
          ? Date.parse(c.date) >= Date.parse(value)
          : Date.parse(c.date) <= Date.parse(value + "T23:59:59"),
      );
      continue;
    }
    let matcher;
    if (regex) {
      let re;
      try {
        re = new RegExp(value, "i");
      } catch (e) {
        throw Error("Invalid regular expression: " + e.message);
      }
      matcher = (s) => re.test(String(s || ""));
    } else
      matcher = (s) =>
        String(s || "")
          .toLowerCase()
          .includes(value.toLowerCase());
    rules.push((c) =>
      matcher(
        key === "author"
          ? c.author
          : key === "message"
            ? c.subject
            : key === "branch" || key === "ref"
              ? c.refs
              : key === "sha" || key === "hash"
                ? c.hash
                : `${c.subject} ${c.author} ${c.hash} ${c.refs}`,
      ),
    );
  }
  return (c) => rules.every((test) => test(c));
}
renderLog = function () {
  if (!state) return;
  diffVersion++;
  const n = $("#commits");
  n.replaceChildren();
  let error = $("#search-error");
  if (!error) {
    error = el("p", "search-error");
    error.id = "search-error";
    $(".history-title").after(error);
  }
  let matches;
  try {
    matches = parseCommitQuery($("#search").value.trim(), pro.regex);
    error.hidden = true;
  } catch (e) {
    error.textContent = e.message;
    error.hidden = false;
    return;
  }
  const rows = graphRows(),
    laneCount = Math.max(
      1,
      ...rows.map((r) =>
        Math.max(r.before.length, ...r.segments.map((s) => Math.max(...s) + 1)),
      ),
    ),
    graphWidth = Math.max(70, Math.min(150, laneCount * 12 + 15));
  document.documentElement.style.setProperty(
    "--graph-width",
    graphWidth + "px",
  );
  const visible = rows.filter(
    ({ c }) =>
      matches(c) &&
      (!filters.author ||
        c.author.toLowerCase().includes(filters.author.toLowerCase())) &&
      (!filters.after || Date.parse(c.date) >= Date.parse(filters.after)) &&
      (!filters.before ||
        Date.parse(c.date) <= Date.parse(filters.before + "T23:59:59")) &&
      (!filters.ref ||
        String(c.refs).toLowerCase().includes(filters.ref.toLowerCase())),
  );
  if (pro.chronology)
    visible.sort(
      (a, b) =>
        a.c.author.localeCompare(b.c.author) ||
        Date.parse(b.c.date) - Date.parse(a.c.date),
    );
  let group = null;
  for (const { c, lane, segments, before } of visible) {
    if (pro.chronology && group !== c.author) {
      group = c.author;
      n.append(el("div", "author-group", c.author + " · author chronology"));
    }
    const row = button(
      "",
      () => detailCommit(c),
      "commit-row" + (selected?.hash === c.hash ? " active" : ""),
    );
    const cb = el("input", "commit-select");
    cb.type = "checkbox";
    cb.checked = pro.selection.has(c.hash);
    cb.setAttribute("aria-label", "Select commit " + c.subject);
    cb.onclick = (e) => e.stopPropagation();
    cb.onchange = () => {
      cb.checked ? pro.selection.add(c.hash) : pro.selection.delete(c.hash);
      renderBatchControls();
    };
    row.append(cb);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${graphWidth} 35`);
    svg.setAttribute("width", graphWidth);
    svg.setAttribute("aria-label", "Commit parent graph");
    const shape = (tag, attrs) => {
        const s = document.createElementNS(svg.namespaceURI, tag);
        for (const [key, value] of Object.entries(attrs))
          s.setAttribute(key, value);
        svg.append(s);
      },
      x = (i) => 15 + (i * (graphWidth - 22)) / Math.max(1, laneCount - 1),
      palette = [
        "#b881f1",
        "#81b5cf",
        "#e9b376",
        "#ce91c0",
        "#8ec6a2",
        "#8c9ee0",
      ];
    before.forEach((hash, i) => {
      if (hash)
        shape("path", {
          d: `M ${x(i)} 0 L ${x(i)} 17`,
          stroke: palette[i % 6],
          "stroke-width": 1.4,
          fill: "none",
        });
    });
    segments.forEach(([a, b]) =>
      shape("path", {
        d: `M ${x(a)} 17 C ${x(a)} 27 ${x(b)} 26 ${x(b)} 35`,
        stroke: palette[b % 6],
        "stroke-width": 1.4,
        fill: "none",
      }),
    );
    shape("circle", {
      cx: x(lane),
      cy: 17,
      r: 3,
      fill: palette[lane % 6],
      stroke: "#211329",
      "stroke-width": 1.5,
    });
    const text = el("div", "commit-text");
    text.append(el("div", "subject", c.subject));
    const hash = el("div", "hash", c.hash.slice(0, 7)),
      refs = Array.isArray(c.refs) ? c.refs.join(", ") : c.refs;
    if (refs) hash.append(el("span", "ref", refs));
    text.append(hash);
    const author = el("div", "commit-author"),
      initials = c.author
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0])
        .join("")
        .toUpperCase(),
      name = el("div", "author", c.author);
    name.append(
      el(
        "small",
        "",
        new Date(c.date).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
      ),
    );
    author.append(el("span", "avatar", initials), name);
    const stat = pro.stats.get(c.hash);
    const change = el(
      "div",
      "commit-change",
      stat ? `+${stat.added} −${stat.deleted}` : "—",
    );
    change.title = stat
      ? "Actual changed lines"
      : "Select commit to load its change statistics";
    row.append(svg, text, author, change);
    n.append(row);
  }
  if (!visible.length)
    empty(n, "No matching commits", "Try another query or clear the filters.");
  renderBatchControls();
};
function renderBatchControls() {
  const n = $("#batch-controls");
  n.hidden = !pro.selection.size;
  n.querySelector("span").textContent =
    pro.selection.size + " commits selected";
}
async function batchCherryPick() {
  const refs = state.commits
    .filter((c) => pro.selection.has(c.hash))
    .map((c) => c.hash)
    .reverse();
  if (!refs.length) return;
  if (
    !confirm(
      `Cherry-pick ${refs.length} selected commits onto ${state.branch || "HEAD"}, oldest first? Conflicts may require Continue.`,
    )
  )
    return;
  if (await mutate("batch-cherry-pick", { refs })) {
    pro.selection.clear();
    renderBatchControls();
  }
}
const proDetailCommit = detailCommit;
detailCommit = async function (c) {
  await proDetailCommit(c);
  const currentRepo = repo,
    hash = c.hash;
  if (selected?.hash !== hash) return;
  try {
    const d = await api("commit-detail", { commit: hash });
    if (repo !== currentRepo || selected?.hash !== hash) return;
    const commit = d.commit || c,
      head = $("#details .detail-heading");
    if (head) {
      if (commit.message && commit.message !== commit.subject)
        head.append(el("pre", "detail-message", commit.message));
      head.append(
        button(
          "✧ Explain this commit",
          () => showAiTask("explain-commit", { commit: hash }),
          "commit-ai",
        ),
      );
      appendAutolinks(head, commit.message || commit.subject);
    }
    const files = d.files || [];
    pro.stats.set(hash, {
      added: files.reduce((n, f) => n + (Number(f.added) || 0), 0),
      deleted: files.reduce((n, f) => n + (Number(f.deleted) || 0), 0),
    });
    renderLog();
    const summary = el("div", "detail-section");
    summary.append(
      el("div", "section-title", "CHANGES"),
      outputView(d.stat || ""),
    );
    files.forEach((f) => {
      const b = button(
        `${f.path}${f.binary ? " · binary" : `  +${f.added} −${f.deleted}`}`,
        safeAsync(() => openEditor(f.path, hash)),
        "path",
      );
      b.title = "Open committed version in editor";
      summary.append(b);
    });
    $("#details").append(summary);
  } catch (e) {
    if (selected?.hash === hash) toast(e.message, true);
  }
};
const proWorking = renderWorking;
renderWorking = function () {
  proWorking();
  const form = $(".commit-form");
  if (form) {
    const generate = button(
      "✧ Generate commit message",
      () => showAiTask("commit-message"),
      "commit-ai",
    );
    form.before(generate);
  }
  const head = $("#details .detail-heading");
  if (head)
    head.append(
      button(
        "✧ Explain working changes",
        () => showAiTask("explain-changes"),
        "commit-ai",
      ),
    );
};
fileHistory = async function (path) {
  try {
    const d = await api("file-history", { path });
    modal(
      "Visual history · " + path,
      [
        {
          note: "History follows renames. Select a commit to inspect its file version in the editor.",
        },
      ],
      () => {},
      "Close",
    );
    const timeline = el("div", "history-timeline");
    for (const c of d.commits || []) {
      const b = button(
        "",
        safeAsync(async () => {
          $("#modal").close();
          await detailCommit(c);
          await openEditor(path, c.hash);
        }),
      );
      b.append(
        el("strong", "", c.subject),
        el(
          "small",
          "",
          `${c.author} · ${new Date(c.date).toLocaleString()} · ${c.hash.slice(0, 8)}`,
        ),
      );
      timeline.append(b);
    }
    if (!d.commits?.length)
      timeline.append(el("p", "", "No file history found."));
    $("#modal-body").append(timeline);
  } catch (e) {
    toast(e.message, true);
  }
};
function autolinkRules() {
  try {
    return JSON.parse(localStorage.getItem("branchwork-autolinks") || "[]");
  } catch {
    return [];
  }
}
function appendAutolinks(target, text) {
  const list = el("div", "autolink-list");
  for (const rule of autolinkRules()) {
    if (!rule.prefix || !rule.url) continue;
    const escaped = rule.prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      re = new RegExp(escaped + "(\\d+)", "g");
    for (const match of text.matchAll(re)) {
      try {
        const url = new URL(rule.url.replace(/\{id\}/g, match[1]));
        if (!["https:", "http:"].includes(url.protocol)) continue;
        const a = el("a", "", match[0]);
        a.href = url.href;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        list.append(a);
      } catch {}
    }
  }
  if (list.children.length) target.append(list);
}
function showAutolinks() {
  const rules = autolinkRules();
  modal(
    "Custom autolinks",
    [
      {
        note: "Create links from commit references such as PROJ-123 or #42. Each rule uses a prefix and URL with {id}. Links open only when clicked.",
      },
      {
        name: "rules",
        label: "Rules (JSON array)",
        type: "textarea",
        value: JSON.stringify(rules, null, 2),
        placeholder:
          '[{"prefix":"PROJ-","url":"https://example.com/issues/{id}"}]',
      },
    ],
    (d) => {
      const parsed = JSON.parse(d.rules);
      if (
        !Array.isArray(parsed) ||
        parsed.some((r) => !r.prefix || !r.url || !/^https?:\/\//.test(r.url))
      )
        throw Error("Each rule needs prefix and an HTTP(S) URL");
      localStorage.setItem("branchwork-autolinks", JSON.stringify(parsed));
      toast("Autolink rules saved");
    },
    "Save links",
  );
}
async function showAiTask(task, options = {}) {
  modal(
    "AI · " + task,
    [
      {
        name: "prompt",
        label: "Additional instructions (optional)",
        type: "textarea",
      },
      ...(task === "changelog"
        ? [
            { name: "from", label: "Starting ref (optional)" },
            { name: "to", label: "Ending ref (optional)", value: "HEAD" },
          ]
        : []),
      {
        note: "Preview the exact context before sending to your configured cloud or MCP provider. Suggestions never run Git operations.",
      },
    ],
    async (fields) => {
      const request = { task, ...options, prompt: fields.prompt };
      if (task === "changelog" && fields.from) {
        request.from = fields.from;
        request.to = fields.to;
      }
      const preview = await service("ai-preview", request);
      $("#modal").close();
      modal(
        "Review AI context",
        [
          {
            note:
              "Destination: " +
              (typeof preview.destination === "string"
                ? preview.destination
                : JSON.stringify(preview.destination)),
          },
          {
            note: `${preview.bytes || 0} bytes${preview.truncated ? " · truncated" : ""}`,
          },
        ],
        async () => {
          const answer = await service("ai-run", {
            previewId: preview.previewId,
            confirmed: true,
          });
          $("#modal").close();
          modal("AI suggestion", [], () => {}, "Close");
          $("#modal-body").append(outputView(answer.text || answer));
          if (task === "commit-message")
            $("#modal-body").append(
              button("Insert commit draft", () => {
                drafts.set(repo, answer.text || "");
                selected = null;
                renderWorking();
                $("#modal").close();
              }),
            );
          if (task === "stash-message")
            $("#modal-body").append(
              button("Use as stash description", () =>
                runTool(() =>
                  modal(
                    "Stash changes",
                    [
                      {
                        name: "message",
                        label: "Stash description",
                        value: answer.text || "",
                      },
                    ],
                    (d) => mutate("stash", { ...d, includeUntracked: true }),
                    "Stash",
                  ),
                ),
              ),
            );
          return false;
        },
        "Send to configured provider",
      );
      $("#modal-body").append(
        outputView(
          (preview.prompt || "") +
            "\n\n" +
            (typeof preview.context === "string"
              ? preview.context
              : JSON.stringify(preview.context, null, 2)),
        ),
      );
      return false;
    },
    "Preview context",
  );
  $("#modal-body").append(
    button(
      "Configure AI / turn off",
      safeAsync(() => runTool(showAiSettings)),
    ),
  );
}
const priorAiAssistant = showAiAssistant;
showAiAssistant = function () {
  priorAiAssistant();
  const task = $("#field-task");
  for (const name of ["stash-message", "changelog"]) {
    const option = el("option", "", name);
    option.value = name;
    task.append(option);
  }
  $("#modal-body").append(
    button("Generate a changelog for a ref range", () =>
      runTool(() => showAiTask("changelog")),
    ),
  );
};
const priorMorePro = $("#more").onclick;
$("#more").onclick = () => {
  priorMorePro();
  $("#modal-body .tool-list").append(
    button("Custom autolinks →", () => runTool(showAutolinks)),
    button("AI changelog →", () => runTool(() => showAiTask("changelog"))),
    button("AI stash message →", () =>
      runTool(() => showAiTask("stash-message")),
    ),
  );
};
const originalProSettings = $("#settings").onclick;
$("#settings").onclick = () => {
  originalProSettings();
  $("#modal-body").append(
    button("Custom autolinks", () => runTool(showAutolinks)),
  );
};
const azureProviderSettings = showProviderSettings;
showProviderSettings = async function () {
  await azureProviderSettings();
  const d = await service("provider-config"),
    c = d.config || d,
    l = el("label", "", "Azure reviewer identity GUID"),
    input = el("input");
  l.htmlFor = "field-reviewerId";
  input.id = l.htmlFor;
  input.name = "reviewerId";
  input.value = c.reviewerId || "";
  $("#modal-body").append(l, input);
};
const limitedDashboard = showProviderDashboard;
showProviderDashboard = async function (kind = "pulls") {
  await limitedDashboard(kind);
  if ($("#modal-title").textContent !== "Hosting connection unavailable") {
    const d = await service("provider-list", { kind });
    if (d.limited)
      $("#modal-body").prepend(
        el(
          "p",
          "",
          "Showing the first 100 results. More may exist on the provider.",
        ),
      );
  }
};
providerDetail = async function (kind, number) {
  const requestedRepo = repo;
  const [d, settings] = await Promise.all([
    service("provider-detail", { kind, number }),
    service("provider-config"),
  ]);
  if (repo !== requestedRepo) return;
  const item = d.item || {},
    capabilities = settings.capabilities || {
      reviewEvents: ["COMMENT", "APPROVE", "REQUEST_CHANGES"],
      mergeMethods: ["merge", "squash", "rebase"],
    };
  modal(`#${number} ${item.title || ""}`, [], () => {}, "Close");
  const body = $("#modal-body");
  body.append(
    outputView(item.body || item.description || item.content?.raw || ""),
  );
  for (const warning of d.warnings || [])
    body.append(el("p", "error", warning));
  for (const key of ["files", "checks", "comments"])
    if (d[key]) {
      const fold = el("details");
      fold.append(el("summary", "", key), outputView(d[key]));
      body.append(fold);
    }
  body.append(
    button("Add comment", () =>
      runTool(() =>
        modal(
          "Post comment",
          [
            {
              name: "body",
              label: "Comment",
              type: "textarea",
              required: true,
            },
          ],
          async (x) => {
            await service("provider-comment", { kind, number, ...x });
            toast("Comment posted");
          },
          "Post comment",
        ),
      ),
    ),
  );
  if (kind === "pulls") {
    body.append(
      button("Submit review", () =>
        runTool(() => {
          modal(
            "Submit pull request review",
            [{ name: "body", label: "Review comment", type: "textarea" }],
            async (x) => {
              await service("provider-review", {
                number,
                ...x,
                event: $("#field-event").value,
              });
              toast("Review submitted");
            },
            "Submit review",
          );
          chooseField("event", "Review outcome", capabilities.reviewEvents);
        }),
      ),
      button("Merge pull request", () =>
        runTool(() => {
          modal(
            "Merge pull request",
            [
              {
                note: "Merge this remote pull request using your hosting account permissions.",
              },
            ],
            async () => {
              if (
                !confirm(
                  "Merge pull request #" + number + " on the hosting service?",
                )
              )
                return false;
              await service("provider-merge", {
                number,
                method: $("#field-method").value,
              });
              toast("Pull request merged");
            },
            "Merge on hosting service",
          );
          chooseField("method", "Merge method", capabilities.mergeMethods);
        }),
      ),
    );
  }
};
document.addEventListener("keydown", (e) => {
  if (pro.editing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    safeAsync(saveEditor)();
  }
});
window.addEventListener("beforeunload", (e) => {
  if (pro.dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
async function bootEmbeddedWorkspace() {
  const query = new URLSearchParams(location.search),
    path = query.get("repo");
  if (!path) return;
  try {
    if (!(await openRepo(path))) return;
    const hash = query.get("commit");
    if (hash) {
      const d = await api("commit-detail", { commit: hash });
      await detailCommit(d.commit);
    }
    if (query.get("view") === "ai") await showAiSettings();
  } catch (e) {
    toast(e.message, true);
  }
}
bootEmbeddedWorkspace();
const chronologyGraph = renderLog;
renderLog = function () {
  chronologyGraph();
  if (pro.chronology) {
    document
      .querySelectorAll(".commit-row svg path")
      .forEach((path) => path.remove());
    document
      .querySelectorAll(".commit-row svg")
      .forEach((svg) =>
        svg.setAttribute(
          "aria-label",
          "Commit marker in author chronology; ancestry lines hidden",
        ),
      );
  }
};
const renderBinaryEditor = renderEditor;
renderEditor = function () {
  renderBinaryEditor();
  if (pro.file?.binary && !/\.(png|jpe?g|gif|webp|bmp)$/i.test(pro.file.path)) {
    const b = [...$("#editor-bar").querySelectorAll("button")].find(
      (button) => button.textContent === "Image diff",
    );
    if (b) b.remove();
  }
};
showProviderDashboard = async function (kind = "pulls") {
  let d;
  try {
    d = await service("provider-list", { kind });
  } catch (e) {
    modal(
      "Hosting connection unavailable",
      [{ note: e.message }],
      () => {},
      "Close",
    );
    $("#modal-body").append(
      button("Configure hosting", () => runTool(showProviderSettings)),
    );
    return;
  }
  modal(kind === "pulls" ? "Pull requests" : "Issues", [], () => {}, "Close");
  const body = $("#modal-body"),
    nav = el("div", "detail-actions");
  nav.append(
    button(kind === "pulls" ? "View issues" : "View pull requests", () =>
      runTool(() =>
        showProviderDashboard(kind === "pulls" ? "issues" : "pulls"),
      ),
    ),
    button("Configure hosting", () => runTool(showProviderSettings)),
    button(kind === "pulls" ? "Create pull request" : "Create issue", () =>
      runTool(() => createProviderItem(kind)),
    ),
  );
  body.append(nav);
  if (d.limited)
    body.append(
      el(
        "p",
        "",
        "Showing the first 100 results. More may exist on the provider.",
      ),
    );
  if (!d.items?.length) body.append(el("p", "", "No items returned."));
  (d.items || []).forEach((item) => {
    const number = item.number ?? item.iid ?? item.id;
    body.append(
      button(
        `#${number} ${item.title || item.name || ""} · ${item.state || item.status || ""}`,
        () => runTool(() => providerDetail(kind, number)),
        "provider-item",
      ),
    );
  });
};
const desktopHome = switchHome;
switchHome = function (mode) {
  desktopHome(mode);
  if (innerWidth <= 700) $("main>aside").classList.add("sidebar-open");
};
$('.icon-rail [aria-label="File explorer"]').onclick = () => {
  $("main>aside").classList.toggle("sidebar-open");
  switchHome("home");
  $("#file-filter")?.focus();
};
const mobileEditor = openEditor;
openEditor = async function (...args) {
  await mobileEditor(...args);
  if (innerWidth <= 700) $("main>aside").classList.remove("sidebar-open");
};
fileHistory = async function (path) {
  const requestedRepo = repo;
  try {
    const d = await api("file-history", { path });
    if (requestedRepo !== repo) return;
    modal(
      "Visual history · " + path,
      [
        {
          note: "History follows renames. Select a commit to inspect its file version in the editor.",
        },
      ],
      () => {},
      "Close",
    );
    const timeline = el("div", "history-timeline");
    for (const c of d.commits || []) {
      const b = button(
        "",
        safeAsync(async () => {
          $("#modal").close();
          await detailCommit(c);
          await openEditor(c.path || path, c.hash);
        }),
      );
      b.append(
        el("strong", "", c.subject),
        el(
          "small",
          "",
          `${c.author} · ${new Date(c.date).toLocaleString()} · ${c.hash.slice(0, 8)}`,
        ),
      );
      timeline.append(b);
    }
    if (!d.commits?.length)
      timeline.append(el("p", "", "No file history found."));
    $("#modal-body").append(timeline);
  } catch (e) {
    if (requestedRepo === repo) toast(e.message, true);
  }
};
const durableOpenRepo = openRepo;
openRepo = async function (...args) {
  try {
    return await durableOpenRepo(...args);
  } catch (e) {
    toast(e.message, true);
    return false;
  }
};
const detailedAiSettings = showAiSettings;
showAiSettings = async function () {
  await detailedAiSettings();
  const body = $("#modal-body"),
    enabled = $("#field-enabled")?.closest("label"),
    mode = $("#field-mode"),
    modeLabel = $('label[for="field-mode"]');
  if (!enabled || !mode) return;
  enabled.classList.add("ai-enabled-control");
  modeLabel.classList.add("ai-provider-label");
  mode.classList.add("ai-provider-select");
  body.prepend(enabled, modeLabel, mode);
  const toggle = (name, visible) => {
    const input = $("#field-" + name);
    if (!input) return;
    const label = $('label[for="field-' + name + '"]');
    input.hidden = !visible;
    if (label) label.hidden = !visible;
    if (input.type === "checkbox") input.closest("label").hidden = !visible;
  };
  function update() {
    const mcp = mode.value === "mcp",
      transport = $("#field-transport");
    for (const name of ["baseUrl", "model", "apiKey", "clearKey"])
      toggle(name, !mcp);
    for (const name of ["transport", "tool", "argumentsTemplate"])
      toggle(name, mcp);
    for (const name of ["command", "args"])
      toggle(name, mcp && transport.value === "stdio");
    toggle("url", mcp && transport.value === "http");
  }
  mode.onchange = update;
  $("#field-transport").onchange = update;
  update();
};
function updateInspectorContext() {
  const target = $(".inspector-top");
  if (!target) return;
  const f = pro.file;
  if (!f && !selected) return;
  target.replaceChildren();
  if (selected) {
    target.append(
      el("p", "eyebrow", "SELECTED COMMIT"),
      el("h2", "context-title", selected.subject),
      el(
        "div",
        "context-detail",
        selected.author + "\n" + new Date(selected.date).toLocaleString(),
      ),
      el("div", "context-detail", selected.hash.slice(0, 16)),
      button("✧ Explain commit", () =>
        showAiTask("explain-commit", { commit: selected.hash }),
      ),
    );
    if (f) target.append(el("p", "context-detail", "Open file: " + f.path));
  } else if (f) {
    target.append(
      el("p", "eyebrow", "FILE CONTEXT"),
      el("h2", "context-title", f.path.split("/").pop()),
      el("div", "context-detail", f.path),
      el(
        "div",
        "context-detail",
        f.revision
          ? "Revision " + f.revision.slice(0, 12)
          : "Working tree · " + (state?.branch || "Detached HEAD"),
      ),
      el(
        "div",
        "context-detail",
        f.binary
          ? "Binary file"
          : f.content.split("\n").length +
              " lines · " +
              (f.blame?.length || 0) +
              " blamed lines",
      ),
    );
    if (f.sha256)
      target.append(
        el("div", "context-detail", "SHA256 " + f.sha256.slice(0, 16)),
      );
    target.append(
      button(
        "File history",
        safeAsync(() => fileHistory(f.path)),
      ),
      button("✧ Explain changes", () => showAiTask("explain-changes")),
    );
  }
}
const contextEditor = renderEditor;
renderEditor = function () {
  contextEditor();
  updateInspectorContext();
};
const contextCommit = detailCommit;
detailCommit = async function (...args) {
  await contextCommit(...args);
  updateInspectorContext();
};
const contextWorking = renderWorking;
renderWorking = function () {
  contextWorking();
  updateInspectorContext();
};
const compactAiSettings = showAiSettings;
showAiSettings = async function () {
  await compactAiSettings();
  const mode = $("#field-mode"),
    transport = $("#field-transport");
  for (const option of mode.options)
    option.textContent = option.value === "cloud" ? "Cloud API" : "MCP tool";
  for (const option of transport.options)
    option.textContent =
      option.value === "http" ? "HTTP server" : "Local command (stdio)";
  const discover = [...$("#modal-body").querySelectorAll("button")].find(
    (b) => b.textContent === "Discover MCP tools",
  );
  if (discover) {
    discover.textContent = "Discover tools from saved MCP settings";
    const modeChanged = mode.onchange;
    mode.onchange = () => {
      modeChanged();
      discover.hidden = mode.value !== "mcp";
    };
    discover.hidden = mode.value !== "mcp";
  }
};
