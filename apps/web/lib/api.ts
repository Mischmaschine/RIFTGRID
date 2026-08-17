export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...init, credentials: "include", headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers } });
  if (response.status === 204) return undefined as T;
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "RIFTGRID request failed");
  return body as T;
}
export function websocketUrl(path: string) { return `${API_URL.replace(/^http/, "ws")}${path}`; }
