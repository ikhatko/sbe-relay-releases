import fs from "node:fs";
import path from "node:path";
import { fork, type ChildProcess } from "node:child_process";
import type { RelayGsiPayload } from "@sbe/shared";

import { resolvePlayerCountRuntimeSettingsPath } from "./app-paths";
import { createRelayForwarder } from "./forwarder";
import { loadRelayConfig } from "./config";
import { ensureRelayGsiConfig } from "./gsi-config";
import { createIngestServer } from "./ingest";
import { getMapPhase, getRoundPhase, isMatchEndPhase, isRoundEndPhase } from "./match-phase";
import {
  sanitizeRuntimePlayerCountSettings,
  type RuntimePlayerCountSettings
} from "./player-count-runtime-settings";

type ScoreState = {
  left: number;
  right: number;
};

type PendingScoreCorrection = {
  digit: number;
  confirmations: number;
};

type PlayerCountWorkerPrediction = {
  type: "prediction";
  ts: number;
  leftDigit: string | null;
  rightDigit: string | null;
  leftScore: number;
  rightScore: number;
};

function readDebugFlag(name: string): boolean {
  return /^(1|true|yes|on)$/i.test(process.env[name] ?? "");
}

function startPlayerCountWorker(params: {
  enabled: boolean;
  supported: boolean;
  onPrediction(message: PlayerCountWorkerPrediction): void;
  onError(message: { event?: string; error?: string }): void;
  onExit?(): void;
}): ChildProcess | null {
  if (!params.enabled || !params.supported) {
    return null;
  }
  const ext = path.extname(__filename) || ".js";
  const workerPath = path.resolve(__dirname, "player-count", `worker${ext}`);
  const worker = fork(workerPath, [], {
    env: process.env,
    execArgv: process.execArgv,
    stdio: ["ignore", "ignore", "ignore", "ipc"]
  });

  console.log(
    JSON.stringify({
      event: "relay_player_count_worker_started",
      pid: worker.pid,
      workerPath
    })
  );

  worker.on("message", (message: unknown) => {
    if (!message || typeof message !== "object") {
      return;
    }
    const data = message as Partial<PlayerCountWorkerPrediction> & { type?: string; error?: string; event?: string };
    if (data.type === "prediction") {
      params.onPrediction(data as PlayerCountWorkerPrediction);
      return;
    }
    if (data.type === "status") {
      console.log(JSON.stringify(data));
      return;
    }
    if (data.type === "error") {
      params.onError(data);
    }
  });
  worker.on("error", (error) => {
    params.onError({
      event: "relay_player_count_worker_process_error",
      error: error.message
    });
  });
  worker.on("exit", (code, signal) => {
    console.log(
      JSON.stringify({
        event: "relay_player_count_worker_exited",
        code,
        signal
      })
    );
    params.onExit?.();
  });

  return worker;
}

const runtimeSettingsPath = resolvePlayerCountRuntimeSettingsPath();

function parseDigit(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  return /^[0-5]$/.test(value) ? Number(value) : null;
}

const SCORE_UPWARD_CONFIRMATIONS_REQUIRED = 3;

function advancePendingScoreCorrection(
  current: PendingScoreCorrection | null,
  digit: number
): PendingScoreCorrection {
  if (current && current.digit === digit) {
    return {
      digit,
      confirmations: current.confirmations + 1
    };
  }
  return {
    digit,
    confirmations: 1
  };
}

function isResolutionNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 200 && value <= 10000;
}

function readRuntimePlayerCountSettingsFromDisk(): {
  settings: Partial<RuntimePlayerCountSettings>;
  droppedLegacyFormulaMode: boolean;
} {
  try {
    if (!fs.existsSync(runtimeSettingsPath)) {
      return { settings: {}, droppedLegacyFormulaMode: false };
    }
    const raw = fs.readFileSync(runtimeSettingsPath, "utf8");
    return sanitizeRuntimePlayerCountSettings(JSON.parse(raw));
  } catch {
    return { settings: {}, droppedLegacyFormulaMode: false };
  }
}

