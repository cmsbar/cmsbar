// Remove the template/ + examples/ that prepack.mjs staged into the package, so
// the working tree is clean again after `npm pack` / `npm publish`. (They are
// also git-ignored as a backstop.)
import { rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const d of ["template", "examples"]) {
  rmSync(join(pkg, d), { recursive: true, force: true });
}
console.log("[cmsbar postpack] removed staged template/ + examples/");
