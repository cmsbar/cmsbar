// Demo page. Renders editable content through the framework-neutral CMS
// primitives (<T> for text, <EditableImage> for the hero) - the exact same
// components the Next / React Router / TanStack examples use, driven here by the
// neutral DOM host seam (no framework adapter).
//
// There is no server-rendered /cmsbar/login route in a client-only SPA, so we
// provide a small inline login form: it POSTs to /api/cms/login (via cmsFetch,
// same-origin so the Set-Cookie sticks) and then reloads so main.tsx re-fetches
// the session and ContentProvider hydrates authenticated.

import { useState } from "react";
import { T } from "@/components/cmsbar/T";
import { EditableImage } from "@/components/cmsbar/EditableImage";
import { useCms } from "@/components/cmsbar/ContentProvider";
import { cmsFetch } from "@/lib/cmsbar/cmsFetch";

export function App() {
  return (
    <main
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "48px 24px",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <T as="h1" path="demo.title" />
      <T as="p" path="demo.intro" />
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "1200 / 630",
          marginTop: 24,
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <EditableImage
          path="demo.image"
          alt="CMSBar demo"
          fill
          sizes="(max-width: 760px) 100vw, 760px"
        />
      </div>

      <LoginPanel />
    </main>
  );
}

// Shown only when not authenticated. Once logged in, the floating CmsBar takes
// over (enter edit mode, click text/images, save as a PR).
function LoginPanel() {
  const { cms } = useCms();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (cms.authenticated) {
    return (
      <p style={{ marginTop: 32, color: "#16a34a", fontSize: 14 }}>
        Signed in as <strong>{cms.user}</strong>. Use the CMSBar at the bottom to
        enter edit mode and click the heading, paragraph, or image.
      </p>
    );
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await cmsFetch("/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error || "Login failed");
        setBusy(false);
        return;
      }
      // Reload so main.tsx re-fetches /api/cms/session and the providers
      // hydrate authenticated (the cookie is now set, same-origin).
      window.location.reload();
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      style={{
        marginTop: 40,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        maxWidth: 320,
        padding: 24,
        border: "1px solid #e2e8f0",
        borderRadius: 16,
        background: "#fff",
      }}
    >
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "#0f172a" }}>
        CMSBar login
      </h2>
      <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
        Sign in to edit this page in place.
      </p>
      <input
        type="text"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Username"
        autoComplete="username"
        required
        style={inputStyle}
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        autoComplete="current-password"
        required
        style={inputStyle}
      />
      {error && (
        <p style={{ margin: 0, fontSize: 13, color: "#dc2626" }}>{error}</p>
      )}
      <button
        type="submit"
        disabled={busy}
        style={{
          padding: "8px 16px",
          borderRadius: 8,
          border: "none",
          background: "var(--cmsbar-accent, #db2777)",
          color: "#fff",
          fontWeight: 500,
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #cbd5e1",
  outline: "none",
  fontSize: 14,
};