function applyRuntimePlayerCountSettingsToEnv(settings: Partial<RuntimePlayerCountSettings>): Record<string, string> {
  const applied: Record<string, string> = {};
  if (isResolutionNumber(settings.screenWidth)) {
    process.env.PLAYER_COUNT_SCREEN_WIDTH = String(Math.round(settings.screenWidth));
    applied.PLAYER_COUNT_SCREEN_WIDTH = process.env.PLAYER_COUNT_SCREEN_WIDTH;
  }
  if (isResolutionNumber(settings.screenHeight)) {
    process.env.PLAYER_COUNT_SCREEN_HEIGHT = String(Math.round(settings.screenHeight));
    applied.PLAYER_COUNT_SCREEN_HEIGHT = process.env.PLAYER_COUNT_SCREEN_HEIGHT;
  }
  if (isResolutionNumber(settings.gameWidth)) {
    process.env.PLAYER_COUNT_GAME_WIDTH = String(Math.round(settings.gameWidth));
    applied.PLAYER_COUNT_GAME_WIDTH = process.env.PLAYER_COUNT_GAME_WIDTH;
  }
  if (isResolutionNumber(settings.gameHeight)) {
    process.env.PLAYER_COUNT_GAME_HEIGHT = String(Math.round(settings.gameHeight));
    applied.PLAYER_COUNT_GAME_HEIGHT = process.env.PLAYER_COUNT_GAME_HEIGHT;
  }
  return applied;
}

function saveRuntimePlayerCountSettingsToDisk(settings: Partial<RuntimePlayerCountSettings>): void {
  const dir = path.dirname(runtimeSettingsPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(runtimeSettingsPath, JSON.stringify(settings, null, 2), "utf8");
}

function parseAndValidateSettingsPayload(
  payload: unknown
): { ok: true; settings: Partial<RuntimePlayerCountSettings> } | { ok: false; error: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "Settings payload must be a JSON object." };
  }
  const input = payload as Record<string, unknown>;
  const settings: Partial<RuntimePlayerCountSettings> = {};

  if (input.screenWidth !== undefined) {
    if (!isResolutionNumber(input.screenWidth)) {
      return { ok: false, error: "screenWidth must be a valid number." };
    }
    settings.screenWidth = Math.round(input.screenWidth);
  }
  if (input.screenHeight !== undefined) {
    if (!isResolutionNumber(input.screenHeight)) {
      return { ok: false, error: "screenHeight must be a valid number." };
    }
    settings.screenHeight = Math.round(input.screenHeight);
  }
  if (input.gameWidth !== undefined) {
    if (!isResolutionNumber(input.gameWidth)) {
      return { ok: false, error: "gameWidth must be a valid number." };
    }
    settings.gameWidth = Math.round(input.gameWidth);
  }
  if (input.gameHeight !== undefined) {
    if (!isResolutionNumber(input.gameHeight)) {
      return { ok: false, error: "gameHeight must be a valid number." };
    }
    settings.gameHeight = Math.round(input.gameHeight);
  }

  return { ok: true, settings };
}

