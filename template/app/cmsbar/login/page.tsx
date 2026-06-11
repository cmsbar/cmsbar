"use client";

import { useState } from "react";

export default function CmsLoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/cms/login", {
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
      // Full-page navigation so the server-rendered layout re-reads the new cookie.
      window.location.assign("/");
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"
      >
        <h1 className="text-2xl font-semibold text-slate-900">CMSBar login</h1>
        <p className="text-sm text-slate-500">
          Sign in to edit site content in place.
        </p>
        <div className="space-y-1">
          <label className="text-sm font-medium text-slate-700">Username</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            className="w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:ring-2 focus:ring-[var(--cmsbar-accent)]"
            required
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-slate-700">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:ring-2 focus:ring-[var(--cmsbar-accent)]"
            required
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-[var(--cmsbar-accent)] px-4 py-2 text-white font-medium hover:bg-[var(--cmsbar-accent-strong)] disabled:opacity-60"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
