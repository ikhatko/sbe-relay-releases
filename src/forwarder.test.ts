import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import { createRelayForwarder } from "./forwarder";

type StartedWsServer = {
  baseUrl: string;
  close(): Promise<void>;
};

async function startRelayWsServer(onConnection: (socket: import("ws").WebSocket) => void): Promise<StartedWsServer> {
  const server = createServer();
  const wsServer = new WebSocketServer({ server, path: "/ws/relay" });
  wsServer.on("connection", onConnection);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      for (const client of wsServer.clients) {
        client.terminate();
      }
      await new Promise<void>((resolve) => wsServer.close(() => resolve()));
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  };
}

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now();
  while (!check()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("waitFor timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("createRelayForwarder", () => {
  const servers: StartedWsServer[] = [];

  afterEach(async () => {
    while (servers.length > 0) {
      const server = servers.pop();
      if (server) {
        await server.close();
      }
    }
  });

  it("waits for local auth token before connecting", async () => {
    const forwarder = createRelayForwarder({
      backendUrl: "http://localhost:8080"
    });

    await forwarder.send({
      roomId: "room-a",
      playerId: "player-a",
      ts: 1,
      gsi: {}
    });

    expect(forwarder.getStatus()).toMatchObject({
      connected: false,
      state: "waiting_for_token",
      queuedEvents: 1
    });
  });

  it("authenticates via first ws message and flushes queued events", async () => {
    let lastAuthToken: string | null = null;
    let sawRelayEvent = false;
    const started = await startRelayWsServer((socket) => {
      socket.on("message", (raw) => {
        const parsed = JSON.parse(raw.toString("utf8")) as { type: string; token?: string };
        if (parsed.type === "auth") {
          lastAuthToken = parsed.token ?? null;
          socket.send(JSON.stringify({ type: "relay.auth.ok", payload: { userId: 123 }, ts: Date.now(), v: 1 }));
          return;
        }
        if (parsed.type === "relay.gsi") {
          sawRelayEvent = true;
        }
      });
    });
    servers.push(started);

    const forwarder = createRelayForwarder({
      backendUrl: started.baseUrl
    });

    await forwarder.send({
      roomId: "room-a",
      playerId: "player-a",
      ts: 1,
      gsi: { map: "de_mirage" }
    });
    forwarder.setRelayToken("token-1");

    await waitFor(() => forwarder.getStatus().connected);
    await waitFor(() => sawRelayEvent);

    expect(lastAuthToken).toBe("token-1");
    expect(forwarder.getStatus().queuedEvents).toBe(0);
  });

  it("enters need_new_token state on unauthorized close", async () => {
    const started = await startRelayWsServer((socket) => {
      socket.on("message", (raw) => {
        const parsed = JSON.parse(raw.toString("utf8")) as { type: string };
        if (parsed.type === "auth") {
          socket.close(1008, "unauthorized");
        }
      });
    });
    servers.push(started);

    const forwarder = createRelayForwarder({
      backendUrl: started.baseUrl
    });
    forwarder.setRelayToken("token-1");

    await waitFor(() => forwarder.getStatus().state === "need_new_token");
    expect(forwarder.getStatus().connected).toBe(false);
  });
});
