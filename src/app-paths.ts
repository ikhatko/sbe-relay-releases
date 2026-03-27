import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function isExistingDirectory(targetPath: string): boolean {
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

export function getRelayAppDirCandidates(): string[] {
  const candidates = new Set<string>();

  candidates.add(path.resolve(__dirname, ".."));
  candidates.add(path.resolve(process.cwd(), "apps", "relay"));
  candidates.add(process.cwd());
  candidates.add(path.dirname(process.execPath));

  if (process.env.SBE_APP_DIR) {
    candidates.add(path.resolve(process.env.SBE_APP_DIR));
  }

  return [...candidates];
}

export function resolveRelayEnvPath(): string | null {
  const explicitEnvPath = process.env.SBE_ENV_PATH?.trim();
  if (explicitEnvPath) {
    return path.resolve(explicitEnvPath);
  }

  for (const appDir of getRelayAppDirCandidates()) {
    const candidate = path.join(appDir, ".env");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function getRelayDataDir(): string {
  const explicitDataDir = process.env.SBE_DATA_DIR?.trim();
  if (explicitDataDir) {
    return path.resolve(explicitDataDir);
  }

  const localAppData = process.env.LOCALAPPDATA?.trim();
  if (localAppData) {
    return path.join(localAppData, "SBE Relay");
  }

  return path.join(os.homedir(), "AppData", "Local", "SBE Relay");
}

export function resolveBundledPlayerCountTemplatesDir(): string {
  const explicitTemplatesDir = process.env.PLAYER_COUNT_TEMPLATES_DIR?.trim();
  if (explicitTemplatesDir) {
    return path.resolve(explicitTemplatesDir);
  }

  for (const appDir of getRelayAppDirCandidates()) {
    const candidate = path.join(appDir, "player-count", "templates");
    if (isExistingDirectory(candidate)) {
      return candidate;
    }
  }

  return path.join(getRelayAppDirCandidates()[0] ?? process.cwd(), "player-count", "templates");
}

export function resolvePlayerCountOutputDir(): string {
  const explicitOutputDir = process.env.PLAYER_COUNT_OUTPUT_DIR?.trim();
  if (explicitOutputDir) {
    return path.resolve(explicitOutputDir);
  }

  return path.join(getRelayDataDir(), "player-count", "tmp");
}

export function resolvePlayerCountRuntimeSettingsPath(): string {
  return path.join(getRelayDataDir(), "player-count", "runtime-settings.json");
}
