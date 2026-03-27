import { execFile, fork, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { getRelayDataDir } from "./app-paths";
import { loadRelayConfig } from "./config";
import { ensureRelayGsiConfig } from "./gsi-config";

const execFileAsync = promisify(execFile);
const GAME_PROCESS_NAMES = ["cs2.exe", "csgo.exe"] as const;
const LAUNCHER_LOG_FILE_NAME = "launcher.log";
const LAUNCHER_LOCK_FILE_NAME = "launcher.lock";
const DEFAULT_STOP_MISSES = 3;

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function shouldStopRelayAfterMisses(consecutiveMisses: number, stopMissesThreshold: number): boolean {
  return consecutiveMisses >= Math.max(1, Math.floor(stopMissesThreshold));
}

export function resolveLauncherLogPath(baseDataDir: string = getRelayDataDir()): string {
  return path.join(baseDataDir, "logs", LAUNCHER_LOG_FILE_NAME);
}

function resolveLauncherLockPath(baseDataDir: string = getRelayDataDir()): string {
  return path.join(baseDataDir, "locks", LAUNCHER_LOCK_FILE_NAME);
}

function appendToLogFile(logPath: string, message: string): void {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  try {
    fs.appendFileSync(logPath, message, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    // The tray log viewer can briefly lock the file on Windows; do not crash the launcher.
    if (code === "EBUSY" || code === "EPERM" || code === "EACCES") {
      return;
    }
    throw error;
  }
}

function writeLauncherLine(logPath: string, payload: Record<string, unknown>, level: "log" | "error" = "log"): void {
  const line = JSON.stringify(payload);
  appendToLogFile(logPath, `${line}\n`);
  if (level === "error") {
    process.stderr.write(`${line}\n`);
    return;
  }
  process.stdout.write(`${line}\n`);
}

type LauncherLock = {
  lockPath: string;
  release(): void;
};

function readLauncherLockPid(lockPath: string): number | null {
  try {
    const raw = fs.readFileSync(lockPath, "utf8").trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLauncherLock(logPath: string): LauncherLock | null {
  const lockPath = resolveLauncherLockPath();
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  try {
    const fd = fs.openSync(lockPath, "wx");
    fs.writeFileSync(fd, String(process.pid), "utf8");
    return {
      lockPath,
      release() {
        try {
          fs.closeSync(fd);
        } catch {}
        try {
          fs.unlinkSync(lockPath);
        } catch {}
      }
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
      const existingPid = readLauncherLockPid(lockPath);
      if (existingPid !== null && !isProcessAlive(existingPid)) {
        writeLauncherLine(logPath, {
          event: "relay_launcher_stale_lock_removed",
          lockPath,
          stalePid: existingPid
        });
        try {
          fs.unlinkSync(lockPath);
        } catch {}
        return acquireLauncherLock(logPath);
      }

      writeLauncherLine(
        logPath,
        {
          event: "relay_launcher_already_running",
          lockPath,
          existingPid
        },
        "error"
      );
      return null;
    }
    throw error;
  }
}

function mirrorChildOutput(
  child: ChildProcess,
  logPath: string,
  streamName: "stdout" | "stderr"
): void {
  const source = child[streamName];
  if (!source) {
    return;
  }

  source.setEncoding("utf8");
  source.on("data", (chunk: string) => {
    appendToLogFile(logPath, chunk);
    if (streamName === "stderr") {
      process.stderr.write(chunk);
      return;
    }
    process.stdout.write(chunk);
  });
}

export function parseTasklistCsvOutput(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const firstField = line.split("\",\"")[0] ?? line;
      return firstField.replace(/^"/, "").replace(/"$/, "").toLowerCase();
    });
}

export function isCounterStrikeRunningFromTasklist(stdout: string): boolean {
  const processNames = new Set(parseTasklistCsvOutput(stdout));
  return GAME_PROCESS_NAMES.some((name) => processNames.has(name));
}

async function isCounterStrikeRunning(): Promise<boolean> {
  const result = await execFileAsync("tasklist", ["/FO", "CSV", "/NH"], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024
  });
  return isCounterStrikeRunningFromTasklist(result.stdout);
}

function getRelayEntryPath(): string {
  const ext = path.extname(__filename) || ".js";
  return path.resolve(__dirname, `index${ext}`);
}

function startRelayChild(logPath: string): ChildProcess {
  const relayEntryPath = getRelayEntryPath();
  const child = fork(relayEntryPath, [], {
    env: process.env,
    execArgv: process.execArgv,
    stdio: ["ignore", "pipe", "pipe", "ipc"]
  });
  mirrorChildOutput(child, logPath, "stdout");
  mirrorChildOutput(child, logPath, "stderr");
  writeLauncherLine(logPath, {
      event: "relay_launcher_child_started",
      pid: child.pid,
      relayEntryPath
    });
  return child;
}

export async function bootstrapLauncher(): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("relay launcher currently supports Windows only.");
  }

  const logPath = resolveLauncherLogPath();
  const launcherLock = acquireLauncherLock(logPath);
  if (!launcherLock) {
    return;
  }
  const config = loadRelayConfig();
  try {
    const gsiConfigResult = ensureRelayGsiConfig(config.gsiIntegration);
    writeLauncherLine(logPath, {
      event: "relay_launcher_gsi_config_ready",
      status: gsiConfigResult.status,
      path: gsiConfigResult.path,
      uri: config.gsiIntegration.uri
    });
  } catch (error) {
    writeLauncherLine(
      logPath,
      {
        event: "relay_launcher_gsi_config_failed",
        path: config.gsiIntegration.configPath,
        error: error instanceof Error ? error.message : String(error)
      },
      "error"
    );
  }

  const pollMs = Math.max(1000, Number(process.env.RELAY_LAUNCHER_POLL_MS ?? 5000));
  const stopMissesThreshold = Math.max(1, Number(process.env.RELAY_LAUNCHER_STOP_MISSES ?? DEFAULT_STOP_MISSES));
  writeLauncherLine(logPath, {
    event: "relay_launcher_started",
    pollMs,
    stopMissesThreshold,
    watch: GAME_PROCESS_NAMES,
    logPath
  });

  let relayChild: ChildProcess | null = null;
  let consecutiveGameMisses = 0;
  let shuttingDown = false;
  let resolveShutdown: (() => void) | null = null;
  const shutdownComplete = new Promise<void>((resolve) => {
    resolveShutdown = resolve;
  });

  const tick = async (): Promise<void> => {
    let running = false;
    try {
      running = await isCounterStrikeRunning();
    } catch (error) {
      writeLauncherLine(
        logPath,
        {
          event: "relay_launcher_tasklist_failed",
          error: formatErrorMessage(error)
        },
        "error"
      );
      return;
    }

    if (running) {
      consecutiveGameMisses = 0;
    } else {
      consecutiveGameMisses += 1;
    }

    if (running && !relayChild) {
      try {
        relayChild = startRelayChild(logPath);
      } catch (error) {
        writeLauncherLine(
          logPath,
          {
            event: "relay_launcher_child_start_failed",
            error: formatErrorMessage(error)
          },
          "error"
        );
        return;
      }
      relayChild.on("exit", (code, signal) => {
        writeLauncherLine(logPath, {
          event: "relay_launcher_child_exited",
          code,
          signal
        });
        relayChild = null;
      });
      return;
    }

    if (!running && relayChild) {
      if (!shouldStopRelayAfterMisses(consecutiveGameMisses, stopMissesThreshold)) {
        writeLauncherLine(logPath, {
          event: "relay_launcher_game_miss_detected",
          consecutiveMisses: consecutiveGameMisses,
          stopMissesThreshold
        });
        return;
      }
      writeLauncherLine(logPath, {
        event: "relay_launcher_child_stopping",
        pid: relayChild.pid,
        reason: "game_not_running",
        consecutiveMisses: consecutiveGameMisses
      });
      relayChild.kill("SIGTERM");
      relayChild = null;
    }
  };

  const timer = setInterval(() => {
    void tick().catch((error: unknown) => {
      writeLauncherLine(
        logPath,
        {
          event: "relay_launcher_tick_failed",
          error: formatErrorMessage(error)
        },
        "error"
      );
    });
  }, pollMs);

  await tick();

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    clearInterval(timer);
    if (relayChild) {
      relayChild.kill("SIGTERM");
      relayChild = null;
    }
    launcherLock.release();
    resolveShutdown?.();
  };

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });
  process.once("uncaughtException", (error: unknown) => {
    writeLauncherLine(
      logPath,
      {
        event: "relay_launcher_uncaught_exception",
        error: formatErrorMessage(error)
      },
      "error"
    );
    void shutdown().finally(() => {
      process.exit(1);
    });
  });
  process.once("unhandledRejection", (reason: unknown) => {
    writeLauncherLine(
      logPath,
      {
        event: "relay_launcher_unhandled_rejection",
        error: formatErrorMessage(reason)
      },
      "error"
    );
    void shutdown().finally(() => {
      process.exit(1);
    });
  });

  await shutdownComplete;
}

if (require.main === module) {
  bootstrapLauncher().catch((error) => {
    writeLauncherLine(resolveLauncherLogPath(), {
        event: "relay_launcher_failed",
        error: formatErrorMessage(error)
      },
      "error"
    );
    process.exit(1);
  });
}
