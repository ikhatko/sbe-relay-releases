import WebSocket from "ws";
import type { RelayGsiPayload } from "@sbe/shared";

export type RelayForwarderStatus = {
  connected: boolean;
  state: "idle" | "waiting_for_token" | "connecting" | "authenticating" | "connected" | "need_new_token";
  queuedEvents: number;
};

export type RelayForwarder = {
  send(payload: RelayGsiPayload): Promise<void>;
  setRelayToken(token: string): void;
  getStatus(): RelayForwarderStatus;
};

type ForwarderOptions = {
  backendUrl: string;
};

const RECONNECT_DELAYS_MS = [0, 1_000, 2_000, 5_000, 10_000] as const;
const MAX_QUEUE_SIZE = 64;

function resolveRelayWsUrl(backendUrl: string): string {
  const normalized = backendUrl.replace(/\/+$/, "").replace(/\/api$/i, "");
  const parsed = new URL(normalized);
  const protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${parsed.host}/ws/relay`;
}

function parseServerMessage(raw: WebSocket.RawData): { type?: string; payload?: unknown } | null {
  try {
    const text = typeof raw === "string" ? raw : raw.toString("utf8");
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as { type?: string; payload?: unknown };
  } catch {
    return null;
  }
}

export function createRelayForwarder(options: ForwarderOptions): RelayForwarder {
  const wsUrl = resolveRelayWsUrl(options.backendUrl);

  let socket: WebSocket | null = null;
  let relayToken: string | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let reconnectAttempt = 0;
  let authenticated = false;
  let state: RelayForwarderStatus["state"] = "idle";
  const queue: RelayGsiPayload[] = [];

  const clearReconnectTimer = () => {
    if (!reconnectTimer) {
      return;
    }
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const setNeedNewToken = () => {
    state = "need_new_token";
    authenticated = false;
    clearReconnectTimer();
  };

  const flushQueue = () => {
    if (!socket || socket.readyState !== WebSocket.OPEN || !authenticated) {
      return;
    }
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) {
        continue;
      }
      socket.send(
        JSON.stringify({
          type: "relay.gsi",
          payload: next,
          ts: next.ts,
          v: 1
        })
      );
    }
  };

  const scheduleReconnect = () => {
    if (!relayToken || state === "need_new_token") {
      return;
    }
    const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)] ?? 10_000;
    reconnectAttempt += 1;
    clearReconnectTimer();
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const connect = () => {
    if (!relayToken) {
      state = "waiting_for_token";
      return;
    }
    if (state === "need_new_token") {
      return;
    }
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    state = "connecting";
    socket = new WebSocket(wsUrl);

    socket.on("open", () => {
      if (!socket || socket.readyState !== WebSocket.OPEN || !relayToken) {
        return;
      }
      state = "authenticating";
      authenticated = false;
      socket.send(
        JSON.stringify({
          type: "auth",
          token: relayToken
        })
      );
    });

    socket.on("message", (raw: WebSocket.RawData) => {
      const message = parseServerMessage(raw);
      if (!message?.type) {
        return;
      }
      if (message.type === "relay.auth.ok") {
        reconnectAttempt = 0;
        authenticated = true;
        state = "connected";
        flushQueue();
      }
      if (message.type === "system.error") {
        const payload = (message.payload ?? {}) as Record<string, unknown>;
        if (payload.code === "UNAUTHORIZED" || payload.code === "TOKEN_EXPIRED") {
          setNeedNewToken();
          if (socket) {
            socket.close();
          }
        }
      }
    });

    socket.on("close", (code: number) => {
      authenticated = false;
      socket = null;
      if (code === 1008 || code === 4003) {
        setNeedNewToken();
        console.error(JSON.stringify({ event: "relay_forward_need_new_token", code }));
        return;
      }
      state = relayToken ? "connecting" : "waiting_for_token";
      scheduleReconnect();
    });

    socket.on("error", (error: Error) => {
      console.error(
        JSON.stringify({
          event: "relay_forward_ws_error",
          error: error instanceof Error ? error.message : String(error)
        })
      );
    });
  };

  return {
    async send(payload: RelayGsiPayload): Promise<void> {
      if (queue.length >= MAX_QUEUE_SIZE) {
        queue.shift();
      }
      queue.push(payload);
      if (!relayToken) {
        state = "waiting_for_token";
        return;
      }
      if (state === "need_new_token") {
        return;
      }
      connect();
      flushQueue();
    },
    setRelayToken(token: string): void {
      const normalized = token.trim();
      relayToken = normalized.length > 0 ? normalized : null;
      reconnectAttempt = 0;
      authenticated = false;
      if (!relayToken) {
        state = "waiting_for_token";
        clearReconnectTimer();
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.close(1000, "token_cleared");
        }
        return;
      }
      state = "connecting";
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close(1000, "token_updated");
      } else {
        connect();
      }
    },
    getStatus(): RelayForwarderStatus {
      return {
        connected: Boolean(socket && socket.readyState === WebSocket.OPEN && authenticated),
        state,
        queuedEvents: queue.length
      };
    }
  };
}
