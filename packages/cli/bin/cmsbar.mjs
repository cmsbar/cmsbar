#!/usr/bin/env node
// CMSBar installer - shadcn-style: copies the CMSBar source into YOUR repo.
// You own the code afterwards; there is no runtime dependency on this CLI.
//
//   npx cmsbar init [--namespace mysite] [--dir .] [--yes]
//
// What it does:
//   1. Detects src/ vs root-level app/ layout.
//   2. Copies components/cmsbar, lib/cmsbar, lib/content.ts, app/api/cms,
//      app/cmsbar/login, styles/cmsbar.css, content/site-content.json,
//      cms.config.ts and middleware.example.ts into the target project.
//   3. Sets your namespace in cms.config.ts.
//   4. Appends the required env keys to .env.example.
//   5. Prints the manual wiring steps (provider in layout, CSS import, env).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.resolve(__dirname, "../../../template");

const args = process.argv.slice(2);
const cmd = args[0];

function flag(name, fallback = undefined) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = args[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

if (cmd !== "init") {
  console.log(`CMSBar - Git-as-CMS you drop into your own codebase.

Usage:
  cmsbar init [--namespace <id>] [--dir <project>] [--yes]
`);
  process.exit(cmd ? 1 : 0);
}

const targetRoot = path.resolve(process.cwd(), String(flag("dir", ".")));
const assumeYes = args.includes("--yes");

function detectLayout(root) {
  if (fs.existsSync(path.join(root, "src", "app"))) return "src";
  if (fs.existsSync(path.join(root, "app"))) return "root";
  return null;
}

function copyDir(from, to, { skipExisting = true } = {}) {
  const copied = [];
  const skipped = [];
  const walk = (f, t) => {
    fs.mkdirSync(t, { recursive: true });
    for (const entry of fs.readdirSync(f, { withFileTypes: true })) {
      const sf = path.join(f, entry.name);
      const st = path.join(t, entry.name);
      if (entry.isDirectory()) walk(sf, st);
      else if (skipExisting && fs.existsSync(st)) skipped.push(st);
      else {
        fs.copyFileSync(sf, st);
        copied.push(st);
      }
    }
  };
  walk(from, to);
  return { copied, skipped };
}

const layout = detectLayout(targetRoot);
if (!layout) {
  console.error(
    `✗ ${targetRoot} doesn't look like a Next.js App Router project (no app/ or src/app/).`,
  );
  process.exit(1);
}
const srcBase = layout === "src" ? path.join(targetRoot, "src") : targetRoot;

let namespace = flag("namespace");
if (!namespace && !assumeYes) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  namespace = (
    await rl.question("Namespace for this site (short id, e.g. mysite): ")
  ).trim();
  rl.close();
}
namespace = String(namespace || "mysite").toLowerCase();
if (!/^[a-z][a-z0-9_-]*$/.test(namespace)) {
  console.error(`✗ Invalid namespace "${namespace}" (lowercase alphanumeric).`);
  process.exit(1);
}

console.log(`\nInstalling CMSBar into ${targetRoot} (${layout} layout)…\n`);

const results = [];
results.push(
  copyDir(
    path.join(TEMPLATE, "components", "cmsbar"),
    path.join(srcBase, "components", "cmsbar"),
  ),
);
results.push(
  copyDir(
    path.join(TEMPLATE, "lib", "cmsbar"),
    path.join(srcBase, "lib", "cmsbar"),
  ),
);
results.push(
  copyDir(
    path.join(TEMPLATE, "app", "api", "cms"),
    path.join(srcBase, "app", "api", "cms"),
  ),
);
results.push(
  copyDir(
    path.join(TEMPLATE, "app", "cmsbar"),
    path.join(srcBase, "app", "cmsbar"),
  ),
);
results.push(
  copyDir(path.join(TEMPLATE, "styles"), path.join(targetRoot, "styles")),
);
results.push(
  copyDir(path.join(TEMPLATE, "content"), path.join(targetRoot, "content")),
);

// Single files (never overwrite).
const singles = [
  [
    path.join(TEMPLATE, "lib", "content.ts"),
    path.join(srcBase, "lib", "content.ts"),
  ],
  [
    path.join(TEMPLATE, "cms.config.ts"),
    path.join(
      srcBase === targetRoot ? targetRoot : path.join(targetRoot, "src"),
      "cms.config.ts",
    ),
  ],
  [
    path.join(TEMPLATE, "middleware.example.ts"),
    path.join(targetRoot, "middleware.example.ts"),
  ],
];
for (const [from, to] of singles) {
  if (fs.existsSync(to)) {
    results.push({ copied: [], skipped: [to] });
  } else {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    results.push({ copied: [to], skipped: [] });
  }
}

// Set the namespace in the freshly copied config.
const cfgPath = singles[1][1];
try {
  const cfg = fs.readFileSync(cfgPath, "utf8");
  fs.writeFileSync(
    cfgPath,
    cfg.replace('namespace: "mysite"', `namespace: "${namespace}"`),
  );
} catch {
  /* user already had a config - leave it alone */
}

// Append env keys to .env.example.
const ENV_BLOCK = `
# ── CMSBar ──────────────────────────────────────────────────────────────────
# bcrypt hash: node -e "console.log(require('bcryptjs').hashSync('PASSWORD', 10))"
# NOTE: escape every '$' in the hash as '\\$' (dotenv-expand mangles it otherwise)
CMS_USER=admin
CMS_PASSWORD_HASH=
# 32+ hex chars: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
CMS_SESSION_SECRET=
# Fine-grained PAT with Contents+PRs (and optionally Issues) read/write on this repo
GITHUB_TOKEN=
GITHUB_OWNER=
GITHUB_REPO=
GITHUB_BASE_BRANCH=main
# Optional: label that locks an approved draft (default "cmsbar approved")
# CMS_APPROVED_LABEL=
`;
const envExample = path.join(targetRoot, ".env.example");
const existingEnv = fs.existsSync(envExample)
  ? fs.readFileSync(envExample, "utf8")
  : "";
if (!existingEnv.includes("CMSBar")) {
  fs.writeFileSync(envExample, existingEnv + ENV_BLOCK);
}

const copied = results.flatMap((r) => r.copied).length;
const skipped = results.flatMap((r) => r.skipped);
console.log(
  `✓ ${copied} files copied${skipped.length ? `, ${skipped.length} existing files left untouched` : ""}.`,
);

console.log(`
Next steps:
  1. npm i bcryptjs clsx tailwind-merge lucide-react
  2. Wrap your root layout:
       import { getContent } from "@/lib/content";
       import { ContentProvider } from "@/components/cmsbar/ContentProvider";
       import { CmsBar } from "@/components/cmsbar/CmsBar";
       …
       <ContentProvider content={getContent()} initialCms={…}>
         {children}
         <CmsBar />
       </ContentProvider>
     (see the CMSBar README "Wiring the layout" for the full snippet)
  3. Import the theme once in app/globals.css:
       @import "../../styles/cmsbar.css";
  4. Fill the CMSBar block in .env.example into your .env.local.
  5. Make something editable:  <T path="home.hero.headline" />
  6. Visit /cmsbar/login.

Docs: https://github.com/your-org/cmsbar (docs/SETUP.md)
`);
