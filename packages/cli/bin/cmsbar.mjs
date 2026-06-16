#!/usr/bin/env node
// CMSBar CLI - two ways to adopt CMSBar, shadcn-style (you own the code; no
// runtime dependency on this CLI):
//
//   cmsbar new <dir> --framework <fw> [--namespace id]   scaffold a fresh site
//   cmsbar init [--framework <fw>] [--namespace id] [--dir .]   add to an existing project
//
// Frameworks: next | react-router | tanstack-start | vite | astro | sveltekit | nuxt
//
// `new` copies a per-framework starter (the host wiring + a demo page) and
// assembles the framework-neutral CMSBar core into it. `init` drops the core
// (and, for Next, the route handlers + login page) into a project you already
// have, then prints the wiring steps.
//
// React hosts assemble the React UI (`components/cmsbar`) + theme from the
// template. The non-React hosts (sveltekit, nuxt) ship their native UI as
// committed example glue (`*.svelte`/`*.vue` + the store + their own CSS), so for
// them (`neutralUi: true`) we copy the example's UI as-is and assemble ONLY the
// neutral TypeScript (`lib/cmsbar` + `lib/content.ts`) — never the React layer.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// `template/` and `examples/` are bundled INTO the package on publish (see
// scripts/prepack.mjs), so when installed from npm they sit at the package root
// (bin → cli). In the monorepo they live at the repo root (bin → cli → packages
// → root). Prefer the bundled copy; fall back to the monorepo layout for dev.
const PKG_ROOT = path.resolve(__dirname, ".."); // packages/cli (or installed pkg root)
const MONO_ROOT = path.resolve(__dirname, "../../../"); // monorepo root in dev
const ROOT = fs.existsSync(path.join(PKG_ROOT, "template")) ? PKG_ROOT : MONO_ROOT;
const TEMPLATE = path.join(ROOT, "template");
const EXAMPLES = path.join(ROOT, "examples");

// Per-framework manifest. `core` is where the neutral core is assembled
// (relative to the project root); `skipNext` drops the two Next-coupled core
// files; `nextExtras` also pulls the Next route handlers + login page +
// middleware; `example` is the starter skeleton dir; `config` is where
// cms.config.ts lives.
const FRAMEWORKS = {
  next: {
    example: "next",
    core: ".",
    skipNext: false,
    nextExtras: true,
    config: "cms.config.ts",
  },
  "react-router": {
    example: "react-router",
    core: "app",
    skipNext: true,
    nextExtras: false,
    config: "app/cms.config.ts",
  },
  "tanstack-start": {
    example: "tanstack-start",
    core: "src",
    skipNext: true,
    nextExtras: false,
    config: "src/cms.config.ts",
  },
  vite: {
    example: "vite-spa",
    core: "src",
    skipNext: true,
    nextExtras: false,
    config: "src/cms.config.ts",
  },
  astro: {
    example: "astro",
    core: "src",
    skipNext: true,
    nextExtras: false,
    config: "src/cms.config.ts",
  },
  // Non-React hosts: the editing UI is committed example glue (Svelte/Vue SFCs +
  // their own CSS), so neutralUi=true assembles ONLY the neutral lib core and the
  // example's UI is copied verbatim.
  sveltekit: {
    example: "sveltekit",
    core: "src",
    skipNext: true,
    nextExtras: false,
    neutralUi: true,
    config: "src/cms.config.ts",
  },
  nuxt: {
    example: "nuxt",
    core: ".",
    skipNext: true,
    nextExtras: false,
    neutralUi: true,
    config: "cms.config.ts",
  },
};

const SKIP_NEXT_FILES = new Set(["NextCmsHost.tsx", "page-meta-next.ts"]);
// utils.ts is the React-only cn() Tailwind class-merger (imported solely by the
// React components/cmsbar layer); non-React hosts never import it, so skipping it
// keeps clsx + tailwind-merge out of their dependency surface.
const SKIP_NEUTRAL_UI_FILES = new Set(["utils.ts"]);

