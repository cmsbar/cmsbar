import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  signSession,
  verifySession,
} from "@/lib/cmsbar/session";
import {
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
import { cmsConfig } from "@/cms.config";
import {
  isAllowedRepoPath,
  isAllowedFolder,
  describeAllowedFolders,
} from "@/lib/cmsbar/media";

const CONTENT_FILE = cmsConfig.contentFile;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB to accommodate short videos

function ghInfoForUrl(): { owner: string; repo: string } {
  return {
    owner: process.env.GITHUB_OWNER || "",
    repo: process.env.GITHUB_REPO || "",
  };
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

export async function POST(req: Request) {
  const jar = await cookies();
  const session = verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.draft) {
    return NextResponse.json(
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
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
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
    return NextResponse.json({ error: "Nothing to commit" }, { status: 400 });
  }

  for (const u of uploads) {
    if (!u.repoPath || !isAllowedRepoPath(u.repoPath)) {
      return NextResponse.json(
        {
          error: `Upload outside ${describeAllowedFolders()}: ${u.repoPath}`,
        },
        { status: 400 },
      );
    }
    if (!u.contentBase64 || typeof u.contentBase64 !== "string") {
      return NextResponse.json(
        { error: `Missing content for ${u.repoPath}` },
        { status: 400 },
      );
    }
    if (u.contentBase64.length > Math.ceil((MAX_UPLOAD_BYTES * 4) / 3)) {
      return NextResponse.json(
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
      return NextResponse.json(
        { error: `Invalid folder path: ${f}` },
        { status: 400 },
      );
    }
  }
  for (const d of deletes) {
    if (!isAllowedRepoPath(d)) {
      return NextResponse.json(
        { error: `Delete outside ${describeAllowedFolders()}: ${d}` },
        { status: 400 },
      );
    }
  }

  try {
    // Refuse to commit to a PR that's been marked approved/locked.
    if (draft.prNumber) {
      try {
        const pr = await getPullRequest(draft.prNumber);
        if (isApproved(pr.labels)) {
          return NextResponse.json(
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

    await ensureBranch(draft.branch);

    const branchSha = await getBranchSha(draft.branch);
    if (!branchSha) throw new Error("Editing branch vanished");
    const commit = await getCommit(branchSha);
    const baseTreeSha = commit.tree.sha;

    const changes: TreeChange[] = [];

    if (edits.length > 0) {
      const existing = await getFile(draft.branch, CONTENT_FILE);
      const json = existing
        ? JSON.parse(existing.content)
        : JSON.parse(JSON.stringify(getContent()));
      for (const e of edits) {
        if (typeof e.path !== "string") {
          throw new Error("Edit missing path");
        }
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

    for (const u of uploads) {
      const blobSha = await createBlob(u.contentBase64);
      changes.push({
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
        changes.push({
          path: `public/${clean}/.gitkeep`,
          mode: "100644",
          type: "blob",
          sha: gitkeepSha,
        });
      }
    }

    for (const d of deletes) {
      changes.push({ path: d, mode: "100644", type: "blob", sha: null });
    }

    if (changes.length === 0) {
      return NextResponse.json(
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
    const newTreeSha = await createTree({ baseTreeSha, changes });
    const newCommitSha = await createCommit({
      message,
      treeSha: newTreeSha,
      parentSha: branchSha,
    });
    await updateRef(draft.branch, newCommitSha);

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

    const res = NextResponse.json({
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
      res.cookies.set(SESSION_COOKIE, refreshed, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 12,
      });
    }
    return res;
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
