// ── The storage seam ─────────────────────────────────────────────────────────
// CMSBar's draft model is backend-agnostic: a draft is a named branch of the
// content, a "version" is an open change request, approval is a label. The
// GitHub adapter (github.ts) is the reference implementation; this interface
// documents the seam a future adapter (GitLab, local file, database) has to
// fill so the route handlers can swap it in.
//
// Status: the route handlers still import the GitHub module directly. The
// next refactor step (productization plan, phase "Storage adapter") makes
// them consume this interface instead. Keep new backend-touching code
// expressible in these terms.

export type DraftChange =
  /** Add or replace a file with base64 content. */
  | { path: string; contentBase64: string }
  /** Delete a file. */
  | { path: string; delete: true };

export type VersionSummary = {
  /** Backend-native id of the change request (PR number, MR iid…). */
  number: number;
  title: string;
  branch: string;
  headSha: string;
  author: string | null;
  updatedAt: string;
  url: string;
  approved: boolean;
  labels: string[];
};

export interface CmsBackend {
  /** Create the draft branch (idempotent) and open its change request. */
  startDraft(args: {
    branch: string;
    title: string;
    body: string;
  }): Promise<{ number?: number; url?: string }>;

  /** Branch a new draft off an existing one. */
  fork(args: {
    fromBranch: string;
    newBranch: string;
    title: string;
    body: string;
  }): Promise<{ number?: number; url?: string }>;

  /** Apply a set of file changes as one commit on the draft branch. */
  commit(args: {
    branch: string;
    message: string;
    changes: DraftChange[];
  }): Promise<{ commitSha: string }>;

  /** Raw file content at a branch (None when absent). */
  getFile(branch: string, path: string): Promise<string | null>;

  /** Binary-safe file read (media proxy). */
  getFileBinary(
    branch: string,
    path: string,
  ): Promise<{ bytes: Uint8Array } | null>;

  /** All open drafts (change requests on branches with the draft prefix). */
  listDrafts(branchPrefix: string): Promise<VersionSummary[]>;

  /** Is the draft locked by the approval label? */
  checkApproval(
    branch: string,
  ): Promise<{ approved: boolean; labels: string[] }>;

  /** Remove an (empty) draft branch; closes its change request. */
  deleteBranch(branch: string): Promise<void>;
}