const args = process.argv.slice(2);
const cmd = args[0];

function flag(name, fallback = undefined) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = args[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

function usage(code = 0) {
  console.log(`CMSBar - the Git-as-CMS bar you drop into your own codebase.

Usage:
  cmsbar new <dir> --framework <fw> [--namespace <id>]
      Scaffold a fresh CMSBar site. <fw>: ${Object.keys(FRAMEWORKS).join(" | ")}

  cmsbar init [--framework <fw>] [--namespace <id>] [--dir <project>] [--yes]
      Add CMSBar to an existing project (default framework: next).

Examples:
  npx cmsbar new my-site --framework react-router
  npx cmsbar init --namespace mysite           # Next.js project, in place
`);
  process.exit(code);
}

function normalizeNamespace(ns) {
  ns = String(ns || "mysite").toLowerCase();
  if (!/^[a-z][a-z0-9_-]*$/.test(ns)) {
    console.error(`✗ Invalid namespace "${ns}" (lowercase alphanumeric).`);
    process.exit(1);
  }
  return ns;
}

// Recursively copy a dir. `skipBasenames` drops entries by file name;
// `skipRel` drops entries by path relative to `from`; `skipExisting` never
// overwrites.
function copyDir(from, to, opts = {}) {
  const { skipBasenames, skipRel, skipExisting = false } = opts;
  const copied = [];
  const walk = (f, t, rel) => {
    if (!fs.existsSync(f)) return;
    fs.mkdirSync(t, { recursive: true });
    for (const entry of fs.readdirSync(f, { withFileTypes: true })) {
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (skipBasenames && skipBasenames.has(entry.name)) continue;
      if (skipRel && skipRel.some((s) => r === s || r.startsWith(s + "/")))
        continue;
      const sf = path.join(f, entry.name);
      const st = path.join(t, entry.name);
      if (entry.isDirectory()) walk(sf, st, r);
      else if (skipExisting && fs.existsSync(st)) continue;
      else {
        fs.copyFileSync(sf, st);
        copied.push(st);
      }
    }
  };
  walk(from, to, "");
  return copied;
}

// Assemble the framework-neutral core (+ Next extras) into <dest>/<core>.
function assembleCore(dest, fw, { skipExisting = false } = {}) {
  const m = FRAMEWORKS[fw];
  const base = m.core === "." ? dest : path.join(dest, m.core);
  const skip = m.skipNext ? SKIP_NEXT_FILES : undefined;
  const libSkip = m.neutralUi
    ? new Set([...(skip ?? []), ...SKIP_NEUTRAL_UI_FILES])
    : skip;
  let n = 0;
  // The React UI + theme are template-assembled for React hosts only; the
  // non-React hosts (neutralUi) ship their own SFC UI + CSS as committed glue.
  if (!m.neutralUi) {
    n += copyDir(
      path.join(TEMPLATE, "components", "cmsbar"),
      path.join(base, "components", "cmsbar"),
      { skipBasenames: skip, skipExisting },
    ).length;
  }
  n += copyDir(
    path.join(TEMPLATE, "lib", "cmsbar"),
    path.join(base, "lib", "cmsbar"),
    { skipBasenames: libSkip, skipExisting },
  ).length;
  const single = (rel, toRel) => {
    const to = path.join(base, toRel ?? rel);
    if (skipExisting && fs.existsSync(to)) return;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(TEMPLATE, rel), to);
    n++;
  };
  single("lib/content.ts");
  if (!m.neutralUi) single("styles/cmsbar.css");
  if (m.nextExtras) {
    n += copyDir(
      path.join(TEMPLATE, "app", "api", "cms"),
      path.join(base, "app", "api", "cms"),
      { skipExisting },
    ).length;
    n += copyDir(
      path.join(TEMPLATE, "app", "cmsbar"),
      path.join(base, "app", "cmsbar"),
      { skipExisting },
    ).length;
    const mw = path.join(base, "middleware.example.ts");
    if (!(skipExisting && fs.existsSync(mw))) {
      fs.copyFileSync(path.join(TEMPLATE, "middleware.example.ts"), mw);
      n++;
    }
  }
  return n;
}

