import { runPlayerCountPipelineDetailed } from "./pipeline";
import { loadRelayConfig } from "../config";

type WorkerPredictionMessage = {
  type: "prediction";
  ts: number;
  leftDigit: string | null;
  rightDigit: string | null;
  leftScore: number;
  rightScore: number;
};

type WorkerStatusMessage = {
  type: "status";
  event: string;
  intervalMs: number;
  threshold: number;
  persistArtifacts: boolean;
  outputDir: string;
  templatesDir: string;
};

type WorkerTimingMessage = {
  type: "status";
  event: "player_count_worker_timing";
  ts: number;
  captureMs: number;
  preprocessMs: number;
  matchMs: number;
  fullLoopMs: number;
};

function readDebugFlag(name: string): boolean {
  return /^(1|true|yes|on)$/i.test(process.env[name] ?? "");
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function run(): Promise<void> {
  if (process.platform !== "win32") {
    process.send?.({
      type: "status",
      level: "warn",
      event: "player_count_worker_skipped",
      reason: "unsupported_platform",
      platform: process.platform
    });
    return;
  }

  const intervalMs = Number(process.env.PLAYER_COUNT_LIVE_INTERVAL_MS ?? 700);
  const threshold = Number(process.env.PLAYER_COUNT_THRESHOLD ?? 180);
  const persistArtifacts =
    readDebugFlag("PLAYER_COUNT_DEBUG_PERSIST_ARTIFACTS") ||
    readDebugFlag("DEBUG");
  const debugTimings = readDebugFlag("DEBUG");
  const initialConfig = loadRelayConfig();
  process.send?.({
    type: "status",
    event: "player_count_worker_config",
    intervalMs,
    threshold,
    persistArtifacts,
    outputDir: initialConfig.playerCount.outputDir,
    templatesDir: initialConfig.playerCount.templatesDir
  } satisfies WorkerStatusMessage);
  let running = true;

  process.once("SIGINT", () => {
    running = false;
  });
  process.once("SIGTERM", () => {
    running = false;
  });

  while (running) {
    const startedAt = Date.now();
    try {
      const config = loadRelayConfig();
      const result = await runPlayerCountPipelineDetailed(config.playerCount, { threshold, persistArtifacts });
      const predictions = result.predictions;
      const left = predictions.find((item) => item.roi === "slot-1");
      const right = predictions.find((item) => item.roi === "slot-2");

      const message: WorkerPredictionMessage = {
        type: "prediction",
        ts: Date.now(),
        leftDigit: left?.predictedDigit ?? null,
        rightDigit: right?.predictedDigit ?? null,
        leftScore: left?.predictedScore ?? 0,
        rightScore: right?.predictedScore ?? 0
      };
      process.send?.(message);
      if (debugTimings) {
        process.send?.({
          type: "status",
          event: "player_count_worker_timing",
          ts: message.ts,
          captureMs: result.timings.captureMs,
          preprocessMs: result.timings.preprocessMs,
          matchMs: result.timings.matchMs,
          fullLoopMs: result.timings.fullLoopMs
        } satisfies WorkerTimingMessage);
      }
    } catch (error) {
      process.send?.({
        type: "error",
        event: "player_count_worker_error",
        error: error instanceof Error ? error.message : String(error)
      });
    }

    const elapsed = Date.now() - startedAt;
    const waitMs = Math.max(0, intervalMs - elapsed);
    await sleep(waitMs);
  }
}

run().catch((error) => {
  process.send?.({
    type: "error",
    event: "player_count_worker_crashed",
    error: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});
