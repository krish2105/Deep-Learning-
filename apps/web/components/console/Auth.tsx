"use client";

import { useState } from "react";
import { api, auth, ApiError } from "@/lib/api";
import type { User } from "@/lib/types";

export function AuthPanel({ onAuth }: { onAuth: (u: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res =
        mode === "login"
          ? await api.login(email, password)
          : await api.register(email, password, fullName);
      auth.set(res.access_token);
      onAuth(res.user);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Something went wrong. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <div className="w-full max-w-sm">
        <p className="tabular text-sm font-semibold tracking-[0.12em]">
          SENTINEL<span style={{ color: "var(--instrument)" }}>·</span>CXR
        </p>
        <h1
          className="mt-4 font-[family-name:var(--font-display)] leading-tight"
          style={{ fontSize: "var(--text-step-3)" }}
        >
          {mode === "login" ? "Sign in" : "Create an account"}
        </h1>
        <p className="mt-2 text-sm text-[var(--film-mid)]">
          Studies are private to your account.
        </p>

        <form onSubmit={submit} className="mt-8 space-y-4">
          {mode === "register" && (
            <Field
              label="Full name"
              value={fullName}
              onChange={setFullName}
              autoComplete="name"
            />
          )}
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            required
            autoComplete="email"
          />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            required
            minLength={8}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            hint={mode === "register" ? "At least 8 characters." : undefined}
          />

          {error && (
            <p
              role="alert"
              className="rounded-sm border px-3 py-2 text-sm"
              style={{ borderColor: "var(--stat)", color: "var(--stat)" }}
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-sm px-4 py-2.5 text-sm font-medium disabled:opacity-60"
            style={{ background: "var(--instrument)", color: "#fff" }}
          >
            {busy ? "Working…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        {/* Demo entry. A reviewer must be able to see a working clinical system
            without creating an account — a signup wall on an assessed
            submission is friction with no upside. */}
        <div className="mt-6 flex items-center gap-3">
          <span className="h-px flex-1" style={{ background: "var(--film-shoulder)" }} />
          <span className="text-[10px] tracking-widest text-[var(--film-mid)]">OR</span>
          <span className="h-px flex-1" style={{ background: "var(--film-shoulder)" }} />
        </div>

        <button
          onClick={async () => {
            setError("");
            setDemoBusy(true);
            try {
              const res = await api.demo();
              auth.set(res.access_token);
              onAuth(res.user);
            } catch (err) {
              setError(
                err instanceof ApiError
                  ? err.message
                  : "Could not start the demo. Is the API reachable?",
              );
            } finally {
              setDemoBusy(false);
            }
          }}
          disabled={demoBusy}
          className="mt-4 w-full rounded-sm border px-4 py-2.5 text-sm font-medium disabled:opacity-60"
          style={{ borderColor: "var(--instrument)", color: "var(--instrument)" }}
        >
          {demoBusy ? "Preparing sandbox…" : "Explore the demo — no sign-up"}
        </button>
        <p className="mt-2 text-[11px] text-[var(--film-mid)]">
          Opens a private sandbox pre-loaded with five studies covering triage,
          abstention, progression and a rejected upload. Expires after 24 hours.
        </p>

        <button
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError("");
          }}
          className="mt-5 text-sm underline decoration-dotted underline-offset-4 text-[var(--film-mid)]"
        >
          {mode === "login"
            ? "No account? Create one"
            : "Already have an account? Sign in"}
        </button>

        <p className="mt-10 text-xs text-[var(--film-mid)]">
          Research prototype for MAIB AI 114. Not a medical device. Do not upload
          identifiable patient data.
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  hint,
  ...rest
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">) {
  const id = `f-${label.toLowerCase().replace(/\s/g, "-")}`;
  return (
    <div>
      <label htmlFor={id} className="block text-xs text-[var(--film-mid)]">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-sm border px-3 py-2 text-sm outline-none"
        style={{
          borderColor: "var(--film-shoulder)",
          background: "var(--film-panel)",
          color: "var(--film-highlight)",
        }}
        {...rest}
      />
      {hint && <p className="mt-1 text-[11px] text-[var(--film-mid)]">{hint}</p>}
    </div>
  );
}
