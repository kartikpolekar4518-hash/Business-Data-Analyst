// Thin typed fetch wrapper. Token is read from localStorage on each call.
const TOKEN_KEY = "diq_token";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string | null) => t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let payload: BodyInit | undefined = body instanceof FormData ? body : undefined;
  if (body && !(body instanceof FormData)) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }

  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  if (res.status === 204) return undefined as T;
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : await res.blob();
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth") && !path.startsWith("/share")) { setToken(null); location.href = "/login"; }
    throw new ApiError(res.status, (data as any)?.error || res.statusText, (data as any)?.details);
  }
  return data as T;
}

// Multipart upload with deterministic transfer progress. fetch() can't report
// upload progress, so this path uses XMLHttpRequest while mirroring request()'s
// auth and error handling. onProgress reports 0–100 for the byte transfer.
function upload<T>(path: string, form: FormData, onProgress?: (pct: number) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api${path}`);
    const token = getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    // Don't set Content-Type — the browser adds the multipart boundary itself.
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => {
      const isJson = xhr.getResponseHeader("content-type")?.includes("application/json");
      let data: unknown = xhr.responseText;
      if (isJson) { try { data = JSON.parse(xhr.responseText); } catch { data = undefined; } }
      if (xhr.status >= 200 && xhr.status < 300) { resolve(data as T); return; }
      if (xhr.status === 401 && !path.startsWith("/auth")) { setToken(null); location.href = "/login"; }
      reject(new ApiError(xhr.status, (data as any)?.error || xhr.statusText, (data as any)?.details));
    };
    xhr.onerror = () => reject(new ApiError(0, "Network error"));
    xhr.send(form);
  });
}

export const api = {
  get: <T,>(path: string) => request<T>("GET", path),
  post: <T,>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T,>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T,>(path: string) => request<T>("DELETE", path),
  upload,
  // returns a blob URL for downloads (PDF) — shares auth/401/error handling with request()
  blob: async (path: string) => URL.createObjectURL(await request<Blob>("GET", path)),
};
