type Env = { token: string; owner: string; repo: string; base: string };

function env(): Env {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const base = process.env.GITHUB_BASE_BRANCH || "master";
  if (!token || !owner || !repo) {
    throw new Error("GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO must be set.");
  }
  return { token, owner, repo, base };
}

// Branch names contain '/'. Encode each path segment individually so the
// slash stays a path separator (encodeURIComponent('/') gives '%2F', which
// GitHub treats as a literal char in the ref name → 404).
function refPath(branch: string): string {
  return branch.split("/").map(encodeURIComponent).join("/");
}

async function gh(pathname: string, init: RequestInit = {}): Promise<Response> {
  const { token } = env();
  const res = await fetch(`https://api.github.com${pathname}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "cmsbar",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  return res;
}

async function ghJson<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  const res = await gh(pathname, init);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `GitHub ${init.method || "GET"} ${pathname} failed: ${res.status} ${body}`,
    );
  }
  return (await res.json()) as T;
}

export async function getBranchSha(branch: string): Promise<string | null> {
  const { owner, repo } = env();
  const res = await gh(
    `/repos/${owner}/${repo}/git/ref/heads/${refPath(branch)}`,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getBranchSha ${branch} failed: ${res.status}`);
  const data = (await res.json()) as { object: { sha: string } };
  return data.object.sha;
}

export async function ensureBranch(
  branch: string,
): Promise<{ created: boolean; sha: string }> {
  const { owner, repo, base } = env();
  const existing = await getBranchSha(branch);
  if (existing) return { created: false, sha: existing };
  const baseSha = await getBranchSha(base);
  if (!baseSha) throw new Error(`Base branch ${base} not found`);
  const res = await gh(`/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
  });
  if (res.ok) {
    const data = (await res.json()) as { object: { sha: string } };
    return { created: true, sha: data.object.sha };
  }
  // 422 with "Reference already exists" → another request raced us. Fetch and return.
  if (res.status === 422) {
    const again = await getBranchSha(branch);
    if (again) return { created: false, sha: again };
  }
  const text = await res.text();
  throw new Error(`ensureBranch ${branch} failed: ${res.status} ${text}`);
}

// Delete a branch (git ref). If the branch has an open PR, GitHub closes that
// PR automatically. Treats an already-gone ref as success.
export async function deleteBranch(branch: string): Promise<void> {
  const { owner, repo } = env();
  const res = await gh(
    `/repos/${owner}/${repo}/git/refs/heads/${refPath(branch)}`,
    {
      method: "DELETE",
    },
  );
  if (!res.ok && res.status !== 404 && res.status !== 422) {
    const text = await res.text();
    throw new Error(`deleteBranch ${branch} failed: ${res.status} ${text}`);
  }
}

export type FileContents = { content: string; sha: string };

// Fetches a file at a branch as raw bytes - used by the image proxy so we
// don't corrupt binary content by round-tripping it through utf8.
export async function getFileBinary(
  branch: string,
  filepath: string,
): Promise<{ bytes: Buffer; sha: string } | null> {
  const { owner, repo } = env();
  const res = await gh(
    `/repos/${owner}/${repo}/contents/${filepath}?ref=${refPath(branch)}`,
  );
  if (res.status === 404) return null;
  if (!res.ok)
    throw new Error(
      `getFileBinary ${filepath}@${branch} failed: ${res.status}`,
    );
  const data = (await res.json()) as {
    content: string;
    sha: string;
    encoding: string;
  };
  if (data.encoding !== "base64") {
    throw new Error(`Unexpected encoding ${data.encoding}`);
  }
  return { bytes: Buffer.from(data.content, "base64"), sha: data.sha };
}

export async function getFile(
  branch: string,
  filepath: string,
): Promise<FileContents | null> {
  const { owner, repo } = env();
  const res = await gh(
    `/repos/${owner}/${repo}/contents/${filepath}?ref=${refPath(branch)}`,
  );
  if (res.status === 404) return null;
  if (!res.ok)
    throw new Error(`getFile ${filepath}@${branch} failed: ${res.status}`);
  const data = (await res.json()) as {
    content: string;
    sha: string;
    encoding: string;
  };
  const content =
    data.encoding === "base64"
      ? Buffer.from(data.content, "base64").toString("utf8")
      : data.content;
  return { content, sha: data.sha };
}

export async function putFile(args: {
  branch: string;
  filepath: string;
  contentBase64: string;
  message: string;
  sha?: string;
}): Promise<void> {
  const { owner, repo } = env();
  const body: Record<string, unknown> = {
    message: args.message,
    content: args.contentBase64,
    branch: args.branch,
  };
  if (args.sha) body.sha = args.sha;
  const res = await gh(`/repos/${owner}/${repo}/contents/${args.filepath}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `putFile ${args.filepath}@${args.branch} failed: ${res.status} ${text}`,
    );
  }
}

