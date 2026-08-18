export interface FiveMRuntimePlayer {
  id: string;
  name: string;
  ping: number | null;
}

export interface FiveMRuntimeResource {
  name: string;
  state: "STARTED";
}

export interface FiveMRuntimeSnapshot {
  connected: boolean;
  sampledAt: string;
  error: string | null;
  players: FiveMRuntimePlayer[];
  resources: FiveMRuntimeResource[];
  server: {
    hostname: string | null;
    clients: number;
    maxClients: number | null;
    gameType: string | null;
    mapName: string | null;
    onesync: string | null;
    version: string | null;
  };
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

async function fetchJson(fetcher: FetchLike, url: string): Promise<unknown> {
  const response = await fetcher(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(2500) });
  if (!response.ok) throw new Error(`FiveM endpoint returned HTTP ${response.status}`);
  const body = await response.text();
  if (body.length > 2_000_000) throw new Error("FiveM endpoint response was unexpectedly large");
  return JSON.parse(body);
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function number(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function fetchFiveMRuntime(address: string, fetcher: FetchLike = fetch): Promise<FiveMRuntimeSnapshot> {
  const baseUrl = `http://${address}`;
  const [playersResult, infoResult, dynamicResult] = await Promise.allSettled([
    fetchJson(fetcher, `${baseUrl}/players.json`),
    fetchJson(fetcher, `${baseUrl}/info.json`),
    fetchJson(fetcher, `${baseUrl}/dynamic.json`),
  ]);

  const playersBody = playersResult.status === "fulfilled" && Array.isArray(playersResult.value) ? playersResult.value : [];
  const info = infoResult.status === "fulfilled" ? object(infoResult.value) : {};
  const dynamic = dynamicResult.status === "fulfilled" ? object(dynamicResult.value) : {};
  const variables = object(info.vars);
  const resourceNames = Array.isArray(info.resources) ? info.resources.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
  const players = playersBody.map((entry, index) => {
    const player = object(entry);
    return {
      id: String(player.id ?? index),
      name: string(player.name) ?? `Player ${index + 1}`,
      ping: number(player.ping),
    };
  });
  const failures = [playersResult, infoResult, dynamicResult].filter((result) => result.status === "rejected") as PromiseRejectedResult[];
  const connected = failures.length < 3;

  return {
    connected,
    sampledAt: new Date().toISOString(),
    error: connected ? null : (failures[0]?.reason instanceof Error ? failures[0].reason.message : "FiveM runtime endpoints are unavailable"),
    players,
    resources: [...new Set(resourceNames)].sort().map((name) => ({ name, state: "STARTED" as const })),
    server: {
      hostname: string(dynamic.hostname) ?? string(variables.sv_projectName),
      clients: number(dynamic.clients) ?? players.length,
      maxClients: number(dynamic.sv_maxclients) ?? number(variables.sv_maxClients),
      gameType: string(dynamic.gametype),
      mapName: string(dynamic.mapname),
      onesync: string(variables.onesync),
      version: string(info.version) ?? string(variables.sv_enforceGameBuild),
    },
  };
}
