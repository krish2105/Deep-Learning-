/**
 * API client.
 *
 * Errors surface the server's own message where there is one. A clinical tool
 * that says "something went wrong" when the server said "this file is not a
 * readable image" has thrown away the only useful part of the response.
 */

import type {
  CalibrationState,
  ReadyState,
  Study,
  User,
  WorklistItem,
} from "./types";

const BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

const TOKEN_KEY = "sentinel_token";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const OFFLINE_KEY = "sentinel_offline_demo";

export const auth = {
  get: () =>
    typeof window === "undefined" ? null : localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(OFFLINE_KEY);
    }
  },
};

/**
 * Offline-demo flag, shared across routes.
 *
 * sessionStorage rather than localStorage: the fallback is a response to the
 * backend being unreachable *right now*, so it should not outlive the tab and
 * leave someone staring at fixtures after the API has recovered.
 */
export const offlineDemo = {
  get: () =>
    typeof window !== "undefined" && sessionStorage.getItem(OFFLINE_KEY) === "1",
  set: () => sessionStorage.setItem(OFFLINE_KEY, "1"),
  clear: () => {
    if (typeof window !== "undefined") sessionStorage.removeItem(OFFLINE_KEY);
  },
};

const DEMO_SESSION_KEY = "sentinel_demo_session";

/**
 * Whether the current session came from the demo button.
 *
 * Render's free tier has an ephemeral filesystem and no external database, so
 * every deploy and every 15-minute idle spin-down destroys all accounts. A
 * reviewer who steps away returns to a token whose user no longer exists and,
 * without this, a bare "Could not validate credentials" error. Knowing the
 * session was a demo lets us silently issue a fresh one instead.
 */
export const demoSession = {
  get: () =>
    typeof window !== "undefined" &&
    localStorage.getItem(DEMO_SESSION_KEY) === "1",
  set: () => localStorage.setItem(DEMO_SESSION_KEY, "1"),
  clear: () => {
    if (typeof window !== "undefined") localStorage.removeItem(DEMO_SESSION_KEY);
  },
};

async function request<T>(
  path: string,
  init: RequestInit = {},
  _retried = false,
): Promise<T> {
  const token = auth.get();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers });
  } catch {
    // A blocked CORS preflight and a dead server are indistinguishable from
    // here -- fetch rejects identically for both. Name both possibilities
    // rather than emitting a generic "network error" that sends someone
    // hunting in the wrong place.
    throw new ApiError(
      `Cannot reach the API at ${BASE}. Either it is asleep (free tier spins ` +
        `down after 15 minutes; the first request can take up to a minute), or ` +
        `it is not allowing requests from this origin. Check /api/v1/health.`,
      0,
    );
  }

  if (res.status === 204) return undefined as T;

  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    if (res.status === 401) {
      // The server's database is wiped on every deploy and idle spin-down, so
      // a valid token can outlive the user it refers to. If this session came
      // from the demo button, silently mint a new sandbox and retry once
      // rather than throwing the reviewer back to a credentials error they can
      // do nothing about. Guarded by `_retried` so a genuinely broken auth
      // path cannot loop.
      auth.clear();
      if (demoSession.get() && !_retried && path !== "/api/v1/auth/demo") {
        try {
          const fresh = await request<{ access_token: string }>(
            "/api/v1/auth/demo",
            { method: "POST" },
            true,
          );
          auth.set(fresh.access_token);
          return await request<T>(path, init, true);
        } catch {
          demoSession.clear();
        }
      }
    }

    // A 404 on a route this client was built against means the deployed API
    // predates the site, not that the resource is missing. Saying "Not Found"
    // sends someone debugging the button instead of redeploying the server.
    // Study lookups are excluded because there a 404 genuinely means the study
    // does not exist.
    const isStaleBackend =
      res.status === 404 &&
      (path.startsWith("/api/v1/auth/") ||
        path.startsWith("/api/v1/intelligence/"));

    if (isStaleBackend) {
      throw new ApiError(
        "The deployed backend is running an older build than this site, so " +
          "this feature does not exist there yet. Redeploy the API from the " +
          "latest commit.",
        404,
      );
    }

    const detail = payload?.detail;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: { msg?: string }) => d.msg).join("; ")
          : `Request failed (${res.status}).`;
    throw new ApiError(message, res.status);
  }

  return payload as T;
}

