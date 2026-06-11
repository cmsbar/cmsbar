// Dotted-path access into the content object. Fully generic - the project
// owns its content shape; CMSBar only ever reads/writes through these.

// Object keys that must never be traversed or assigned via a dotted path -
// assigning through them would mutate Object.prototype (prototype pollution).
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function assertSafeParts(parts: string[], dotted: string): void {
  for (const p of parts) {
    if (FORBIDDEN_KEYS.has(p)) {
      throw new Error(`Illegal path segment "${p}" in "${dotted}"`);
    }
  }
}

export function resolvePath(c: unknown, dotted: string): unknown {
  const parts = dotted.split(".");
  for (const p of parts) {
    if (FORBIDDEN_KEYS.has(p)) return undefined;
  }
  let cur: unknown = c;
  for (const p of parts) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(p);
      if (Number.isNaN(idx)) return undefined;
      cur = cur[idx];
    } else if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

export function setPath(c: unknown, dotted: string, value: unknown): void {
  const parts = dotted.split(".");
  assertSafeParts(parts, dotted);
  let cur: unknown = c;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (Array.isArray(cur)) {
      cur = cur[Number(p)];
    } else if (cur && typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      throw new Error(
        `Cannot traverse path at "${parts.slice(0, i + 1).join(".")}"`,
      );
    }
  }
  const last = parts[parts.length - 1];
  if (Array.isArray(cur)) {
    cur[Number(last)] = value;
  } else if (cur && typeof cur === "object") {
    (cur as Record<string, unknown>)[last] = value;
  } else {
    throw new Error(`Cannot set value at "${dotted}"`);
  }
}