function setNamespace(configPath, namespace) {
  try {
    const cfg = fs.readFileSync(configPath, "utf8");
    fs.writeFileSync(
      configPath,
      cfg.replace(/namespace:\s*"[^"]*"/, `namespace: "${namespace}"`),
    );
  } catch {
    /* no config to patch - leave it */
  }
}

const USER_GITIGNORE = `# dependencies / build
node_modules/
dist/
build/
.next/
.react-router/
.astro/
.svelte-kit/
.nuxt/
.output/
*.tsbuildinfo

# env - keep .env.example, ignore the rest
.env
.env.*
!.env.example
`;

// ── new ──────────────────────────────────────────────────────────────────────
function cmdNew() {
  const dir = args[1] && !args[1].startsWith("--") ? args[1] : null;
  const fw = String(flag("framework") || "");
  if (!dir) {
    console.error("✗ Missing <dir>. Usage: cmsbar new <dir> --framework <fw>");
    process.exit(1);
  }
  if (!FRAMEWORKS[fw]) {
    console.error(
      `✗ Unknown --framework "${fw}". Choose: ${Object.keys(FRAMEWORKS).join(" | ")}`,
    );
    process.exit(1);
  }
  const m = FRAMEWORKS[fw];
  const target = path.resolve(process.cwd(), dir);
  if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
    console.error(`✗ ${target} already exists and is not empty.`);
    process.exit(1);
  }
  const namespace = normalizeNamespace(
    flag("namespace") || path.basename(target),
  );
  const exampleDir = path.join(EXAMPLES, m.example);
  if (!fs.existsSync(exampleDir)) {
    console.error(`✗ Starter for "${fw}" not found at ${exampleDir}.`);
    process.exit(1);
  }

  console.log(`\nScaffolding a ${fw} CMSBar site in ${target}…\n`);

  // 1. Copy the starter skeleton (host wiring + demo). Drop dev-only files and
  //    the assembled-core paths (we copy the core fresh below).
  const coreRel = m.core === "." ? "" : m.core + "/";
  const skipRel = [
    "node_modules",
    "dist",
    "build",
    ".next",
    ".react-router",
    ".astro",
    ".svelte-kit",
    ".nuxt",
    ".output",
    ".env",
    ".env.local",
    ".gitignore",
    "scripts/setup.mjs",
    "package-lock.json",
    `${coreRel}lib/cmsbar`,
    `${coreRel}lib/content.ts`,
  ];
  // React hosts assemble the component layer + theme from the template, so drop
  // them from the example copy. neutralUi hosts COMMIT their SFC UI + CSS, so
  // those must be copied verbatim - don't skip them.
  if (!m.neutralUi) {
    skipRel.push(`${coreRel}components/cmsbar`, `${coreRel}styles/cmsbar.css`);
  }
  if (m.nextExtras) {
    skipRel.push(
      `${coreRel}app/api/cms`,
      `${coreRel}app/cmsbar`,
      `${coreRel}middleware.example.ts`,
    );
  }
  copyDir(exampleDir, target, { skipRel });

  // 2. Assemble the neutral core.
  const n = assembleCore(target, fw);

  // 3. Set the namespace + a user-project .gitignore.
  setNamespace(path.join(target, m.config), namespace);
  fs.writeFileSync(path.join(target, ".gitignore"), USER_GITIGNORE);

  // 4. Drop the monorepo-only "setup" script if the starter shipped one.
  try {
    const pkgPath = path.join(target, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    if (pkg.scripts?.setup) {
      delete pkg.scripts.setup;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    }
  } catch {
    /* no package.json to trim */
  }

  console.log(`✓ ${fw} starter ready (${n} core files assembled).

Next:
  cd ${dir}
  npm install
  npm run dev
  # then open the dev URL and visit /cmsbar/login (set the CMSBar env first)

Fill the CMSBar env (see .env.example) into .env.local to enable the editor.
Make text editable with <T path="…" /> and images with <EditableImage path="…" />.
`);
}

