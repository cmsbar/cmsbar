import {
  SESSION_COOKIE,
  signSession,
  verifySession,
} from "@/lib/cmsbar/session";
import {
  baseBranchName,
  ensureBranch,
  getBranchSha,
  getFile,
  getCommit,
  getPullRequest,
  createBlob,
  createTree,
  createCommit,
  updateRef,
  createPullRequest,
  findOpenPullRequest,
  type TreeChange,
} from "@/lib/cmsbar/backend/github";
import { getContent, setPath } from "@/lib/content";
import { approvedLabelName, isApproved } from "@/lib/cmsbar/approved";
import { buildCmsMetaMarker } from "@/lib/cmsbar/cmsMeta";
import { publishingMode } from "@/lib/cmsbar/config";
import { cmsConfig } from "@/cms.config";
import {
  isAllowedRepoPath,
  isAllowedFolder,
  describeAllowedFolders,
  MEDIA_ROOT,
} from "@/lib/cmsbar/media";
import {
  type CmsHandler,
  appendCookie,
  json,
  sessionCookie,
} from "@/lib/cmsbar/server/http";

const CONTENT_FILE = cmsConfig.contentFile;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB to accommodate short videos

function ghInfoForUrl(): { owner: string; repo: string } {
  return {
    owner: process.env.GITHUB_OWNER || "",
    repo: process.env.GITHUB_REPO || "",
  };
}

function isNonFastForward(err: unknown): boolean {
  // updateRef throws `updateRef <branch> failed: <status> <body>`; GitHub
  // returns 422 with "Update is not a fast forward" when the ref has moved.
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /updateRef\b[^]*\bfailed: 422\b/.test(msg) ||
    /not a fast.?forward/i.test(msg)
  );
}

function commitMessage(args: {
  title: string;
  edits: { path: string }[];
  uploads: { repoPath: string }[];
  folders: string[];
  deletes: string[];
}): string {
  const segments: string[] = [];
  if (args.edits.length > 0) {
    const sample = args.edits
      .slice(0, 3)
      .map((e) => e.path)
      .join(", ");
    const more =
      args.edits.length > 3 ? ` (+${args.edits.length - 3} more)` : "";
    segments.push(
      `${args.edits.length} field${
        args.edits.length > 1 ? "s" : ""
      }: ${sample}${more}`,
    );
  }
  if (args.uploads.length > 0) {
    segments.push(
      `${args.uploads.length} upload${args.uploads.length > 1 ? "s" : ""}`,
    );
  }
  if (args.folders.length > 0) {
    segments.push(
      `${args.folders.length} new folder${args.folders.length > 1 ? "s" : ""}`,
    );
  }
  if (args.deletes.length > 0) {
    segments.push(
      `${args.deletes.length} delete${args.deletes.length > 1 ? "s" : ""}`,
    );
  }
  return `cms(${args.title}): ${segments.join("; ")}`;
}

type Edit = { path: string; value: unknown };
type Upload = { repoPath: string; contentBase64: string };