async function bootstrap() {
  const initialRuntimeSettings = readRuntimePlayerCountSettingsFromDisk();
  let runtimePlayerCountSettings: Partial<RuntimePlayerCountSettings> = {
    ...initialRuntimeSettings.settings
  };
  const initialApplied = applyRuntimePlayerCountSettingsToEnv(initialRuntimeSettings.settings);
  if (initialRuntimeSettings.droppedLegacyFormulaMode) {
    saveRuntimePlayerCountSettingsToDisk(initialRuntimeSettings.settings);
  }
  if (Object.keys(initialApplied).length > 0) {
    console.log(
      JSON.stringify({
        event: "relay_player_count_runtime_settings_loaded",
        applied: initialApplied
      })
    );
  }
  const config = loadRelayConfig();
  try {
    const gsiConfigResult = ensureRelayGsiConfig(config.gsiIntegration);
    console.log(
      JSON.stringify({
        event: "relay_gsi_config_ready",
        status: gsiConfigResult.status,
        path: gsiConfigResult.path,
        uri: config.gsiIntegration.uri
      })
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "relay_gsi_config_failed",
        path: config.gsiIntegration.configPath,
        error: error instanceof Error ? error.message : String(error)
      })
    );
  }
  const playerCountMinConfidence = Number(process.env.PLAYER_COUNT_MIN_CONFIDENCE ?? 0.9);
  const playerCountDebugPersistArtifacts =
    readDebugFlag("PLAYER_COUNT_DEBUG_PERSIST_ARTIFACTS") ||
    readDebugFlag("DEBUG");
  const playerCountSupported = process.platform === "win32";
  const playerCountEnabled = config.playerCount.enabled;
  console.log(
    JSON.stringify({
      event: "relay_player_count_config",
      enabled: playerCountEnabled,
      supported: playerCountSupported,
      minConfidence: playerCountMinConfidence,
      debugPersistArtifacts: playerCountDebugPersistArtifacts,
      outputDir: config.playerCount.outputDir,
      templatesDir: config.playerCount.templatesDir,
      formulaMode: config.playerCount.formulaMode,
      screen: `${config.playerCount.screenWidth}x${config.playerCount.screenHeight}`,
      game: `${config.playerCount.gameWidth}x${config.playerCount.gameHeight}`,
      rois: config.playerCount.rois
    })
  );
  let playerCountRoundLive = false;
  let playerCountScore: ScoreState = { left: 5, right: 5 };
  let pendingScoreCorrection: { left: PendingScoreCorrection | null; right: PendingScoreCorrection | null } = {
    left: null,
    right: null
  };
  let latestWorkerPrediction: PlayerCountWorkerPrediction | null = null;
  let latestGsiSnapshot: Record<string, unknown> = {};
  let playerCountWorker: ChildProcess | null = null;
  let shuttingDown = false;
  let scoreSnapshotPushInFlight = false;
  let playerCountMatchPaused = false;
  const handlePrediction = (prediction: PlayerCountWorkerPrediction) => {
    if (playerCountMatchPaused) {
      return;
    }
    latestWorkerPrediction = prediction;
    if (readDebugFlag("DEBUG")) {
      console.log(
        JSON.stringify({
          event: "relay_player_count_prediction",
          ts: prediction.ts,
          roundLive: playerCountRoundLive,
          currentScore: `${playerCountScore.left}-${playerCountScore.right}`,
          leftDigit: prediction.leftDigit,
          rightDigit: prediction.rightDigit,
          leftScore: Number(prediction.leftScore.toFixed(4)),
          rightScore: Number(prediction.rightScore.toFixed(4)),
          minConfidence: playerCountMinConfidence
        })
      );
    }
    if (!playerCountRoundLive) {
      return;
    }
    const leftDigit = parseDigit(latestWorkerPrediction.leftDigit);
    const rightDigit = parseDigit(latestWorkerPrediction.rightDigit);
    const canUseLeft = latestWorkerPrediction.leftScore >= playerCountMinConfidence;
    const canUseRight = latestWorkerPrediction.rightScore >= playerCountMinConfidence;

    let nextLeft = playerCountScore.left;
    let nextRight = playerCountScore.right;
    if (canUseLeft && leftDigit !== null) {
      if (leftDigit <= playerCountScore.left) {
        nextLeft = leftDigit;
        pendingScoreCorrection.left = null;
      } else {
        pendingScoreCorrection.left = advancePendingScoreCorrection(pendingScoreCorrection.left, leftDigit);
        if (pendingScoreCorrection.left.confirmations >= SCORE_UPWARD_CONFIRMATIONS_REQUIRED) {
          nextLeft = leftDigit;
          pendingScoreCorrection.left = null;
        }
      }
    }
    if (canUseRight && rightDigit !== null) {
      if (rightDigit <= playerCountScore.right) {
        nextRight = rightDigit;
        pendingScoreCorrection.right = null;
      } else {
        pendingScoreCorrection.right = advancePendingScoreCorrection(pendingScoreCorrection.right, rightDigit);
        if (pendingScoreCorrection.right.confirmations >= SCORE_UPWARD_CONFIRMATIONS_REQUIRED) {
          nextRight = rightDigit;
          pendingScoreCorrection.right = null;
        }
      }
    }
    const scoreChanged = nextLeft !== playerCountScore.left || nextRight !== playerCountScore.right;
    if (scoreChanged) {
      playerCountScore = { left: nextLeft, right: nextRight };
      console.log(
        JSON.stringify({
          event: "score_event",
          score: `${playerCountScore.left}-${playerCountScore.right}`,
          left: String(playerCountScore.left),
          right: String(playerCountScore.right)
        })
      );
      void pushScoreSnapshotNow("score_changed");
    }
  };
  const forwarder = createRelayForwarder({
    backendUrl: config.backendUrl
  });
  const pushScoreSnapshotNow = async (reason: "score_changed" | "round_live_start"): Promise<void> => {
    if (scoreSnapshotPushInFlight) {
      return;
    }
    scoreSnapshotPushInFlight = true;
    try {
      const payload: RelayGsiPayload = {
        roomId: config.roomId,
        playerId: config.playerId,
        ts: Date.now(),
        gsi: {
          ...latestGsiSnapshot,
          player_count: {
            active: playerCountRoundLive,
            left: String(playerCountScore.left),
            right: String(playerCountScore.right),
            score: `${playerCountScore.left}-${playerCountScore.right}`
          }
        }
      };
      await forwarder.send(payload);
      console.log(
        JSON.stringify({
          event: "relay_player_count_snapshot_forwarded",
          reason,
          score: `${playerCountScore.left}-${playerCountScore.right}`,
          ts: payload.ts
        })
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "relay_player_count_snapshot_forward_failed",
          reason,
          error: error instanceof Error ? error.message : String(error)
        })
      );
    } finally {
      scoreSnapshotPushInFlight = false;
    }
  };
  const server = createIngestServer({
    roomId: config.roomId,
    playerId: config.playerId,
    logRawGsi: config.logRawGsi,
    roundLiveDurationSec: config.roundLiveDurationSec,
    bombTimerSec: config.bombTimerSec,
    setRelayToken: (token: string) => {
      forwarder.setRelayToken(token);
    },
    getRelayStatus: () => forwarder.getStatus(),
    getPlayerCountSettings: () => ({ ...runtimePlayerCountSettings }),
    updatePlayerCountSettings: (payload) => {
      const parsed = parseAndValidateSettingsPayload(payload);
      if (!parsed.ok) {
        return parsed;
      }
      const next = { ...runtimePlayerCountSettings, ...parsed.settings };
      const applied = applyRuntimePlayerCountSettingsToEnv(next);
      saveRuntimePlayerCountSettingsToDisk(next);
      runtimePlayerCountSettings = next;
      console.log(
        JSON.stringify({
          event: "relay_player_count_settings_updated",
          applied
        })
      );
      if (playerCountWorker) {
        playerCountWorker.kill();
        playerCountWorker = null;
      }
      playerCountWorker = startPlayerCountWorker({
        enabled: playerCountEnabled,
        supported: playerCountSupported,
        onPrediction: handlePrediction,
        onError: (data) => {
          if (!data.error) return;
          console.error(
            JSON.stringify({
              event: data.event ?? "relay_player_count_worker_error",
              error: data.error
            })
          );
        }
      });
      return { ok: true, applied };
    },
    forward: async (payload) => {
      latestGsiSnapshot = payload.gsi as Record<string, unknown>;
      const roundPhase = getRoundPhase(payload.gsi);
      const mapPhase = getMapPhase(payload.gsi);
      if (mapPhase && isMatchEndPhase(mapPhase)) {
        if (!playerCountMatchPaused) {
          console.log(
            JSON.stringify({
              event: "relay_player_count_paused",
              reason: "match_ended",
              mapPhase
            })
          );
        }
        playerCountMatchPaused = true;
        playerCountRoundLive = false;
        pendingScoreCorrection = { left: null, right: null };
      } else if (playerCountMatchPaused && roundPhase === "live") {
        playerCountMatchPaused = false;
        console.log(
          JSON.stringify({
            event: "relay_player_count_resumed",
            reason: "new_round_live",
            mapPhase
          })
        );
      }

      if (!playerCountMatchPaused && roundPhase === "live" && !playerCountRoundLive) {
        playerCountRoundLive = true;
        playerCountScore = { left: 5, right: 5 };
        pendingScoreCorrection = { left: null, right: null };
        void pushScoreSnapshotNow("round_live_start");
      } else if (roundPhase && isRoundEndPhase(roundPhase)) {
        playerCountRoundLive = false;
        pendingScoreCorrection = { left: null, right: null };
      }

      const enrichedPayload = {
        ...payload,
        gsi: {
          ...(payload.gsi as Record<string, unknown>),
          player_count: {
            active: playerCountRoundLive,
            left: String(playerCountScore.left),
            right: String(playerCountScore.right),
            score: `${playerCountScore.left}-${playerCountScore.right}`
          }
        }
      };

      await forwarder.send(enrichedPayload);
      const relayStatus = forwarder.getStatus();
      console.log(
        JSON.stringify({
          event: "relay_gsi_forwarded",
          roomId: payload.roomId,
          playerId: payload.playerId,
          ts: payload.ts,
          relayConnected: relayStatus.connected,
          relayState: relayStatus.state,
          relayQueuedEvents: relayStatus.queuedEvents
        })
      );
    }
  });
  server.listen(config.httpPort, () => {
    console.log(
      JSON.stringify({
        event: "relay_started",
        port: config.httpPort,
        backendUrl: config.backendUrl
      })
    );
  });

  if (playerCountEnabled && !playerCountSupported) {
    console.log(
      JSON.stringify({
        event: "relay_player_count_skipped",
        reason: "unsupported_platform",
        platform: process.platform
      })
    );
  }

  if (playerCountEnabled && playerCountSupported) {
    playerCountWorker = startPlayerCountWorker({
      enabled: playerCountEnabled,
      supported: playerCountSupported,
      onPrediction: handlePrediction,
      onError: (data) => {
        if (!data.error) return;
        console.error(
          JSON.stringify({
            event: data.event ?? "relay_player_count_worker_error",
            error: data.error
          })
        );
      },
      onExit: () => {
        playerCountWorker = null;
        if (!shuttingDown && playerCountEnabled && playerCountSupported) {
          setTimeout(() => {
            if (shuttingDown || playerCountWorker) {
              return;
            }
            playerCountWorker = startPlayerCountWorker({
              enabled: playerCountEnabled,
              supported: playerCountSupported,
              onPrediction: handlePrediction,
              onError: (data) => {
                if (!data.error) return;
                console.error(
                  JSON.stringify({
                    event: data.event ?? "relay_player_count_worker_error",
                    error: data.error
                  })
                );
              }
            });
          }, 1000);
        }
      }
    });
  }

  const shutdown = async () => {
    shuttingDown = true;
    if (playerCountWorker) {
      playerCountWorker.kill();
      playerCountWorker = null;
    }
    server.close();
  };
  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });
}

bootstrap().catch((error) => {
  console.error(
    JSON.stringify({
      event: "relay_start_failed",
      error: error instanceof Error ? error.message : String(error)
    })
  );
  process.exit(1);
});

