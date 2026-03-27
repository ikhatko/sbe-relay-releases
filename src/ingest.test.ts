import { AddressInfo } from "node:net";

import type { RelayGsiPayload } from "@sbe/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createIngestServer } from "./ingest";

describe("createIngestServer", () => {
  const servers: Array<ReturnType<typeof createIngestServer>> = [];

  async function startServer(forward: (payload: RelayGsiPayload) => Promise<void>) {
    const server = createIngestServer({
      roomId: "room-test",
      playerId: "player-test",
      logRawGsi: false,
      roundLiveDurationSec: 115,
      bombTimerSec: 40,
      forward
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  afterEach(async () => {
    while (servers.length > 0) {
      const server = servers.pop();
      if (server) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    }
  });

  it("accepts gsi object and forwards normalized payload", async () => {
    const forward = vi.fn<(payload: RelayGsiPayload) => Promise<void>>(async () => {});
    const baseUrl = await startServer(forward);

    const response = await fetch(`${baseUrl}/gsi`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        map: { name: "de_mirage", phase: "live", round: 2, team_ct: { score: 1 }, team_t: { score: 1 } },
        round: { phase: "live" },
        player: {
          steamid: "7656119",
          name: "reality",
          team: "T",
          state: {
            health: 100,
            armor: 100,
            helmet: true,
            money: 5000,
            equip_value: 3700,
            round_kills: 3,
            round_killhs: 1
          },
          weapons: {
            weapon_0: { name: "weapon_ak47" }
          }
        },
        previously: {
          player: {
            state: {
              round_kills: 2
            }
          }
        }
      })
    });

    expect(response.status).toBe(202);
    expect(forward).toHaveBeenCalledTimes(1);
    const firstCall = forward.mock.calls[0];
    expect(firstCall).toBeDefined();
    const forwarded = firstCall?.[0] as {
      roomId: string;
      playerId: string;
      ts: number;
      gsi: unknown;
    };
    expect(forwarded.roomId).toBe("room-test");
    expect(forwarded.playerId).toBe("player-test");
    expect(typeof forwarded.ts).toBe("number");
    expect(forwarded.gsi).toEqual({
      round: {
        map: "de_mirage",
        map_phase: "live",
        phase: "live",
        bomb: null,
        number: 2,
        win_team: null,
        score_ct: 1,
        score_t: 1
      },
      round_timer: {
        source: "computed",
        mode: "round_live",
        duration_sec: 115,
        elapsed_sec: 0,
        remaining_sec: 115
      },
      local_player: {
        steamid: "7656119",
        name: "reality",
        team: "T",
        health: 100,
        armor: 100,
        helmet: true,
        money: 5000,
        equip_value: 3700
      },
      local_events: {
        kill_delta: 1
      }
    });
  });

  it("keeps only useful fields when events are absent", async () => {
    const forward = vi.fn<(payload: RelayGsiPayload) => Promise<void>>(async () => {});
    const baseUrl = await startServer(forward);

    const response = await fetch(`${baseUrl}/gsi`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        map: { name: "de_nuke", phase: "live", round: 9, team_ct: { score: 7 }, team_t: { score: 2 } },
        round: { phase: "over", win_team: "CT" },
        player: {
          steamid: "x",
          name: "p",
          team: "CT",
          state: {
            health: 11,
            armor: 0,
            helmet: false,
            money: 14950,
            equip_value: 1250
          }
        }
      })
    });

    expect(response.status).toBe(202);
    const firstCall = forward.mock.calls[0];
    expect(firstCall).toBeDefined();
    const forwarded = firstCall?.[0] as {
      gsi: Record<string, unknown>;
    };
    expect(forwarded.gsi).toEqual({
      round: {
        map: "de_nuke",
        map_phase: "live",
        phase: "over",
        bomb: null,
        number: 9,
        win_team: "CT",
        score_ct: 7,
        score_t: 2
      },
      local_player: {
        steamid: "x",
        name: "p",
        team: "CT",
        health: 11,
        armor: 0,
        helmet: false,
        money: 14950,
        equip_value: 1250
      }
    });
  });

  it("returns 400 for invalid json", async () => {
    const forward = vi.fn<(payload: RelayGsiPayload) => Promise<void>>(async () => {});
    const baseUrl = await startServer(forward);

    const response = await fetch(`${baseUrl}/gsi`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: "{\"map\":"
    });

    expect(response.status).toBe(400);
    expect(forward).not.toHaveBeenCalled();
  });

  it("accepts local relay auth token via /auth", async () => {
    const forward = vi.fn<(payload: RelayGsiPayload) => Promise<void>>(async () => {});
    const setRelayToken = vi.fn<(token: string) => void>();
    const server = createIngestServer({
      roomId: "room-test",
      playerId: "player-test",
      logRawGsi: false,
      roundLiveDurationSec: 115,
      bombTimerSec: 40,
      forward,
      setRelayToken
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const response = await fetch(`${baseUrl}/auth`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ relayToken: "relay-token-1" })
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(setRelayToken).toHaveBeenCalledWith("relay-token-1");
  });

  it("returns current player-count settings via GET /relay/settings", async () => {
    const forward = vi.fn<(payload: RelayGsiPayload) => Promise<void>>(async () => {});
    const server = createIngestServer({
      roomId: "room-test",
      playerId: "player-test",
      logRawGsi: false,
      roundLiveDurationSec: 115,
      bombTimerSec: 40,
      forward,
      getPlayerCountSettings: () => ({
        screenWidth: 1920,
        screenHeight: 1080,
        gameWidth: 1440,
        gameHeight: 1080
      })
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const response = await fetch(`${baseUrl}/relay/settings`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      settings: {
        screenWidth: 1920,
        screenHeight: 1080,
        gameWidth: 1440,
        gameHeight: 1080
      }
    });
  });

  it("returns 502 when forwarding fails", async () => {
    const forward = vi.fn<(payload: RelayGsiPayload) => Promise<void>>(async () => {
      throw new Error("backend down");
    });
    const baseUrl = await startServer(forward);

    const response = await fetch(`${baseUrl}/gsi`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        map: { name: "de_inferno", phase: "live", round: 3, team_ct: { score: 1 }, team_t: { score: 1 } },
        round: { phase: "live" },
        phase_countdowns: { phase_ends_in: "8.0" }
      })
    });

    expect(response.status).toBe(502);
    expect(forward).toHaveBeenCalledTimes(1);
  });

  it("drops payloads until round map is known", async () => {
    const forward = vi.fn<(payload: RelayGsiPayload) => Promise<void>>(async () => {});
    const baseUrl = await startServer(forward);

    const response = await fetch(`${baseUrl}/gsi`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        player: {
          steamid: "7656119",
          name: "reality"
        },
        phase_countdowns: {
          phase_ends_in: "8.0"
        }
      })
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true, dropped: true, reason: "missing_round_map" });
    expect(forward).not.toHaveBeenCalled();
  });

  it("drops repeated freezetime ticks without freeze snapshot", async () => {
    const forward = vi.fn<(payload: RelayGsiPayload) => Promise<void>>(async () => {});
    const baseUrl = await startServer(forward);

    const first = await fetch(`${baseUrl}/gsi`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        map: { name: "de_dust2", phase: "live", round: 4, team_ct: { score: 2 }, team_t: { score: 2 } },
        round: { phase: "freezetime" },
        player: { team: "CT", state: { money: 8000, equip_value: 2000 } }
      })
    });
    expect(first.status).toBe(202);
    expect(forward).toHaveBeenCalledTimes(1);

    const second = await fetch(`${baseUrl}/gsi`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        map: { name: "de_dust2", phase: "live", round: 4, team_ct: { score: 2 }, team_t: { score: 2 } },
        round: { phase: "freezetime" },
        player: { team: "CT", state: { money: 7600, equip_value: 2400 } }
      })
    });
    expect(second.status).toBe(202);
    expect(await second.json()).toEqual({ accepted: true, dropped: true });
    expect(forward).toHaveBeenCalledTimes(1);
  });

  it("prints player_death event to relay console", async () => {
    const forward = vi.fn<(payload: RelayGsiPayload) => Promise<void>>(async () => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const baseUrl = await startServer(forward);

      const response = await fetch(`${baseUrl}/gsi`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          map: { name: "de_ancient", phase: "live", round: 6, team_ct: { score: 3 }, team_t: { score: 2 } },
          round: { phase: "live" },
          player: {
            steamid: "7656119-local",
            name: "local",
            team: "CT",
            state: {
              health: 0,
              money: 2200
            }
          },
          previously: {
            player: {
              state: {
                health: 45,
                money: 2200
              }
            }
          }
        })
      });

      expect(response.status).toBe(202);
      const deathLogCall = logSpy.mock.calls
        .map((call) => call[0])
        .find(
          (entry) =>
            typeof entry === "string" && entry.includes('"event":"player_death"') && entry.includes('"roomId":"room-test"')
        );
      expect(deathLogCall).toBeDefined();
    } finally {
      logSpy.mockRestore();
    }
  });
});