export async function createPullRequest(args: {
  head: string;
  title: string;
  body?: string;
  draft?: boolean;
}): Promise<{ number: number; html_url: string }> {
  const { owner, repo, base } = env();
  return ghJson(`/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: args.title,
      head: args.head,
      base,
      body: args.body || "",
      draft: !!args.draft,
    }),
  });
}

export async function findOpenPullRequest(
  head: string,
): Promise<PullRequestSummary | null> {
  const { owner, repo } = env();
  const res = await ghJson<PullRequestSummary[]>(
    `/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(
      `${owner}:${head}`,
    )}`,
  );
  return res[0] || null;
}

export type PullRequestSummary = {
  number: number;
  html_url: string;
  title: string;
  body?: string;
  state: "open" | "closed";
  draft: boolean;
  head: { ref: string; sha: string };
  user: { login: string } | null;
  labels: { name: string }[];
  updated_at: string;
  comments?: number;
};

export async function getPullRequest(
  prNumber: number,
): Promise<PullRequestSummary> {
  const { owner, repo } = env();
  return ghJson<PullRequestSummary>(
    `/repos/${owner}/${repo}/pulls/${prNumber}`,
  );
}

export async function listOpenPullRequests(
  headPrefix?: string,
): Promise<PullRequestSummary[]> {
  const { owner, repo } = env();
  const all = await ghJson<PullRequestSummary[]>(
    `/repos/${owner}/${repo}/pulls?state=open&per_page=100&sort=updated&direction=desc`,
  );
  if (!headPrefix) return all;
  return all.filter((p) => p.head.ref.startsWith(headPrefix));
}

export async function countCommits(
  branch: string,
  base: string,
): Promise<number> {
  const { owner, repo } = env();
  const data = await ghJson<{
    ahead_by: number;
    behind_by: number;
    total_commits: number;
  }>(`/repos/${owner}/${repo}/compare/${refPath(base)}...${refPath(branch)}`);
  return data.ahead_by ?? data.total_commits ?? 0;
}

type TreeEntry = {
  path: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
};

export async function listTree(
  branch: string,
  prefix?: string,
): Promise<TreeEntry[]> {
  const { owner, repo } = env();
  const ref = await ghJson<{ object: { sha: string } }>(
    `/repos/${owner}/${repo}/git/ref/heads/${refPath(branch)}`,
  );
  const commit = await ghJson<{ tree: { sha: string } }>(
    `/repos/${owner}/${repo}/git/commits/${ref.object.sha}`,
  );
  const tree = await ghJson<{ tree: TreeEntry[]; truncated: boolean }>(
    `/repos/${owner}/${repo}/git/trees/${commit.tree.sha}?recursive=1`,
  );
  const entries = tree.tree.filter((e) => e.type === "blob");
  if (!prefix) return entries;
  const p = prefix.replace(/^\/+|\/+$/g, "");
  return entries.filter((e) => e.path.startsWith(p + "/") || e.path === p);
}

export async function deleteFile(args: {
  branch: string;
  filepath: string;
  message: string;
}): Promise<void> {
  const { owner, repo } = env();
  const cur = await getFile(args.branch, args.filepath);
  if (!cur)
    throw new Error(`File ${args.filepath} not found on ${args.branch}`);
  const res = await gh(`/repos/${owner}/${repo}/contents/${args.filepath}`, {
    method: "DELETE",
    body: JSON.stringify({
      message: args.message,
      branch: args.branch,
      sha: cur.sha,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `deleteFile ${args.filepath}@${args.branch} failed: ${res.status} ${text}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Git Data API - used to batch multiple file changes into a single commit.
// ─────────────────────────────────────────────────────────────────────────────

export type TreeChange =
  | { path: string; mode: "100644"; type: "blob"; sha: string } // add or update via existing blob
  | { path: string; mode: "100644"; type: "blob"; sha: null }; // delete (sha:null in tree means remove)

export async function createBlob(contentBase64: string): Promise<string> {
  const { owner, repo } = env();
  const data = await ghJson<{ sha: string }>(
    `/repos/${owner}/${repo}/git/blobs`,
    {
      method: "POST",
      body: JSON.stringify({ content: contentBase64, encoding: "base64" }),
    },
  );
  return data.sha;
}

export async function getCommit(
  commitSha: string,
): Promise<{ tree: { sha: string } }> {
  const { owner, repo } = env();
  return ghJson(`/repos/${owner}/${repo}/git/commits/${commitSha}`);
}

export async function createTree(args: {
  baseTreeSha: string;
  changes: TreeChange[];
}): Promise<string> {
  const { owner, repo } = env();
  const data = await ghJson<{ sha: string }>(
    `/repos/${owner}/${repo}/git/trees`,
    {
      method: "POST",
      body: JSON.stringify({ base_tree: args.baseTreeSha, tree: args.changes }),
    },
  );
  return data.sha;
}

export async function createCommit(args: {
  message: string;
  treeSha: string;
  parentSha: string;
}): Promise<string> {
  const { owner, repo } = env();
  const data = await ghJson<{ sha: string }>(
    `/repos/${owner}/${repo}/git/commits`,
    {
      method: "POST",
      body: JSON.stringify({
        message: args.message,
        tree: args.treeSha,
        parents: [args.parentSha],
      }),
    },
  );
  return data.sha;
}

// ─────────────────────────────────────────────────────────────────────────────
// Issues - the CMS bar files content/UX issues straight to GitHub. Requires the
// PAT to also have "Issues: Read and write" (see .env.example / manual-todo).
// ─────────────────────────────────────────────────────────────────────────────

export type IssueSummary = {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  html_url: string;
  labels: { name: string }[];
  updated_at: string;
  user: { login: string } | null;
};

export async function createIssue(args: {
  title: string;
  body?: string;
  labels?: string[];
}): Promise<IssueSummary> {
  const { owner, repo } = env();
  return ghJson<IssueSummary>(`/repos/${owner}/${repo}/issues`, {
    method: "POST",
    body: JSON.stringify({
      title: args.title,
      body: args.body || "",
      labels: args.labels || [],
    }),
  });
}

export async function listIssues(
  args: {
    labels?: string;
    state?: "open" | "closed" | "all";
  } = {},
): Promise<IssueSummary[]> {
  const { owner, repo } = env();
  const params = new URLSearchParams({
    state: args.state || "all",
    per_page: "100",
    sort: "updated",
    direction: "desc",
  });
  if (args.labels) params.set("labels", args.labels);
  const all = await ghJson<(IssueSummary & { pull_request?: unknown })[]>(
    `/repos/${owner}/${repo}/issues?${params.toString()}`,
  );
  // The /issues endpoint also returns pull requests - drop those.
  return all.filter((i) => !i.pull_request);
}

export async function setIssueState(
  number: number,
  state: "open" | "closed",
): Promise<void> {
  const { owner, repo } = env();
  await ghJson(`/repos/${owner}/${repo}/issues/${number}`, {
    method: "PATCH",
    body: JSON.stringify({ state }),
  });
}

// Add labels without disturbing the issue's existing labels.
export async function addIssueLabels(
  number: number,
  labels: string[],
): Promise<void> {
  const { owner, repo } = env();
  if (labels.length === 0) return;
  await ghJson(`/repos/${owner}/${repo}/issues/${number}/labels`, {
    method: "POST",
    body: JSON.stringify({ labels }),
  });
}

export async function removeIssueLabel(
  number: number,
  label: string,
): Promise<void> {
  const { owner, repo } = env();
  const res = await gh(
    `/repos/${owner}/${repo}/issues/${number}/labels/${encodeURIComponent(
      label,
    )}`,
    { method: "DELETE" },
  );
  // 404 = the label wasn't on the issue; that's fine.
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(
      `removeIssueLabel ${label} on #${number} failed: ${res.status} ${text}`,
    );
  }
}

export async function updateRef(
  branch: string,
  commitSha: string,
): Promise<void> {
  const { owner, repo } = env();
  const res = await gh(
    `/repos/${owner}/${repo}/git/refs/heads/${refPath(branch)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ sha: commitSha, force: false }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`updateRef ${branch} failed: ${res.status} ${text}`);
  }
}