// ── init (add to an existing project) ────────────────────────────────────────
function cmdInit() {
  const fw = String(flag("framework") || "next");
  if (!FRAMEWORKS[fw]) {
    console.error(
      `✗ Unknown --framework "${fw}". Choose: ${Object.keys(FRAMEWORKS).join(" | ")}`,
    );
    process.exit(1);
  }
  const targetRoot = path.resolve(process.cwd(), String(flag("dir", ".")));
  const m = FRAMEWORKS[fw];

  // For Next, detect src/ vs root layout (the core lands beside app/).
  let coreBase = path.join(targetRoot, m.core === "." ? "" : m.core);
  if (fw === "next") {
    if (fs.existsSync(path.join(targetRoot, "src", "app")))
      coreBase = path.join(targetRoot, "src");
    else if (fs.existsSync(path.join(targetRoot, "app"))) coreBase = targetRoot;
    else {
      console.error(
        `✗ ${targetRoot} doesn't look like a Next App Router project (no app/ or src/app/).`,
      );
      process.exit(1);
    }
  }

  console.log(`\nAdding CMSBar (${fw}) to ${targetRoot}…\n`);
  // Assemble the core (+ Next extras), never overwriting the user's files.
  const fwForCore = fw;
  const n = assembleCoreInto(coreBase, fwForCore);

  // Pull the host adapter glue for non-Next frameworks from the matching
  // starter (the user still wires their root/layout - we print how).
  let glue = [];
  if (fw !== "next") {
    const ex = path.join(EXAMPLES, m.example);
    // The UI dir lives at app/cmsbar, src/cmsbar, or (Nuxt) cmsbar at the root.
    const hostDir =
      [
        path.join(ex, "app", "cmsbar"),
        path.join(ex, "src", "cmsbar"),
        path.join(ex, "cmsbar"),
      ].find((d) => fs.existsSync(d)) ?? null;
    if (hostDir) {
      glue = copyDir(hostDir, path.join(coreBase, "cmsbar"), {
        skipExisting: true,
      });
    }
  }

  // cms.config.ts + content/site-content.json land beside the core's lib/
  // (lib/content.ts imports ../content/site-content.json). Never overwrite.
  const cfgTo = path.join(coreBase, "cms.config.ts");
  if (!fs.existsSync(cfgTo))
    fs.copyFileSync(path.join(TEMPLATE, "cms.config.ts"), cfgTo);
  const contentTo = path.join(coreBase, "content", "site-content.json");
  if (!fs.existsSync(contentTo)) {
    fs.mkdirSync(path.dirname(contentTo), { recursive: true });
    fs.copyFileSync(
      path.join(TEMPLATE, "content", "site-content.json"),
      contentTo,
    );
  }
  const ns = flag("namespace");
  if (ns) setNamespace(cfgTo, normalizeNamespace(ns));

  // Env keys.
  appendEnv(targetRoot);

  console.log(`✓ ${n} core files assembled${glue.length ? ` + ${glue.length} host-adapter files` : ""}.

Next:`);
  if (fw === "next") {
    console.log(`  1. npm i bcryptjs clsx tailwind-merge lucide-react
  2. Wrap your root layout with <NextCmsHost><ContentProvider …>{children}<CmsBar/></ContentProvider></NextCmsHost>
     (see examples/next/app/layout.tsx)
  3. Import the theme once:  @import "../../styles/cmsbar.css";
  4. Fill the CMSBar env into .env.local
  5. Make something editable:  <T path="home.hero.headline" />`);
  } else {
    console.log(`  1. Install deps for ${fw} + bcryptjs clsx tailwind-merge lucide-react
  2. Mount the API: one catch-all route → handleCmsRequest (see examples/${m.example}/…/api…)
  3. Wrap your root with the ${fw} host + ContentProvider + CmsBar (see examples/${m.example})
  4. Import the theme + tailwind; fill the CMSBar env into .env.local`);
  }
  console.log("");
}

