import { describe, expect, it } from "vitest";
import { fetchFiveMRuntime } from "./fivem-runtime.js";

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

describe("fetchFiveMRuntime", () => {
  it("normalizes public FiveM runtime data without exposing player identifiers", async () => {
    const fetcher = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("players.json")) return response([{ id: 7, name: "Max", ping: 23, identifiers: ["license:secret"] }]);
      if (url.endsWith("info.json")) return response({ resources: ["chat", "mapmanager", "chat"], vars: { onesync: "on" }, version: "v1.0" });
      return response({ hostname: "RIFTGRID RP", clients: 1, sv_maxclients: 48, gametype: "Freeroam", mapname: "Los Santos" });
    };

    const snapshot = await fetchFiveMRuntime("localhost:30120", fetcher);

    expect(snapshot.connected).toBe(true);
    expect(snapshot.players).toEqual([{ id: "7", name: "Max", ping: 23 }]);
    expect(snapshot.resources).toEqual([{ name: "chat", state: "STARTED" }, { name: "mapmanager", state: "STARTED" }]);
    expect(snapshot.server).toMatchObject({ hostname: "RIFTGRID RP", clients: 1, maxClients: 48, onesync: "on" });
  });

  it("returns an unavailable snapshot when all public endpoints fail", async () => {
    const snapshot = await fetchFiveMRuntime("localhost:30120", async () => { throw new Error("offline"); });
    expect(snapshot.connected).toBe(false);
    expect(snapshot.players).toEqual([]);
    expect(snapshot.error).toBe("offline");
  });
});
