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
    if (typeof window !== "undefined") sessionStorage.removeItem(OFFLINE_KEY);
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
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
    if (res.status === 401) auth.clear();

    // A 404 on a route the client knows about means the deployed API predates
    // this build. Saying "Not Found" would send someone debugging the button
    // rather than redeploying the server.
    if (res.status === 404 && path.startsWith("/api/v1/auth/")) {
      throw new ApiError(
        "This feature is missing from the deployed API, which is running an " +
          "older build than this site. Redeploy the backend from the latest " +
          "commit and try again.",
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
  demo: () =>
    request<{ access_token: string; user: User }>("/api/v1/auth/demo", {
      method: "POST",
    }),

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

  /** Nudge a sleeping Space so it warms while the user picks a file. */
  wake: () =>
    request<{ woken: boolean }>("/api/v1/wake", { method: "POST" }).catch(
      () => ({ woken: false }),
    ),
};
