// Thin typed fetch wrapper. Token is read from localStorage on each call.
const TOKEN_KEY = "diq_token";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string | null) => t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}

interface ApiErrorBody { error?: string; details?: unknown; }

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }

  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  if (res.status === 204) return undefined as T;
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : await res.blob();
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth")) { setToken(null); location.href = "/login"; }
    const body = isJson ? (data as ApiErrorBody) : undefined;
    throw new ApiError(res.status, body?.error || res.statusText, body?.details);
  }
  return data as T;
}

export const api = {
  get: <T,>(path: string) => request<T>("GET", path),
  post: <T,>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T,>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T,>(path: string) => request<T>("DELETE", path),
  // returns a blob URL for downloads (PDF) — shares auth/401/error handling with request()
  blob: async (path: string) => URL.createObjectURL(await request<Blob>("GET", path)),
};
