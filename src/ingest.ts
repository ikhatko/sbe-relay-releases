import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { RelayGsiPayload } from "@sbe/shared";
import type { RuntimePlayerCountSettings } from "./player-count-runtime-settings";
import { createGsiFilterForPreRound } from "./gsi-filter";

export type IngestDependencies = {
  roomId: string;
  playerId: string;
  logRawGsi: boolean;
  roundLiveDurationSec: number;
  bombTimerSec: number;
  forward(payload: RelayGsiPayload): Promise<void>;
  setRelayToken?(relayToken: string): void;
  getRelayStatus?(): { connected: boolean; state: string; queuedEvents: number };
  getPlayerCountSettings?(): Partial<RuntimePlayerCountSettings>;
  updatePlayerCountSettings?(
    payload: unknown
  ): { ok: true; applied: Record<string, string> } | { ok: false; error: string };
};

function hasForwardableMatchContext(normalized: Record<string, unknown>): boolean {
  const round = (normalized.round as Record<string, unknown> | undefined) ?? undefined;
  return typeof round?.map === "string" && round.map.trim().length > 0;
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(payload));
}

function setCorsJsonHeaders(response: ServerResponse): void {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    request.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8").trim();
        resolve(raw.length > 0 ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", (error) => reject(error));
  });
}

export function createIngestServer(deps: IngestDependencies): Server {
  const filterGsiForPreRound = createGsiFilterForPreRound({
    liveRoundDurationSec: deps.roundLiveDurationSec,
    bombTimerSec: deps.bombTimerSec
  });

  let lastRawGsi: Record<string, unknown> | null = null;
  const server = createServer(async (request, response) => {
    if (request.url === "/auth") {
      setCorsJsonHeaders(response);
      if (request.method === "OPTIONS") {
        response.statusCode = 204;
        response.end();
        return;
      }
      if (request.method !== "POST") {
        writeJson(response, 405, { error: "Method not allowed" });
        return;
      }
      if (!deps.setRelayToken) {
        writeJson(response, 501, { error: "Relay auth is not enabled" });
        return;
      }
      let incoming: unknown;
      try {
        incoming = await readJsonBody(request);
      } catch {
        writeJson(response, 400, { error: "Invalid JSON body" });
        return;
      }
      if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
        writeJson(response, 400, { error: "Auth body must be a JSON object" });
        return;
      }
      const relayToken = (incoming as { relayToken?: unknown }).relayToken;
      if (typeof relayToken !== "string" || relayToken.trim().length === 0) {
        writeJson(response, 400, { error: "relayToken is required" });
        return;
      }
      deps.setRelayToken(relayToken.trim());
      writeJson(response, 200, { ok: true });
      return;
    }

    if (request.url === "/status" && request.method === "GET") {
      setCorsJsonHeaders(response);
      const status = deps.getRelayStatus?.() ?? {
        connected: false,
        state: "waiting_for_token",
        queuedEvents: 0
      };
      writeJson(response, 200, status);
      return;
    }

    if (request.url === "/relay/settings" && request.method === "GET") {
      setCorsJsonHeaders(response);
      const settings = deps.getPlayerCountSettings?.() ?? {};
      writeJson(response, 200, {
        ok: true,
        settings
      });
      return;
    }

    if (request.url === "/relay/settings") {
      setCorsJsonHeaders(response);
      if (request.method === "OPTIONS") {
        response.statusCode = 204;
        response.end();
        return;
      }
      if (request.method !== "POST") {
        writeJson(response, 405, { error: "Method not allowed" });
        return;
      }
      if (!deps.updatePlayerCountSettings) {
        writeJson(response, 501, { error: "Player-count settings update is not enabled" });
        return;
      }
      let incoming: unknown;
      try {
        incoming = await readJsonBody(request);
      } catch {
        writeJson(response, 400, { error: "Invalid JSON body" });
        return;
      }
      const result = deps.updatePlayerCountSettings(incoming);
      if (!result.ok) {
        writeJson(response, 400, { error: result.error });
        return;
      }
      writeJson(response, 200, {
        ok: true,
        applied: result.applied
      });
      return;
    }

    if (request.method !== "POST" || request.url !== "/gsi") {
      writeJson(response, 404, { error: "Not found" });
      return;
    }
    const requestReceivedAt = Date.now();

    let incoming: unknown;
    try {
      incoming = await readJsonBody(request);
    } catch {
      writeJson(response, 400, { error: "Invalid JSON body" });
      return;
    }

    if (typeof incoming !== "object" || incoming === null || Array.isArray(incoming)) {
      writeJson(response, 400, { error: "GSI body must be a JSON object" });
      return;
    }

    if (deps.logRawGsi) {
      console.log(
        JSON.stringify({
          event: "relay_gsi_raw",
          gsi: incoming
        })
      );
    }

    lastRawGsi = incoming as Record<string, unknown>;

    const normalized = filterGsiForPreRound(lastRawGsi);
    if (!hasForwardableMatchContext(normalized)) {
      writeJson(response, 202, { accepted: true, dropped: true, reason: "missing_round_map" });
      return;
    }

    const round = (normalized.round as Record<string, unknown> | undefined) ?? undefined;
    const roundPhase = typeof round?.phase === "string" ? round.phase : null;
    const hasFreezeSnapshot = normalized.freeze_snapshot !== undefined;
    const localEvents = (normalized.local_events as Record<string, unknown> | undefined) ?? undefined;
    const playerDead = localEvents?.player_dead === true;
    const localPlayer = (normalized.local_player as Record<string, unknown> | undefined) ?? undefined;

    if (playerDead) {
      console.log(
        JSON.stringify({
          event: "player_death",
          roomId: deps.roomId,
          playerId: deps.playerId,
          ts: Date.now(),
          round: round?.number ?? null,
          map: round?.map ?? null,
          team: localPlayer?.team ?? null,
          steamid: localPlayer?.steamid ?? null
        })
      );
    }

    if (roundPhase === "freezetime" && !hasFreezeSnapshot) {
      writeJson(response, 202, { accepted: true, dropped: true });
      return;
    }

    const payload: RelayGsiPayload = {
      roomId: deps.roomId,
      playerId: deps.playerId,
      ts: Date.now(),
      gsi: normalized
    };

    try {
      await deps.forward(payload);
      console.log(
        JSON.stringify({
          event: "relay_gsi_ingest_forward_latency",
          durationMs: Date.now() - requestReceivedAt,
          gsiTs: payload.ts
        })
      );
      writeJson(response, 202, { accepted: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown relay forward error";
      writeJson(response, 502, { error: message });
    }
  });

  const ticker = setInterval(() => {
    if (!lastRawGsi) {
      return;
    }
    const normalized = filterGsiForPreRound(lastRawGsi);
    if (!hasForwardableMatchContext(normalized)) {
      return;
    }
    const timeEvents = normalized.time_events;
    if (!Array.isArray(timeEvents) || timeEvents.length === 0) {
      return;
    }
    void deps.forward({
      roomId: deps.roomId,
      playerId: deps.playerId,
      ts: Date.now(),
      gsi: normalized
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        JSON.stringify({
          event: "relay_gsi_timer_forward_failed",
          error: message
        })
      );
    });
  }, 1_000);
  ticker.unref();
  server.on("close", () => {
    clearInterval(ticker);
  });

  return server;
}
