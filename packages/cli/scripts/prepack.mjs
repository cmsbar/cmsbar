// Bundle the neutral core (template/) + the per-host starters (examples/) INTO
// the published `cmsbar` package, so `cmsbar new` / `cmsbar init` work when the
// CLI is installed from npm — not just when run inside this monorepo. (The
// 0.1.0 tarball shipped only bin/, so the published CLI couldn't scaffold.)
//
// This runs on `npm pack` / `npm publish` only (the `prepack` lifecycle hook),
// never on a consumer's `npm install`. postpack.mjs removes the staged copies
// afterward so the working tree stays clean.
//
// We copy exactly the git-tracked files of template/ + examples/ — so no
// node_modules, build output, .env secrets, or the git-ignored assembled cores
// come along — minus any nested `.gitignore` (npm's packlist would otherwise
// apply them and silently drop bundled files; the CLI rewrites .gitignore for
// scaffolded projects anyway).

import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, ".."); // packages/cli
const root = resolve(pkg, "..", ".."); // monorepo root

for (const d of ["template", "examples"]) {
  rmSync(join(pkg, d), { recursive: true, force: true });
}

const files = execSync("git ls-files template examples", {
  cwd: root,
  encoding: "utf8",
})
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((rel) => basename(rel) !== ".gitignore");

for (const rel of files) {
  const to = join(pkg, rel);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(join(root, rel), to);
}

console.log(
  `[cmsbar prepack] bundled ${files.length} files (template/ + examples/) into the package`,
);