function assembleCoreInto(coreBase, fw) {
  // assembleCore expects a project root + the framework's core sub-path; here we
  // already resolved the absolute core base, so copy directly into it.
  const m = FRAMEWORKS[fw];
  const skip = m.skipNext ? SKIP_NEXT_FILES : undefined;
  const libSkip = m.neutralUi
    ? new Set([...(skip ?? []), ...SKIP_NEUTRAL_UI_FILES])
    : skip;
  let n = 0;
  if (!m.neutralUi) {
    n += copyDir(
      path.join(TEMPLATE, "components", "cmsbar"),
      path.join(coreBase, "components", "cmsbar"),
      { skipBasenames: skip, skipExisting: true },
    ).length;
  }
  n += copyDir(
    path.join(TEMPLATE, "lib", "cmsbar"),
    path.join(coreBase, "lib", "cmsbar"),
    { skipBasenames: libSkip, skipExisting: true },
  ).length;
  const coreSingles = m.neutralUi
    ? [["lib/content.ts"]]
    : [["lib/content.ts"], ["styles/cmsbar.css"]];
  for (const [rel] of coreSingles) {
    const to = path.join(coreBase, rel);
    if (!fs.existsSync(to)) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(TEMPLATE, rel), to);
      n++;
    }
  }
  if (m.nextExtras) {
    n += copyDir(
      path.join(TEMPLATE, "app", "api", "cms"),
      path.join(coreBase, "app", "api", "cms"),
      { skipExisting: true },
    ).length;
    n += copyDir(
      path.join(TEMPLATE, "app", "cmsbar"),
      path.join(coreBase, "app", "cmsbar"),
      { skipExisting: true },
    ).length;
    const mw = path.join(coreBase, "middleware.example.ts");
    if (!fs.existsSync(mw))
      fs.copyFileSync(path.join(TEMPLATE, "middleware.example.ts"), mw);
  }
  return n;
}

const ENV_BLOCK = `
# ── CMSBar ──────────────────────────────────────────────────────────────────
# bcrypt hash: node -e "console.log(require('bcryptjs').hashSync('PASSWORD', 10))"
CMS_USER=admin
CMS_PASSWORD_HASH=
# 32+ hex chars: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
CMS_SESSION_SECRET=
# Fine-grained PAT with Contents+PRs (and optionally Issues) read/write on this repo
GITHUB_TOKEN=
GITHUB_OWNER=
GITHUB_REPO=
GITHUB_BASE_BRANCH=main
`;

function appendEnv(targetRoot) {
  const envExample = path.join(targetRoot, ".env.example");
  const existing = fs.existsSync(envExample)
    ? fs.readFileSync(envExample, "utf8")
    : "";
  if (!existing.includes("CMSBar"))
    fs.writeFileSync(envExample, existing + ENV_BLOCK);
}

// ── dispatch ─────────────────────────────────────────────────────────────────
void (async () => {
  if (cmd === "new") return cmdNew();
  if (cmd === "init") {
    // Back-compat: prompt for namespace when interactive (Next path).
    if (!flag("namespace") && !args.includes("--yes")) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const ns = (
        await rl.question("Namespace for this site (short id, e.g. mysite): ")
      ).trim();
      rl.close();
      if (ns) args.push("--namespace", ns);
    }
    cmdInit();
    return;
  }
  usage(cmd ? 1 : 0);
})();
