import { safeURL } from "./integrations.mjs";
const enc = encodeURIComponent;
export const providerDefaults = {
  github: "https://api.github.com",
  gitlab: "https://gitlab.com/api/v4",
  bitbucket: "https://api.bitbucket.org/2.0",
  azure: "https://dev.azure.com",
};
const defaults = providerDefaults;
export function providerCapabilities(type = "github") {
  return {
    reviewEvents:
      type === "gitlab"
        ? ["APPROVE", "COMMENT"]
        : ["APPROVE", "REQUEST_CHANGES", "COMMENT"],
    mergeMethods: ["github", "azure"].includes(type)
      ? ["merge", "squash", "rebase"]
      : ["merge", "squash"],
  };
}
const rows = (x) => (Array.isArray(x) ? x : x?.values || x?.value || []);
function normalize(x, type) {
  const f = x.fields || {};
  const bool = (v) => (typeof v === "boolean" ? v : null);
  const draft = bool(x.draft ?? x.work_in_progress ?? x.isDraft),
    conflicts =
      typeof x.has_conflicts === "boolean"
        ? x.has_conflicts
        : typeof x.mergeable === "boolean"
          ? !x.mergeable
          : x.mergeStatus === "conflicts"
            ? true
            : x.mergeStatus === "succeeded"
              ? false
              : null;
  const reviewState =
    typeof x.reviewDecision === "string"
      ? x.reviewDecision
      : Array.isArray(x.requested_reviewers) && x.requested_reviewers.length
        ? "review-requested"
        : null;
  const checksState =
    typeof x.checksState === "string"
      ? x.checksState
      : typeof x.pipeline?.status === "string"
        ? x.pipeline.status
        : typeof x.head_pipeline?.status === "string"
          ? x.head_pipeline.status
          : null;
  return {
    number: x.number ?? x.iid ?? x.pullRequestId ?? x.id,
    title: x.title || f["System.Title"] || "",
    state: x.state || x.status || f["System.State"] || "",
    author:
      x.user?.login ||
      x.author?.username ||
      x.author?.display_name ||
      x.createdBy?.displayName ||
      f["System.CreatedBy"]?.displayName ||
      "",
    url:
      x.html_url ||
      x.web_url ||
      x.links?.html?.href ||
      x._links?.html?.href ||
      "",
    body:
      x.body ||
      x.description ||
      x.content?.raw ||
      f["System.Description"] ||
      "",
    head:
      x.head?.ref ||
      x.source_branch ||
      x.source?.branch?.name ||
      x.sourceRefName ||
      "",
    base:
      x.base?.ref ||
      x.target_branch ||
      x.destination?.branch?.name ||
      x.targetRefName ||
      "",
    sha: x.head?.sha || x.lastMergeSourceCommit?.commitId,
    draft,
    conflicts,
    reviewState,
    checksState,
  };
}
export function createProvider(config, fetchImpl = fetch) {
  const type = config.type || "github";
  if (!defaults[type]) throw new Error("Unsupported provider");
  const root = (config.baseUrl || defaults[type]).replace(/\/$/, "");
  safeURL(root);
  const repo =
    type === "github"
      ? `/repos/${enc(config.owner)}/${enc(config.repository)}`
      : type === "gitlab"
        ? `/projects/${enc(config.project || config.owner + "/" + config.repository)}`
        : type === "bitbucket"
          ? `/repositories/${enc(config.owner)}/${enc(config.repository)}`
          : `/${enc(config.organization)}/${enc(config.project)}/_apis/git/repositories/${enc(config.repository)}`;
  const collection = (kind) =>
    kind === "issues"
      ? "issues"
      : type === "gitlab"
        ? "merge_requests"
        : type === "bitbucket"
          ? "pullrequests"
          : type === "azure"
            ? "pullrequests"
            : "pulls";
  const token = config.token || process.env.BRANCHWORK_PROVIDER_TOKEN || "";
  const headers = {
    Accept: "application/json",
    ...(type === "gitlab"
      ? { "PRIVATE-TOKEN": token }
      : type === "azure" || (type === "bitbucket" && config.username)
        ? {
            Authorization:
              "Basic " +
              Buffer.from(
                (type === "azure" ? "" : config.username) + ":" + token,
              ).toString("base64"),
          }
        : { Authorization: `Bearer ${token}` }),
  };
  async function request(
    p,
    method = "GET",
    body,
    contentType = "application/json",
  ) {
    if (!token) throw new Error("Configure a hosting provider token");
    const u = safeURL(root + p);
    if (type === "azure")
      u.searchParams.set(
        "api-version",
        p.includes("/_apis/wit/") && p.includes("/comments")
          ? "7.1-preview.4"
          : "7.1",
      );
    let r;
    try {
      r = await fetchImpl(u, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: { ...headers, "Content-Type": contentType },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new Error("Hosting provider request failed");
    }
    if (!r.ok)
      throw new Error(
        `Hosting provider request failed (HTTP ${r.status}); check permissions and repository settings`,
      );
    if (r.status === 204) return {};
    try {
      return await r.json();
    } catch {
      throw new Error("Hosting provider returned an invalid response");
    }
  }
  const number = (n) => {
    if (!/^\d+$/.test(String(n))) throw new Error("Valid item number required");
    return String(n);
  };
  const text = (v, label) => {
    if (typeof v !== "string" || !v.trim())
      throw new Error(`${label} required`);
    return v;
  };
  const azureWit = `/${enc(config.organization)}/${enc(config.project)}/_apis/wit`;
  async function list(body) {
    const kind = body.kind === "issues" ? "issues" : "pulls";
    if (type === "azure" && kind === "issues") {
      const q = await request(azureWit + "/wiql", "POST", {
        query:
          "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project ORDER BY [System.ChangedDate] DESC",
      });
      const ids = (q.workItems || [])
        .slice(0, 100)
        .map((w) => w.id)
        .join(",");
      return {
        items: ids
          ? rows(await request(azureWit + "/workitems?ids=" + ids)).map((x) =>
              normalize(x, type),
            )
          : [],
        limited: (q.workItems || []).length > 100,
      };
    }
    let state = body.state || "open";
    if (type === "gitlab") state = state === "open" ? "opened" : state;
    if (type === "bitbucket") state = state.toUpperCase();
    const query =
      type === "azure"
        ? `?searchCriteria.status=${enc(state === "open" ? "active" : state)}&$top=100`
        : type === "bitbucket" && kind === "issues"
          ? "?pagelen=100"
          : `?state=${enc(state)}&${type === "bitbucket" ? "pagelen" : "per_page"}=100`;
    let result = await request(repo + "/" + collection(kind) + query);
    return {
      items: rows(result)
        .filter(
          (x) => kind !== "issues" || type !== "github" || !x.pull_request,
        )
        .map((x) => normalize(x, type)),
      limited: Boolean(result.next) || rows(result).length === 100,
    };
  }
  return {
    async handle(body) {
      const kind = body.kind === "issues" ? "issues" : "pulls";
      const itemPath = () =>
        type === "azure" && kind === "issues"
          ? azureWit + "/workitems/" + number(body.number)
          : repo + "/" + collection(kind) + "/" + number(body.number);
      switch (body.action) {
        case "provider-list":
          return list(body);
        case "provider-detail": {
          const p = itemPath(),
            item = await request(p),
            warnings = [];
          const optional = async (section, fn) => {
            try {
              return await fn();
            } catch {
              warnings.push(
                `${section} unavailable; check provider permissions and API support`,
              );
              return [];
            }
          };
          let comments = [],
            files = [],
            checks = [];
          if (type === "github") {
            comments = await optional("Comments", async () =>
              rows(
                await request(
                  repo + "/issues/" + number(body.number) + "/comments",
                ),
              ),
            );
            if (kind === "pulls") {
              files = await optional("Files", async () =>
                rows(await request(p + "/files")),
              );
              if (item.head?.sha)
                checks = await optional("Checks", async () =>
                  rows(
                    (
                      await request(
                        repo + "/commits/" + enc(item.head.sha) + "/check-runs",
                      )
                    ).check_runs || [],
                  ),
                );
            }
          } else if (type === "gitlab") {
            comments = await optional("Comments", async () =>
              rows(await request(p + "/notes")),
            );
            if (kind === "pulls") {
              files = await optional("Files", async () =>
                rows(await request(p + "/diffs")),
              );
              checks = await optional("Checks", async () =>
                rows(await request(p + "/pipelines")),
              );
            }
          } else if (type === "bitbucket") {
            comments = await optional("Comments", async () =>
              rows(await request(p + "/comments")),
            );
            if (kind === "pulls") {
              files = await optional("Files", async () =>
                rows(await request(p + "/diffstat")),
              );
              if (item.source?.commit?.hash)
                checks = await optional("Checks", async () =>
                  rows(
                    await request(
                      repo +
                        "/commit/" +
                        enc(item.source.commit.hash) +
                        "/statuses",
                    ),
                  ),
                );
            }
          } else if (kind === "issues")
            comments = await optional("Comments", async () =>
              rows((await request(p + "/comments")).comments || []),
            );
          else {
            comments = await optional("Comments", async () =>
              rows(await request(p + "/threads")),
            );
            checks = await optional("Checks", async () =>
              rows(await request(p + "/statuses")),
            );
            files = await optional("Files", async () => {
              const iterations = rows(await request(p + "/iterations")),
                latest = iterations.reduce((m, x) => Math.max(m, x.id || 0), 0);
              return latest
                ? (await request(p + "/iterations/" + latest + "/changes"))
                    .changeEntries || []
                : [];
            });
          }
          return {
            item: normalize(item, type),
            warnings,
            comments: comments.map((c) => ({
              id: c.id,
              body:
                c.body ||
                c.note ||
                c.text ||
                c.content?.raw ||
                c.comments?.map((v) => v.content).join("\n") ||
                "",
              author:
                c.user?.login ||
                c.author?.username ||
                c.user?.display_name ||
                c.author?.displayName ||
                "",
            })),
            files: files.map((f) => ({
              path:
                f.filename || f.new_path || f.new?.path || f.item?.path || f.id,
              patch: f.patch || f.diff || "",
              status: f.status || f.changeType || f.type || "",
            })),
            checks: checks.map((c) => ({
              name: c.name || c.context?.name || c.status || "",
              state: c.conclusion || c.state || c.status || "",
              url: c.html_url || c.web_url || c.url || "",
            })),
          };
        }
        case "provider-create-pr": {
          const title = text(body.title, "Title"),
            head = text(body.head, "Source branch"),
            base = text(body.base, "Target branch"),
            description = body.body || "";
          const payload =
            type === "github"
              ? { title, head, base, body: description }
              : type === "gitlab"
                ? {
                    title,
                    source_branch: head,
                    target_branch: base,
                    description,
                  }
                : type === "bitbucket"
                  ? {
                      title,
                      description,
                      source: { branch: { name: head } },
                      destination: { branch: { name: base } },
                    }
                  : {
                      title,
                      description,
                      sourceRefName: head.startsWith("refs/")
                        ? head
                        : "refs/heads/" + head,
                      targetRefName: base.startsWith("refs/")
                        ? base
                        : "refs/heads/" + base,
                    };
          return {
            item: normalize(
              await request(repo + "/" + collection("pulls"), "POST", payload),
              type,
            ),
          };
        }
        case "provider-issue-create": {
          const title = text(body.title, "Title"),
            description = body.body || "";
          if (type === "azure")
            return {
              item: normalize(
                await request(
                  azureWit + "/workitems/$" + enc(body.workItemType || "Issue"),
                  "POST",
                  [
                    { op: "add", path: "/fields/System.Title", value: title },
                    {
                      op: "add",
                      path: "/fields/System.Description",
                      value: description,
                    },
                  ],
                  "application/json-patch+json",
                ),
                type,
              ),
            };
          const payload =
            type === "github"
              ? { title, body: description }
              : type === "gitlab"
                ? { title, description }
                : {
                    title,
                    content: { raw: description },
                    kind: "bug",
                    priority: "major",
                  };
          return {
            item: normalize(
              await request(repo + "/issues", "POST", payload),
              type,
            ),
          };
        }
        case "provider-comment": {
          const content = text(body.body, "Comment");
          let p = itemPath(),
            payload;
          if (type === "github") {
            p = repo + "/issues/" + number(body.number) + "/comments";
            payload = { body: content };
          } else if (type === "gitlab") {
            p += "/notes";
            payload = { body: content };
          } else if (type === "bitbucket") {
            p += "/comments";
            payload = { content: { raw: content } };
          } else if (kind === "issues") {
            p += "/comments";
            payload = { text: content };
          } else {
            p += "/threads";
            payload = {
              comments: [{ parentCommentId: 0, content, commentType: 1 }],
              status: 1,
            };
          }
          await request(p, "POST", payload);
          return { output: "Comment posted" };
        }
        case "provider-review": {
          const event = body.event || "COMMENT";
          if (!["APPROVE", "REQUEST_CHANGES", "COMMENT"].includes(event))
            throw new Error("Unsupported review event");
          const p =
            repo + "/" + collection("pulls") + "/" + number(body.number);
          if (type === "github")
            await request(p + "/reviews", "POST", {
              event,
              body: body.body || "",
            });
          else if (type === "gitlab") {
            if (event === "REQUEST_CHANGES")
              throw new Error(
                "GitLab request changes is unavailable in this adapter; post a review comment",
              );
            if (body.body)
              await request(p + "/notes", "POST", { body: body.body });
            if (event === "APPROVE") await request(p + "/approve", "POST", {});
          } else if (type === "bitbucket") {
            if (body.body)
              await request(p + "/comments", "POST", {
                content: { raw: body.body },
              });
            if (event !== "COMMENT")
              await request(
                p + (event === "APPROVE" ? "/approve" : "/request-changes"),
                "POST",
                {},
              );
          } else {
            if (event === "COMMENT")
              return this.handle({
                ...body,
                action: "provider-comment",
                kind: "pulls",
              });
            if (!config.reviewerId)
              throw new Error(
                "Configure your Azure reviewerId to submit a vote",
              );
            await request(p + "/reviewers/" + enc(config.reviewerId), "PUT", {
              vote: event === "APPROVE" ? 10 : -10,
            });
          }
          return { output: "Review submitted" };
        }
        case "provider-merge": {
          const method = body.method || "merge";
          if (!providerCapabilities(type).mergeMethods.includes(method))
            throw new Error("Unsupported merge method for this provider");
          const p =
            repo + "/" + collection("pulls") + "/" + number(body.number);
          if (type === "github") {
            const result = await request(p + "/merge", "PUT", {
              merge_method: method,
            });
            if (result.merged !== true)
              throw new Error(
                "Provider did not merge the pull request; refresh checks and resolve conflicts",
              );
          } else if (type === "gitlab")
            await request(p + "/merge", "PUT", { squash: method === "squash" });
          else if (type === "bitbucket")
            await request(p + "/merge", "POST", {
              merge_strategy: method === "squash" ? "squash" : "merge_commit",
            });
          else {
            const item = await request(p);
            await request(p, "PATCH", {
              status: "completed",
              lastMergeSourceCommit: item.lastMergeSourceCommit,
              completionOptions: {
                mergeStrategy:
                  method === "squash"
                    ? "squash"
                    : method === "rebase"
                      ? "rebase"
                      : "noFastForward",
              },
            });
          }
          return {
            output: "Merge request submitted; refresh to check final state",
          };
        }
        default:
          throw new Error("Unsupported provider action");
      }
    },
  };
}