export const api = {
  register: (email: string, password: string, full_name = "") =>
    request<{ access_token: string; user: User }>("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, full_name }),
    }),

  login: (email: string, password: string) => {
    const form = new URLSearchParams({ username: email, password });
    return request<{ access_token: string; user: User }>("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
  },

  /** Issue a throwaway sandbox pre-loaded with demo studies. No signup. */
  demo: async () => {
    const res = await request<{ access_token: string; user: User }>(
      "/api/v1/auth/demo",
      { method: "POST" },
    );
    // Remember this was a demo, so an expired sandbox can be reissued silently.
    demoSession.set();
    return res;
  },

  me: () => request<User>("/api/v1/auth/me"),

  analyze: (file: File, patientRef = "", followUp = 0) => {
    const form = new FormData();
    form.append("file", file);
    form.append("patient_ref", patientRef);
    form.append("follow_up_index", String(followUp));
    return request<Study>("/api/v1/studies/analyze", {
      method: "POST",
      body: form,
    });
  },

  studies: () => request<Study[]>("/api/v1/studies"),
  study: (id: string) => request<Study>(`/api/v1/studies/${id}`),
  worklist: () => request<WorklistItem[]>("/api/v1/studies/worklist"),

  review: (id: string, note: string, agree: boolean) =>
    request<Study>(`/api/v1/studies/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ note, agree }),
    }),

  remove: (id: string) =>
    request<void>(`/api/v1/studies/${id}`, { method: "DELETE" }),

  ready: () => request<ReadyState>("/api/v1/ready"),
  calibration: () =>
    request<CalibrationState>("/api/v1/studies/system/calibration"),
  fairness: () => request<Record<string, unknown>>("/api/v1/fairness"),

  // ── intelligence ──────────────────────────────────────────────────
  /** Filter the worklist from a plain-English request. */
  nlQuery: (q: string) =>
    request<{
      query: string;
      interpretation: string;
      n_total: number;
      n_matched: number;
      study_ids: string[];
    }>(`/api/v1/intelligence/query?q=${encodeURIComponent(q)}`),

  similar: (studyId: string) =>
    request<{
      study_id: string;
      space: string;
      note: string;
      matches: {
        study_id: string;
        similarity: number;
        patient_ref: string;
        triage_priority: string;
        thumbnail: string;
        top_finding: string;
      }[];
    }>(`/api/v1/intelligence/similar/${studyId}`),

  timeline: (patientRef: string) =>
    request<{
      patient_ref: string;
      available: boolean;
      n_visits?: number;
      note?: string;
      trajectory?: {
        visit: number;
        study_id: string;
        triage: string;
        abstained: boolean;
        top_finding: string;
        top_probability: number;
      }[];
      net_change?: Record<string, number>;
      span_note?: string;
      narrative?: string;
      narrative_source?: string;
    }>(`/api/v1/intelligence/timeline/${encodeURIComponent(patientRef)}`),

  disagreement: (studyId: string) =>
    request<{
      study_id: string;
      available: boolean;
      n_conflicts: number;
      threshold: number;
      note: string;
      conflicts: {
        pathology: string;
        kind: string;
        gap: number;
        primary?: number;
        secondary?: number;
        range?: number;
        std?: number;
      }[];
    }>(`/api/v1/intelligence/disagreement/${studyId}`),

  /** Nudge a sleeping Space so it warms while the user picks a file. */
  wake: () =>
    request<{ woken: boolean }>("/api/v1/wake", { method: "POST" }).catch(
      () => ({ woken: false }),
    ),
};
