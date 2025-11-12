const rawBase = import.meta.env.VITE_OPS_API_BASE ?? "";
const API_BASE = rawBase.endsWith("/") ? rawBase.slice(0, -1) : rawBase;
const ADMIN_KEY =
  import.meta.env.VITE_DASHBOARD_ADMIN_KEY ??
  import.meta.env.VITE_ADMIN_DASHBOARD_KEY ??
  "";

type ApiOptions = RequestInit & {
  skipAuth?: boolean;
};

function resolveUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  if (!API_BASE) {
    return path;
  }
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${normalizedPath}`;
}

export async function apiFetch(path: string, options: ApiOptions = {}): Promise<unknown> {
  const { skipAuth, ...rest } = options;
  const requestInit: RequestInit = {
    method: rest.method ?? "GET",
    ...rest,
    headers: undefined
  };
  const headers = new Headers(rest.headers ?? {});
  if (!skipAuth && ADMIN_KEY) {
    headers.set("X-Admin-Key", ADMIN_KEY);
  }
  if (options.body && typeof options.body === "object" && !(options.body instanceof FormData)) {
    headers.set("Content-Type", headers.get("Content-Type") ?? "application/json");
    requestInit.body = JSON.stringify(options.body);
  } else if (options.body) {
    requestInit.body = options.body;
  }
  requestInit.headers = headers;
  requestInit.credentials = "include";

  const response = await fetch(resolveUrl(path), requestInit);
  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(message || `Request failed (${response.status})`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  if (contentType.startsWith("text/")) {
    return response.text();
  }
  return response.arrayBuffer();
}

type ListParams = {
  status?: string;
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
};

export async function listSubmissions(params: ListParams = {}): Promise<any> {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.q) search.set("q", params.q);
  if (params.from) search.set("from", params.from);
  if (params.to) search.set("to", params.to);
  if (params.limit) search.set("limit", String(params.limit));
  const query = search.toString();
  return apiFetch(`/ops/submissions${query ? `?${query}` : ""}`);
}

export async function fetchSubmission(invoiceId: string): Promise<any> {
  return apiFetch(`/ops/submissions/${encodeURIComponent(invoiceId)}`);
}

export async function resendSubmission(invoiceId: string): Promise<any> {
  return apiFetch(`/ops/submissions/${encodeURIComponent(invoiceId)}/resend`, {
    method: "POST"
  });
}
