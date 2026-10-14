import type {
  ApiError,
  ClientProblemState,
  RunResponseBody,
  SubmitResponseBody,
} from "./api-types";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.error);
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError(0, { error: "Network error. Check your connection.", code: "server_error" });
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // fall through
  }
  if (!res.ok) {
    const err = (json as ApiError | null) ?? { error: `Request failed (${res.status})`, code: "server_error" };
    throw new ApiRequestError(res.status, err);
  }
  return json as T;
}

const problemUrl = (id: string, action: string) => `/api/problems/${encodeURIComponent(id)}/${action}`;

export const api = {
  createSession: () => post<{ sessionId: string }>("/api/session", {}),
  start: (problemId: string, sessionId: string) =>
    post<{ state: ClientProblemState }>(problemUrl(problemId, "start"), { sessionId }),
  run: (problemId: string, sessionId: string, code: string) =>
    post<RunResponseBody>(problemUrl(problemId, "run"), { sessionId, code }),
  submit: (problemId: string, sessionId: string, code: string) =>
    post<SubmitResponseBody>(problemUrl(problemId, "submit"), { sessionId, code }),
  feedback: (problemId: string, sessionId: string, feedback: string, email: string) =>
    post<{ ok: true }>(problemUrl(problemId, "feedback"), { sessionId, feedback, email }),
};
