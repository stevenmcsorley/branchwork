/* Local workflow controls. All server strings are rendered as text. */
async function service(action, data = {}) {
  const r = await fetch("/api/service", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo, action, ...data }),
  });
  const d = await r.json();
  if (!r.ok || d.error)
    throw Error(
      typeof d.error === "string"
        ? d.error
        : d.error?.message || "Service request failed",
    );
  return d;
}
const baseApi = api;
api = async function (action, data = {}, write = false) {
  if (action === "push" && write) {
    data = { ...data, upstream: data.upstream ?? data.setUpstream };
    if (data.forceWithLease) {
      if (
        !confirm(
          "Push with force-with-lease? This may replace remote commits if the remote has not changed.",
        )
      )
        throw Error("Force push canceled");
      data.confirmed = true;
    }
  }
  return baseApi(action, data, write);
};
const commandApi = api;
api = async function (action, data = {}, write = false) {
  if (!write && action === "diff" && data.path && !data.commit)
    action = "patch-lines";
  return commandApi(action, data, write);
};
const baseMutate = mutate;
mutate = async function (action, data = {}) {
  if (action === "push" && !data.remote && data.branch)
    data = { ...data, remote: state.remotes[0]?.name || "origin" };
  return baseMutate(action, data);
};
function chooseField(name, label, options, value) {
  const l = el("label", "", label),
    s = el("select");
  s.name = name;
  s.id = "field-" + name;
  l.htmlFor = s.id;
  options.forEach((o) => {
    const option = el("option", "", typeof o === "string" ? o : o.label);
    option.value = typeof o === "string" ? o : o.value;
    s.append(option);
  });
  if (value !== undefined) s.value = value;
  $("#modal-body").append(l, s);
  return s;
}
function outputView(value) {
  const p = el("pre", "diff output");
  p.textContent =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return p;
}
function resultDialog(title, value) {
  modal(title, [], () => {}, "Close");
  $("#modal-body").append(outputView(value));
}
function runTool(fn) {
  $("#modal").close();
  Promise.resolve()
    .then(fn)
    .catch((e) => toast(e.message, true));
}
const baseOpenRepo = openRepo;
openRepo = async function (path) {
  const ok = await baseOpenRepo(path);
  if (ok) renderTabs();
  return ok;
};
function renderTabs() {
  let tabs = $("#repo-tabs");
  if (!tabs) {
    tabs = el("nav", "repo-tabs");
    tabs.id = "repo-tabs";
    tabs.setAttribute("aria-label", "Recent repository tabs");
    $("header").after(tabs);
  }
  tabs.replaceChildren();
  JSON.parse(localStorage.getItem("branchwork-recent") || "[]").forEach(
    (path) =>
      tabs.append(
        button(
          path.split("/").filter(Boolean).pop(),
          () => openRepo(path),
          path === repo ? "active" : "",
        ),
      ),
  );
  tabs.hidden = !repo;
}
const filters = { author: "", after: "", before: "", ref: "" };
const baseRenderLog = renderLog;
renderLog = function () {
  if (!state) return;
  const original = state.commits;
  state.commits = original.filter(
    (c) =>
      (!filters.author ||
        c.author.toLowerCase().includes(filters.author.toLowerCase())) &&
      (!filters.after || new Date(c.date) >= new Date(filters.after)) &&
      (!filters.before ||
        new Date(c.date) <= new Date(filters.before + "T23:59:59")) &&
      (!filters.ref ||
        String(c.refs).toLowerCase().includes(filters.ref.toLowerCase())),
  );
  try {
    baseRenderLog();
  } finally {
    state.commits = original;
  }
};
function showFilters() {
  modal(
    "Filter commit graph",
    [
      { name: "author", label: "Author contains", value: filters.author },
      {
        name: "after",
        label: "After date",
        type: "date",
        value: filters.after,
      },
      {
        name: "before",
        label: "Before date",
        type: "date",
        value: filters.before,
      },
      {
        name: "ref",
        label: "Decorated reference contains",
        value: filters.ref,
      },
      {
        note: "Reference filter matches branch/tag decorations on commits. Compare references to inspect all commits between branches.",
      },
    ],
    (d) => {
      Object.assign(filters, d);
      renderLog();
    },
    "Apply filters",
  );
  $("#modal-body").append(
    button("Clear filters", () => {
      Object.keys(filters).forEach((k) => (filters[k] = ""));
      renderLog();
      $("#modal").close();
    }),
  );
}
command = function (action) {
  if (action === "pull" || action === "push" || action === "fetch") {
    modal(
      action[0].toUpperCase() + action.slice(1),
      [
        {
          name: "remote",
          label: "Remote (blank uses configured default)",
          placeholder: "origin",
        },
        {
          name: "branch",
          label: "Remote branch (optional)",
          value: action === "push" ? state.branch : "",
        },
      ],
      (d) =>
        mutate(action, {
          ...d,
          policy: $("#field-policy")?.value,
          setUpstream: $("#field-upstream")?.checked || false,
          forceWithLease: $("#field-forceLease")?.checked || false,
        }),
      action,
    );
    if (action === "pull")
      chooseField(
        "policy",
        "Pull policy",
        ["ff-only", "merge", "rebase"],
        "ff-only",
      );
    if (action === "push") {
      for (const [name, label] of [
        ["upstream", "Set upstream tracking"],
        [
          "forceLease",
          "Force with lease (rewrite remote history if unchanged)",
        ],
      ]) {
        const l = el("label", "checkbox"),
          i = el("input");
        i.type = "checkbox";
        i.id = "field-" + name;
        l.append(i, el("span", "", label));
        $("#modal-body").append(l);
      }
    }
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
};
stashDetail = function (s) {
  modal(
    s.ref,
    [{ note: s.subject }],
    () => mutate("stash-pop", { ref: s.ref }),
    "Apply and remove",
  );
  $("#modal-body").append(
    button("Apply and keep", async () => {
      if (await mutate("stash-apply", { ref: s.ref })) $("#modal").close();
    }),
    button("Show patch", async () => {
      try {
        const d = await api("stash-show", { ref: s.ref });
        $("#modal-body").append(outputView(d.diff || d.output || d));
      } catch (e) {
        toast(e.message, true);
      }
    }),
    button("Drop stash", async () => {
      if (
        confirm(`Permanently drop ${s.ref}?`) &&
        (await mutate("stash-drop", { ref: s.ref }))
      )
        $("#modal").close();
    }),
  );
};
showInteractiveRebase = async function () {
  modal(
    "Interactive rebase",
    [
      {
        note: "Choose the base of a clean linear history. You can reorder, reword, edit, squash, fix up or drop commits.",
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
      const steps = commits.map((c) => ({
        ...c,
        action: "pick",
        message: c.subject,
      }));
      $("#modal").close();
      modal(
        "Review rebase plan",
        [
          {
            note: `Replay onto ${onto}, oldest first. Edit pauses the rebase for your manual changes; then use Continue. Reordering changes history.`,
          },
        ],
        () => {
          if (!confirm("Rewrite this local commit history?")) return false;
          return mutate("interactive-rebase", {
            onto,
            steps: steps.map((s) => ({
              hash: s.hash,
              action: s.action,
              ...(s.action === "reword" ? { message: s.message } : {}),
            })),
          });
        },
        "Start rebase",
      );
      const list = el("div");
      $("#modal-body").append(list);
      function draw() {
        list.replaceChildren();
        steps.forEach((c, i) => {
          const row = el("div", "rebase-row"),
            select = el("select");
          select.setAttribute("aria-label", "Action for " + c.subject);
          ["pick", "reword", "edit", "drop", "squash", "fixup"].forEach((a) => {
            const o = el("option", "", a);
            o.value = a;
            select.append(o);
          });
          select.value = c.action;
          select.onchange = () => {
            c.action = select.value;
            draw();
          };
          const text = el("div", "rebase-text");
          text.append(
            el("span", "", c.subject),
            el("small", "hash", c.hash.slice(0, 12)),
          );
          if (c.action === "reword") {
            const input = el("textarea");
            input.value = c.message;
            input.setAttribute("aria-label", "New message for " + c.subject);
            input.oninput = () => (c.message = input.value);
            text.append(input);
          }
          const up = button("↑", () => {
              [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]];
              draw();
            }),
            down = button("↓", () => {
              [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]];
              draw();
            });
          up.disabled = !i;
          down.disabled = i === steps.length - 1;
          up.setAttribute("aria-label", "Move commit earlier");
          down.setAttribute("aria-label", "Move commit later");
          row.append(select, text, up, down);
          list.append(row);
        });
      }
      draw();
      return false;
    },
    "Review plan",
  );
};
const baseShowDiff = showDiff;
showDiff = async function (path, staged = false, commit = null) {
  const expected = diffVersion + 1,
    targetRepo = repo,
    version = viewVersion;
  await baseShowDiff(path, staged, commit);
  if (
    expected !== diffVersion ||
    targetRepo !== repo ||
    version !== viewVersion
  )
    return;
  const n = $("#diff-section");
  if (!n || !path) return;
  n.append(
    button("File history", () => fileHistory(path)),
    button("Image comparison", () => imageDiff(path, staged, commit)),
  );
  if (commit) return;
  const pre = n.querySelector(".diff");
  if (!pre) return;
  const selectedLines = new Set();
  [...pre.children].forEach((line, index) => {
    if (!line.classList.contains("add") && !line.classList.contains("del"))
      return;
    const toggle = el("input");
    toggle.type = "checkbox";
    toggle.setAttribute(
      "aria-label",
      "Select changed diff line " + (index + 1),
    );
    toggle.onchange = () =>
      toggle.checked ? selectedLines.add(index) : selectedLines.delete(index);
    line.prepend(toggle);
  });
  const actions = el("div", "detail-actions");
  for (const action of [
    staged ? "unstage-lines" : "stage-lines",
    ...(!staged ? ["discard-lines"] : []),
  ])
    actions.append(
      button(
        action === "discard-lines"
          ? "Discard selected lines"
          : staged
            ? "Unstage selected lines"
            : "Stage selected lines",
        async () => {
          if (!selectedLines.size) {
            toast("Select changed lines using the checkboxes.");
            return;
          }
          if (
            action === "discard-lines" &&
            !confirm("Discard these selected changes permanently?")
          )
            return;
          await mutate(action, { path, selectedLines: [...selectedLines] });
        },
      ),
    );
  n.append(actions);
};
async function fileHistory(path) {
  const d = await api("file-history", { path });
  modal(
    "History: " + path,
    [{ note: "Follows file renames through history." }],
    () => {},
    "Close",
  );
  const body = $("#modal-body");
  (d.commits || []).forEach((c) =>
    body.append(
      button(`${c.hash.slice(0, 8)} ${c.subject}`, () => {
        $("#modal").close();
        detailCommit(c);
      }),
    ),
  );
  if (!d.commits?.length)
    body.append(outputView(d.output || "No history found."));
}
async function imageDiff(path, staged, commit) {
  const versions = commit
    ? [
        { version: "commit", commit: commit + "^" },
        { version: "commit", commit },
      ]
    : [
        {
          version: staged ? "commit" : "index",
          ...(staged ? { commit: "HEAD" } : {}),
        },
        { version: staged ? "index" : "working" },
      ];
  const results = await Promise.allSettled(
    versions.map((v) => api("image-version", { path, ...v })),
  );
  const before = results[0].status === "fulfilled" ? results[0].value : null,
    after = results[1].status === "fulfilled" ? results[1].value : null;
  if (!before && !after)
    throw Error(results.map((r) => r.reason?.message || "").join("\n"));
  modal("Image comparison: " + path, [], () => {}, "Close");
  const body = $("#modal-body");
  const source = (v) => "data:" + v.mime + ";base64," + v.base64;
  const pair = el("div", "image-pair");
  for (const [label, value] of [
    ["Before", before],
    ["After", after],
  ]) {
    const box = el("figure");
    box.append(el("figcaption", "", label));
    if (value) {
      const img = el("img");
      img.src = source(value);
      img.alt = label + " " + path;
      box.append(img);
    } else box.append(el("p", "", "File absent or unavailable"));
    pair.append(box);
  }
  body.append(pair);
  if (before && after) {
    const overlay = el("div", "image-overlay"),
      a = el("img"),
      b = el("img");
    a.src = source(before);
    b.src = source(after);
    a.alt = "Before";
    b.alt = "After overlay";
    b.style.opacity = ".5";
    overlay.append(a, b);
    const slider = el("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.value = "50";
    slider.setAttribute("aria-label", "After image opacity");
    slider.oninput = () => (b.style.opacity = Number(slider.value) / 100);
    body.append(el("p", "", "Overlay opacity"), slider, overlay);
  }
}
async function compareRefs() {
  modal(
    "Compare references",
    [
      {
        name: "from",
        label: "Base reference",
        value: "HEAD~1",
        required: true,
      },
      { name: "to", label: "Target reference", value: "HEAD", required: true },
    ],
    async (d) => {
      const result = await api("compare", d);
      $("#modal").close();
      resultDialog(
        `${d.from} → ${d.to}`,
        (result.stat || "") + "\n" + (result.diff || ""),
      );
      return false;
    },
    "Compare",
  );
}
async function showGitflow() {
  const d = await api("gitflow");
  modal(
    "Gitflow configuration",
    [
      {
        name: "main",
        label: "Production branch",
        value: d.main || "main",
        required: true,
      },
      {
        name: "develop",
        label: "Development branch",
        value: d.develop || "develop",
        required: true,
      },
      {
        name: "feature",
        label: "Feature prefix",
        value: d.feature || "feature/",
      },
      {
        name: "release",
        label: "Release prefix",
        value: d.release || "release/",
      },
      { name: "hotfix", label: "Hotfix prefix", value: d.hotfix || "hotfix/" },
    ],
    (x) => mutate("gitflow-config", x),
    "Save configuration",
  );
  for (const action of ["start", "finish"])
    $("#modal-body").append(
      button(
        action === "start"
          ? "Start feature / release / hotfix"
          : "Finish feature / release / hotfix",
        () => {
          runTool(() => {
            modal(
              "Gitflow " + action,
              [
                { name: "name", label: "Name", required: true },
                ...(action === "finish"
                  ? [{ name: "tag", label: "Release tag (optional)" }]
                  : []),
                {
                  note:
                    action === "finish"
                      ? "Finishing merges into configured branches and may create a release tag. Resolve conflicts before continuing."
                      : "Creates a branch from the configured development or production branch.",
                },
              ],
              (x) =>
                mutate("gitflow-" + action, {
                  ...x,
                  kind: $("#field-kind").value,
                }),
              action,
            );
            chooseField("kind", "Branch type", [
              "feature",
              "release",
              "hotfix",
            ]);
          });
        },
      ),
    );
}
async function resetCommit() {
  modal(
    "Reset current branch",
    [
      {
        name: "ref",
        label: "Target revision",
        value: selected?.hash || "HEAD",
        required: true,
      },
      {
        note: "Soft keeps all changes staged. Mixed keeps files and clears staging. Hard discards tracked changes and moves the branch.",
      },
    ],
    (d) => {
      const mode = $("#field-mode").value;
      if (
        !confirm(
          `Reset to ${d.ref} using ${mode} mode${mode === "hard" ? " and discard tracked changes permanently" : ""}?`,
        )
      )
        return false;
      return mutate("reset", { ...d, mode, confirmed: true });
    },
    "Reset",
  );
  chooseField("mode", "Reset mode", ["soft", "mixed", "hard"], "mixed");
}
const baseWorktrees = showWorktrees;
showWorktrees = async function () {
  await baseWorktrees();
  const d = await api("worktrees");
  const body = $("#modal-body");
  d.worktrees
    .filter((w) => !w.bare)
    .forEach((w) =>
      body.append(
        button(`${w.locked ? "Unlock" : "Lock"} ${w.path}`, () =>
          mutate(w.locked ? "worktree-unlock" : "worktree-lock", {
            path: w.path,
            reason: "Locked from Branchwork",
          }),
        ),
      ),
    );
  body.append(
    button("Prune stale worktree records", () => {
      if (confirm("Prune stale worktree administrative records?"))
        mutate("worktree-prune");
    }),
  );
};
const baseLfs = showLfs;
showLfs = async function () {
  await baseLfs();
  if (!$("#modal").open) return;
  const d = await api("lfs");
  if (!d.installed) return;
  $("#modal-body").append(
    button("Push LFS objects", () =>
      runTool(() =>
        modal(
          "Push LFS objects",
          [
            {
              name: "remote",
              label: "Remote",
              value: "origin",
              required: true,
            },
            {
              name: "ref",
              label: "Reference",
              value: state.branch || "HEAD",
              required: true,
            },
          ],
          (x) => mutate("lfs-push", x),
          "Push",
        ),
      ),
    ),
    button("Checkout downloaded LFS objects", () => mutate("lfs-checkout")),
    button("Prune local LFS cache", () => {
      if (confirm("Prune old local LFS objects using Git LFS safety checks?"))
        mutate("lfs-prune");
    }),
  );
};
async function showTags() {
  modal("Tags", [], () => {}, "Close");
  state.tags.forEach((t) => {
    const name = t.name || t;
    const row = el("div", "management-row");
    row.append(
      el("strong", "", name),
      button("Checkout", () => runTool(() => checkout(name))),
      button("Delete local tag", async () => {
        if (
          confirm("Delete local tag " + name + "?") &&
          (await mutate("tag-delete", { name }))
        ) {
          $("#modal").close();
          showTags();
        }
      }),
    );
    $("#modal-body").append(row);
  });
  $("#modal-body").append(
    button("Create tag", () =>
      runTool(() => {
        modal(
          "Create tag",
          [
            { name: "name", label: "Tag name", required: true },
            {
              name: "ref",
              label: "Revision",
              value: selected?.hash || "HEAD",
              required: true,
            },
            {
              name: "message",
              label: "Annotation (blank makes lightweight tag)",
              type: "textarea",
            },
          ],
          (d) => mutate("tag", { ...d, annotated: !!d.message }),
          "Create tag",
        );
      }),
    ),
  );
}
$("#more").onclick = () => {
  modal("Repository tools", [], () => {}, "Close");
  const list = el("div", "tool-list");
  [
    ["Interactive rebase", showInteractiveRebase],
    ["Compare references", compareRefs],
    ["Graph filters", showFilters],
    ["Gitflow", showGitflow],
    ["Tags", showTags],
    ["Reset current branch", resetCommit],
    ["Worktrees", showWorktrees],
    ["Submodules", showSubmodules],
    ["Git LFS", showLfs],
    ["Remotes", showRemotes],
    ["Repository identity", showIdentity],
    ["Reflog", showReflog],
    ["Pull requests & issues", showProviderDashboard],
    ["AI assistant", showAiAssistant],
  ].forEach(([label, fn]) =>
    list.append(button(label + " →", () => runTool(fn))),
  );
  $("#modal-body").append(list);
};
async function showAiSettings() {
  const data = await service("ai-config"),
    c = data.config || data,
    m = c.mcp || {};
  modal(
    "AI configuration",
    [
      {
        note: "AI starts off. Context is previewed before any explicit send. API keys are stored by the local server and never returned to this screen.",
      },
      {
        name: "baseUrl",
        label: "Cloud API base URL",
        value: c.baseUrl || "https://api.openai.com/v1",
      },
      { name: "model", label: "Cloud model", value: c.model || "" },
      {
        name: "apiKey",
        label: c.hasApiKey ? "API key (stored; blank retains)" : "API key",
        type: "password",
      },
      { name: "command", label: "MCP stdio command", value: m.command },
      {
        name: "args",
        label: "MCP command arguments (JSON array)",
        value: JSON.stringify(m.args || []),
      },
      { name: "url", label: "MCP HTTP URL", value: m.url },
      { name: "tool", label: "MCP tool name", value: m.tool },
      {
        name: "argumentsTemplate",
        label: "MCP tool arguments template (JSON)",
        type: "textarea",
        value: JSON.stringify(
          m.argumentsTemplate || {
            prompt: "{{prompt}}",
            context: "{{context}}",
          },
          null,
          2,
        ),
      },
    ],
    async (d) => {
      const config = {
        enabled: $("#field-enabled").checked,
        mode: $("#field-mode").value,
        baseUrl: d.baseUrl,
        model: d.model,
        apiKey: d.apiKey,
        clearKey: $("#field-clearKey").checked,
        mcp: {
          transport: $("#field-transport").value,
          command: d.command,
          args: JSON.parse(d.args),
          url: d.url,
          tool: d.tool,
          argumentsTemplate: JSON.parse(d.argumentsTemplate),
        },
      };
      await service("ai-config-save", { config });
      toast("AI configuration saved");
    },
    "Save",
  );
  chooseField("mode", "Provider mode", ["cloud", "mcp"], c.mode || "cloud");
  chooseField(
    "transport",
    "MCP transport",
    ["stdio", "http"],
    m.transport || "stdio",
  );
  for (const [name, label, checked] of [
    ["enabled", "Enable AI assistant", c.enabled],
    ["clearKey", "Delete saved cloud key", false],
  ]) {
    const l = el("label", "checkbox"),
      i = el("input");
    i.type = "checkbox";
    i.id = "field-" + name;
    i.checked = !!checked;
    l.append(i, el("span", "", label));
    $("#modal-body").append(l);
  }
  $("#modal-body").append(
    button("Discover MCP tools", async () => {
      try {
        const x = await service("mcp-tools");
        $("#modal-body").append(outputView(x.tools || x));
      } catch (e) {
        toast(e.message, true);
      }
    }),
  );
}
async function showAiAssistant() {
  modal(
    "AI assistant",
    [
      {
        name: "prompt",
        label: "Additional instructions / question",
        type: "textarea",
      },
      {
        name: "commit",
        label: "Commit (for explain-commit)",
        value: selected?.hash || "HEAD",
      },
      {
        note: "Preview repository context first. Sending shares the displayed context with your configured cloud provider or MCP tool. Suggestions never execute Git commands.",
      },
    ],
    async (d) => {
      const task = $("#field-task").value,
        request = {
          task,
          prompt: d.prompt,
          ...(task === "explain-commit" ? { commit: d.commit } : {}),
        };
      const result = await service("ai-preview", request);
      $("#modal").close();
      modal(
        "Review AI context",
        [
          {
            note:
              "Destination: " +
              (typeof result.destination === "string"
                ? result.destination
                : JSON.stringify(result.destination)),
          },
          {
            note: `${result.bytes || 0} bytes${result.truncated ? " · context truncated" : ""}`,
          },
        ],
        async () => {
          const answer = await service("ai-run", {
            previewId: result.previewId,
            confirmed: true,
          });
          $("#modal").close();
          modal("AI suggestion", [], () => {}, "Close");
          $("#modal-body").append(outputView(answer.text || answer));
          if (task === "commit-message")
            $("#modal-body").append(
              button("Insert as commit message draft", () => {
                drafts.set(repo, answer.text || "");
                selected = null;
                renderWorking();
                $("#modal").close();
              }),
            );
          return false;
        },
        "Send to configured provider",
      );
      $("#modal-body").append(
        outputView(
          (result.prompt || "") +
            "\n\n" +
            (typeof result.context === "string"
              ? result.context
              : JSON.stringify(result.context, null, 2)),
        ),
      );
      return false;
    },
    "Preview context",
  );
  chooseField("task", "AI task", [
    "explain-commit",
    "explain-changes",
    "commit-message",
    "review-changes",
    "pr-description",
    "conflict-help",
    "chat",
  ]);
  $("#modal-body").append(
    button("Configure AI / switch off", () => runTool(showAiSettings)),
  );
}
async function showProviderSettings() {
  const data = await service("provider-config"),
    c = data.config || data;
  modal(
    "Repository hosting integration",
    [
      {
        note: "Connect directly to your own hosting service. GitKraken cloud services are excluded. Blank token retains the saved token.",
      },
      {
        name: "baseUrl",
        label: "API base URL (blank uses provider default)",
        value: c.baseUrl,
      },
      {
        name: "owner",
        label: "Owner / GitLab namespace / Bitbucket workspace",
        value: c.owner,
      },
      { name: "repository", label: "Repository name", value: c.repository },
      {
        name: "organization",
        label: "Azure organization",
        value: c.organization,
      },
      { name: "project", label: "Azure project", value: c.project },
      {
        name: "username",
        label: "Bitbucket username (when using API token)",
        value: c.username,
      },
      {
        name: "token",
        label: c.hasToken ? "Token (saved; blank retains)" : "Token",
        type: "password",
      },
    ],
    async (d) => {
      await service("provider-config-save", {
        config: {
          ...d,
          type: $("#field-provider").value,
          clearToken: $("#field-clearToken").checked,
        },
      });
      toast("Hosting configuration saved");
    },
    "Save",
  );
  chooseField(
    "provider",
    "Hosting service",
    ["github", "gitlab", "bitbucket", "azure"],
    c.type || "github",
  );
  const l = el("label", "checkbox"),
    i = el("input");
  i.type = "checkbox";
  i.id = "field-clearToken";
  l.append(i, el("span", "", "Delete saved token"));
  $("#modal-body").append(l);
}
async function showProviderDashboard(kind = "pulls") {
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
}
async function createProviderItem(kind) {
  modal(
    kind === "pulls" ? "Create pull request" : "Create issue",
    [
      { name: "title", label: "Title", required: true },
      { name: "body", label: "Description", type: "textarea" },
      ...(kind === "pulls"
        ? [
            {
              name: "head",
              label: "Source branch",
              value: state.branch,
              required: true,
            },
            {
              name: "base",
              label: "Target branch",
              value: "main",
              required: true,
            },
          ]
        : []),
    ],
    async (d) => {
      await service(
        kind === "pulls" ? "provider-create-pr" : "provider-issue-create",
        d,
      );
      toast(kind === "pulls" ? "Pull request created" : "Issue created");
    },
    "Create on hosting service",
  );
}
async function providerDetail(kind, number) {
  const d = await service("provider-detail", { kind, number }),
    item = d.item || {};
  modal(`#${number} ${item.title || ""}`, [], () => {}, "Close");
  const body = $("#modal-body");
  body.append(
    outputView(item.body || item.description || item.content?.raw || ""),
  );
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
          chooseField("event", "Review outcome", [
            "COMMENT",
            "APPROVE",
            "REQUEST_CHANGES",
          ]);
        }),
      ),
      button("Merge pull request", () =>
        runTool(() => {
          modal(
            "Merge pull request",
            [
              {
                note: "This merges the remote pull request using your hosting account permissions.",
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
          chooseField("method", "Merge method", ["merge", "squash", "rebase"]);
        }),
      ),
    );
  }
}
$("#settings").onclick = () => {
  modal(
    "Workspace settings",
    [
      {
        note: "Local Git workflows, direct repository hosting integrations, and an optional AI assistant. AI is off until enabled in its configuration.",
      },
      {
        note: "Keyboard: / search · Ctrl+B branch · Ctrl+R refresh · Ctrl+Shift+S stage all · Ctrl+Shift+U unstage all · Ctrl+Enter commit. Right-click local branches for actions.",
      },
    ],
    () => {},
    "Done",
  );
  $("#modal-body").append(
    button("Configure AI", () => runTool(showAiSettings)),
    button("Configure repository hosting", () => runTool(showProviderSettings)),
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
const baseResolveFile = resolveFile;
resolveFile = async function (path) {
  await baseResolveFile(path);
  if (!$("#modal").open) return;
  const actions = el("div", "detail-actions");
  for (const choice of ["ours", "theirs", "delete"])
    actions.append(
      button(
        choice === "delete" ? "Resolve by deleting file" : "Use " + choice,
        async () => {
          if (
            confirm("Resolve " + path + " using " + choice + "?") &&
            (await mutate("resolve-conflict", { path, choice }))
          )
            $("#modal").close();
        },
      ),
    );
  $("#modal-body").prepend(actions);
};
const baseGitflow = showGitflow;
showGitflow = async function () {
  await baseGitflow();
  $("#modal-body").append(
    button("Initialize configured main / develop branches", async () => {
      if (
        confirm("Create missing Gitflow branches and switch to develop?") &&
        (await mutate("gitflow-init"))
      )
        $("#modal").close();
    }),
  );
};
const baseBranchActions = branchActions;
branchActions = function (name) {
  baseBranchActions(name);
  $("#modal-body").append(
    button("Set upstream", () =>
      runTool(() =>
        modal(
          "Set branch upstream",
          [
            {
              name: "upstream",
              label: "Remote tracking branch",
              placeholder: "origin/" + name,
              required: true,
            },
          ],
          (d) => mutate("branch-upstream", { name, ...d }),
          "Set upstream",
        ),
      ),
    ),
  );
};
const basicAiSettings = showAiSettings;
showAiSettings = async function () {
  await basicAiSettings();
  const d = await service("ai-config");
  $("#modal-body").prepend(
    el(
      "p",
      "",
      "Secret storage: " +
        (d.secretStorage || d.config?.secretStorage || "local server"),
    ),
  );
};
const basicProviderSettings = showProviderSettings;
showProviderSettings = async function () {
  await basicProviderSettings();
  const d = await service("provider-config");
  $("#modal-body").prepend(
    el(
      "p",
      "",
      "Secret storage: " +
        (d.secretStorage || d.config?.secretStorage || "local server"),
    ),
  );
  const label = $('label[for="field-project"]');
  if (label)
    label.textContent = "Azure project / GitLab project ID or namespace path";
  const defaults = {
      github: "https://api.github.com",
      gitlab: "https://gitlab.com/api/v4",
      bitbucket: "https://api.bitbucket.org/2.0",
      azure: "https://dev.azure.com",
    },
    select = $("#field-provider");
  let previous = select.value;
  select.onchange = () => {
    const input = $("#field-baseUrl");
    if (!input.value || input.value.replace(/\/$/, "") === defaults[previous])
      input.value = defaults[select.value];
    previous = select.value;
  };
};
const guardedDiff = showDiff;
showDiff = async function (path, staged = false, commit = null) {
  const expected = diffVersion + 1,
    targetRepo = repo,
    version = viewVersion;
  await guardedDiff(path, staged, commit);
  if (
    expected !== diffVersion ||
    targetRepo !== repo ||
    version !== viewVersion
  )
    return;
  const n = $("#diff-section");
  if (!n) return;
  const imgButton = [...n.querySelectorAll("button")].find(
    (b) => b.textContent === "Image comparison",
  );
  if (imgButton)
    imgButton.disabled = !/\.(png|jpe?g|gif|webp|bmp)$/i.test(path || "");
};
const sidedResolve = resolveFile;
resolveFile = async function (path) {
  await sidedResolve(path);
  const d = await api("conflict", { path });
  if (d.binary && $("#modal").open) {
    $("#field-content")?.remove();
    $('label[for="field-content"]')?.remove();
    $("#modal-submit").hidden = true;
    $("#modal-body").prepend(
      el(
        "p",
        "",
        "Binary conflict: choose ours, theirs, or delete. Text editing is unavailable.",
      ),
    );
  }
};
async function showSigning() {
  const d = await api("signing-config");
  modal(
    "Commit signing",
    [
      { name: "key", label: "Signing key ID (optional)", value: d.key },
      {
        note: "Uses Git’s configured GPG or SSH signing program. The required program and key must already be available on this machine.",
      },
    ],
    (x) =>
      mutate("signing-config", { ...x, enabled: $("#field-signing").checked }),
    "Save",
  );
  const l = el("label", "checkbox"),
    i = el("input");
  i.type = "checkbox";
  i.id = "field-signing";
  i.checked = d.enabled;
  l.append(i, el("span", "", "Sign commits"));
  $("#modal-body").append(l);
}
async function showIgnore() {
  const d = await api("gitignore");
  modal(
    "Repository .gitignore",
    [
      {
        name: "content",
        label: "Ignored path patterns",
        type: "textarea",
        value: d.content,
      },
    ],
    (x) => mutate("gitignore", x),
    "Save .gitignore",
  );
  $("#field-content").style.minHeight = "240px";
}
const moreTools = $("#more").onclick;
$("#more").onclick = () => {
  moreTools();
  const list = $("#modal-body .tool-list");
  list.append(
    button("Commit signing →", () => runTool(showSigning)),
    button("Edit .gitignore →", () => runTool(showIgnore)),
  );
};
function showBranchRebase() {
  modal(
    "Rebase current branch",
    [
      {
        name: "ref",
        label: "Target reference",
        placeholder: "main",
        required: true,
      },
      {
        note: "Replay the current branch onto the target. This rewrites commit hashes. Preserve merges reconstructs merge commits using Git’s rebase-merges mode; conflicts may require manual resolution followed by Continue.",
      },
    ],
    (d) => {
      if (
        !confirm(
          "Rebase the current branch onto " +
            d.ref +
            " and rewrite its history?",
        )
      )
        return false;
      return mutate("rebase", {
        ref: d.ref,
        preserveMerges: $("#field-preserveMerges").checked,
      });
    },
    "Start rebase",
  );
  const l = el("label", "checkbox"),
    i = el("input");
  i.type = "checkbox";
  i.id = "field-preserveMerges";
  l.append(i, el("span", "", "Preserve merge topology"));
  $("#modal-body").append(l);
}
const completeTools = $("#more").onclick;
$("#more").onclick = () => {
  completeTools();
  $("#modal-body .tool-list").append(
    button("Rebase current branch →", () => runTool(showBranchRebase)),
  );
};
const directImageDiff = imageDiff;
imageDiff = async function (...args) {
  try {
    return await directImageDiff(...args);
  } catch (e) {
    toast(e.message, true);
  }
};
const directFileHistory = fileHistory;
fileHistory = async function (...args) {
  try {
    return await directFileHistory(...args);
  } catch (e) {
    toast(e.message, true);
  }
};