export const commit: CmsHandler = async (req, ctx) => {
  const session = verifySession(ctx.cookies.get(SESSION_COOKIE));
  if (!session) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.draft) {
    return json(
      { error: "No active draft. Start one via /api/cms/session/start." },
      { status: 400 },
    );
  }
  const draft = session.draft;

  const body = (await req.json().catch(() => null)) as {
    edits?: Edit[];
    uploads?: Upload[];
    folders?: string[];
    deletes?: string[];
  } | null;
  if (!body) {
    return json({ error: "Invalid body" }, { status: 400 });
  }

  const edits = body.edits ?? [];
  const uploads = body.uploads ?? [];
  const folders = body.folders ?? [];
  const deletes = body.deletes ?? [];

  if (
    edits.length === 0 &&
    uploads.length === 0 &&
    folders.length === 0 &&
    deletes.length === 0
  ) {
    return json({ error: "Nothing to commit" }, { status: 400 });
  }

  for (const u of uploads) {
    if (!u.repoPath || !isAllowedRepoPath(u.repoPath)) {
      return json(
        {
          error: `Upload outside ${describeAllowedFolders()}: ${u.repoPath}`,
        },
        { status: 400 },
      );
    }
    if (!u.contentBase64 || typeof u.contentBase64 !== "string") {
      return json(
        { error: `Missing content for ${u.repoPath}` },
        { status: 400 },
      );
    }
    if (u.contentBase64.length > Math.ceil((MAX_UPLOAD_BYTES * 4) / 3)) {
      return json(
        {
          error: `${u.repoPath} exceeds ${
            MAX_UPLOAD_BYTES / (1024 * 1024)
          }MB limit`,
        },
        { status: 400 },
      );
    }
  }
  for (const f of folders) {
    if (!isAllowedFolder(f)) {
      return json(
        { error: `Invalid folder path: ${f}` },
        { status: 400 },
      );
    }
  }
  for (const d of deletes) {
    if (!isAllowedRepoPath(d)) {
      return json(
        { error: `Delete outside ${describeAllowedFolders()}: ${d}` },
        { status: 400 },
      );
    }
  }
  for (const e of edits) {
    if (typeof e.path !== "string") {
      return json(
        { error: "Edit missing path" },
        { status: 400 },
      );
    }
  }

  // Direct publishing: commit straight to the base branch - no draft branch,
  // no PR, no approval lock. The site redeploys from base.
  const direct = publishingMode(cmsConfig) === "direct";
  const targetBranch = direct ? baseBranchName() : draft.branch;

  try {
    if (!direct && draft.branch === baseBranchName()) {
      // A session minted under direct publishing points at the base branch.
      // After flipping back to review mode, committing there would silently
      // bypass the PR flow - make the editor restart cleanly instead.
      return json(
        {
          error:
            "This editing session predates the switch back to reviewed publishing. Exit the draft and start a new one.",
        },
        { status: 409 },
      );
    }

    if (direct && draft.branch !== baseBranchName()) {
      // The mirror case: a session minted under reviewed publishing carries a
      // cms/* draft branch. After flipping to direct mode we'd commit only the
      // current edits to the base branch, stranding everything already saved on
      // that draft branch - earlier content rounds, and uploaded media which
      // live only there. Make the editor restart cleanly instead.
      return json(
        {
          error:
            "This editing session predates the switch to direct publishing. Exit the draft and start a new one.",
        },
        { status: 409 },
      );
    }

    // Refuse to commit to a PR that's been marked approved/locked. (Direct
    // mode has no PRs, so there is nothing to check.)
    if (!direct && draft.prNumber) {
      try {
        const pr = await getPullRequest(draft.prNumber);
        if (isApproved(pr.labels)) {
          return json(
            {
              error: `This draft has been approved (label: "${approvedLabelName()}") and is locked. Use Fork from the Versions list to branch off.`,
              approved: true,
            },
            { status: 409 },
          );
        }
      } catch (err) {
        // If the PR lookup fails, fall through - better to commit than lose work.
        console.warn("CMS: commit approval check failed (continuing):", err);
      }
    }

    if (!direct) await ensureBranch(draft.branch);

    // Content-independent tree entries (media uploads, new folders, deletes)
    // are built once - they don't depend on the branch head. The content.json
    // edit is merged against the head INSIDE commitTo instead, so a retry after
    // a concurrent push re-reads the latest content and overlays this draft's
    // edits per-path, rather than clobbering it with a stale full-file snapshot.
    const staticChanges: TreeChange[] = [];

    for (const u of uploads) {
      const blobSha = await createBlob(u.contentBase64);
      staticChanges.push({
        path: u.repoPath,
        mode: "100644",
        type: "blob",
        sha: blobSha,
      });
    }

    if (folders.length > 0) {
      const gitkeepSha = await createBlob(
        Buffer.from(
          "# placeholder so the folder exists in git\n",
          "utf8",
        ).toString("base64"),
      );
      for (const f of folders) {
        const clean = f.replace(/^\/+|\/+$/g, "");
        staticChanges.push({
          path: `${MEDIA_ROOT}/${clean}/.gitkeep`,
          mode: "100644",
          type: "blob",
          sha: gitkeepSha,
        });
      }
    }

    for (const d of deletes) {
      staticChanges.push({ path: d, mode: "100644", type: "blob", sha: null });
    }

    if (edits.length === 0 && staticChanges.length === 0) {
      return json(
        { error: "Nothing to commit after validation" },
        { status: 400 },
      );
    }

    const message = commitMessage({
      title: draft.title,
      edits,
      uploads,
      folders,
      deletes,
    });

    // One head-read → (merge content) → tree → commit → ref-update round
    // against `branch`. The content.json read/merge lives here so each attempt
    // - including the retry below - merges against the head it commits onto.
    const commitTo = async (branch: string): Promise<string> => {
      const headSha = await getBranchSha(branch);
      if (!headSha)
        throw new Error(
          direct
            ? `Base branch ${branch} not found`
            : "Editing branch vanished",
        );
      const baseTreeSha = (await getCommit(headSha)).tree.sha;

      const changes: TreeChange[] = [...staticChanges];
      if (edits.length > 0) {
        const existing = await getFile(branch, CONTENT_FILE);
        const json = existing
          ? JSON.parse(existing.content)
          : JSON.parse(JSON.stringify(getContent()));
        for (const e of edits) {
          setPath(json, e.path, e.value);
        }
        const blobSha = await createBlob(
          Buffer.from(JSON.stringify(json, null, 2) + "\n", "utf8").toString(
            "base64",
          ),
        );
        changes.push({
          path: CONTENT_FILE,
          mode: "100644",
          type: "blob",
          sha: blobSha,
        });
      }

      const treeSha = await createTree({ baseTreeSha, changes });
      const sha = await createCommit({
        message,
        treeSha,
        parentSha: headSha,
      });
      await updateRef(branch, sha);
      return sha;
    };

    let newCommitSha: string;
    if (direct) {
      try {
        newCommitSha = await commitTo(targetBranch);
      } catch (err) {
        // Only a non-fast-forward ref update is safe to retry: the base moved
        // between our head read and updateRef (a deploy or another editor), and
        // commitTo re-reads + re-merges against the new head. Any other failure
        // (auth, rate limit, validation, deleting a missing path) would just
        // repeat - and blindly retrying risks a duplicate commit/deploy - so
        // surface it instead.
        if (!isNonFastForward(err)) throw err;
        console.warn(
          "CMS: direct publish hit a non-fast-forward; retrying once.",
          err,
        );
        newCommitSha = await commitTo(targetBranch);
      }
      const { owner: ghOwner, repo: ghRepo } = ghInfoForUrl();
      return json({
        ok: true,
        direct: true,
        branch: targetBranch,
        commitSha: newCommitSha,
        branchUrl: `https://github.com/${ghOwner}/${ghRepo}/commit/${newCommitSha}`,
      });
    }
    newCommitSha = await commitTo(targetBranch);

    let pr: { number?: number; url?: string } = {
      number: draft.prNumber,
      url: draft.prUrl,
    };
    let prError: string | undefined;
    if (!pr.number) {
      const existing = await findOpenPullRequest(draft.branch);
      if (existing) {
        pr = { number: existing.number, url: existing.html_url };
      } else {
        try {
          const opened = await createPullRequest({
            head: draft.branch,
            title: `[CMS draft] ${draft.title}`,
            body: `Auto-opened by the in-page editor.\n\n_Editor:_ ${
              session.user
            }\n_Draft title:_ ${draft.title}\n\n${buildCmsMetaMarker({
              pagePath: draft.pagePath,
            })}`,
            draft: false,
          });
          pr = { number: opened.number, url: opened.html_url };
        } catch (prErr) {
          prError = prErr instanceof Error ? prErr.message : String(prErr);
          console.error("CMS: createPullRequest failed", prErr);
        }
      }
    }

    const { owner: ghOwner, repo: ghRepo } = ghInfoForUrl();
    const branchUrl = `https://github.com/${ghOwner}/${ghRepo}/tree/${draft.branch}`;

    const res = json({
      ok: true,
      branch: draft.branch,
      branchUrl,
      commit: newCommitSha,
      prUrl: pr.url,
      prError,
    });
    if (pr.number && (!draft.prNumber || !draft.prUrl)) {
      const refreshed = signSession({
        ...session,
        draft: { ...draft, prNumber: pr.number, prUrl: pr.url },
      });
      appendCookie(res, sessionCookie(refreshed));
    }
    return res;
  } catch (err) {
    return json({ error: String(err) }, { status: 500 });
  }
};
