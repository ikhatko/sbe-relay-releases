import dotenv from "dotenv";
import path from "node:path";

import {
  resolveBundledPlayerCountTemplatesDir,
  resolvePlayerCountOutputDir,
  resolveRelayEnvPath
} from "./app-paths";
import { projectRoiFromReference, scaleRoisFor16By9 } from "./player-count/calibration";

const resolvedEnvPath = resolveRelayEnvPath();
dotenv.config(resolvedEnvPath ? { path: resolvedEnvPath } : undefined);

function readRequired(name: string, fallback: string): string {
  const raw = process.env[name];
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return fallback.trim();
}

function readBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export type RoiCorner = {
  x: number;
  y: number;
};

export type PlayerCountRoiConfig = {
  name: string;
  upperRight: RoiCorner;
  lowerLeft: RoiCorner;
};

export type PlayerCountConfig = {
  enabled: boolean;
  formulaMode: "16x9" | "adaptive";
  autoCalibrateFromCenter: boolean;
  baseScreenWidth: number;
  baseScreenHeight: number;
  baseGameWidth: number;
  baseGameHeight: number;
  gameWidth: number;
  gameHeight: number;
  screenWidth: number;
  screenHeight: number;
  outputDir: string;
  templatesDir: string;
  rois: [PlayerCountRoiConfig, PlayerCountRoiConfig];
};

export const PLAYER_COUNT_REFERENCE_SCREEN_WIDTH = 1920;
export const PLAYER_COUNT_REFERENCE_SCREEN_HEIGHT = 1080;
export const PLAYER_COUNT_REFERENCE_ROI_WIDTH = 10;
export const PLAYER_COUNT_REFERENCE_ROI_HEIGHT = 13;
export const PLAYER_COUNT_REFERENCE_16X9_RIGHT_MIRROR_X_OFFSET = 8;
export const PLAYER_COUNT_REFERENCE_ADAPTIVE_RIGHT_MIRROR_X_OFFSET = 11;
export const PLAYER_COUNT_REFERENCE_16X9_GAME_WIDTH = 1920;
export const PLAYER_COUNT_REFERENCE_16X9_GAME_HEIGHT = 1080;
export const PLAYER_COUNT_REFERENCE_ADAPTIVE_GAME_WIDTH = 1440;
export const PLAYER_COUNT_REFERENCE_ADAPTIVE_GAME_HEIGHT = 1080;
const PLAYER_COUNT_16X9_GAME_PRESETS = new Set(["1280x720", "1600x900", "1920x1080"]);
const PLAYER_COUNT_ADAPTIVE_GAME_PRESETS = new Set(["1280x960", "1400x1050", "1440x1080", "1600x1200"]);

function createFixedSizeRoi(name: string, upperRightX: number, upperRightY: number): PlayerCountRoiConfig {
  return {
    name,
    upperRight: { x: upperRightX, y: upperRightY },
    lowerLeft: {
      x: upperRightX + PLAYER_COUNT_REFERENCE_ROI_WIDTH,
      y: upperRightY + PLAYER_COUNT_REFERENCE_ROI_HEIGHT
    }
  };
}

export const PLAYER_COUNT_REFERENCE_16X9_ROIS_1920X1080: [
  PlayerCountRoiConfig,
  PlayerCountRoiConfig
] = [
  createFixedSizeRoi("slot-1", 938, 76),
  createFixedSizeRoi("slot-2", 973, 76)
];
export const PLAYER_COUNT_REFERENCE_ADAPTIVE_ROIS_1920X1080_1440X1080: [
  PlayerCountRoiConfig,
  PlayerCountRoiConfig
] = [
  createFixedSizeRoi("slot-1", 932, 76),
  createFixedSizeRoi("slot-2", 973, 76)
];

export type PlayerCountPresetGroup = "16x9" | "adaptive";

type PlayerCountPresetConfig = {
  group: PlayerCountPresetGroup;
  leftAnchorDeltaX?: number;
  leftAnchorDeltaY?: number;
  rightMirrorOffset?: number;
};

const PLAYER_COUNT_PRESET_CONFIGS: Record<string, PlayerCountPresetConfig> = {
  "1280x720": { group: "16x9" },
  "1600x900": { group: "16x9" },
  "1920x1080": { group: "16x9", rightMirrorOffset: PLAYER_COUNT_REFERENCE_16X9_RIGHT_MIRROR_X_OFFSET },
  "1280x960": { group: "adaptive", leftAnchorDeltaX: -1, rightMirrorOffset: PLAYER_COUNT_REFERENCE_ADAPTIVE_RIGHT_MIRROR_X_OFFSET },
  "1400x1050": { group: "adaptive", leftAnchorDeltaX: -1, rightMirrorOffset: PLAYER_COUNT_REFERENCE_ADAPTIVE_RIGHT_MIRROR_X_OFFSET },
  "1440x1080": { group: "adaptive", rightMirrorOffset: PLAYER_COUNT_REFERENCE_ADAPTIVE_RIGHT_MIRROR_X_OFFSET },
  "1600x1200": { group: "adaptive", leftAnchorDeltaX: -1, rightMirrorOffset: PLAYER_COUNT_REFERENCE_ADAPTIVE_RIGHT_MIRROR_X_OFFSET }
};

function readFormulaModeFallback(): "16x9" | "adaptive" {
  const value = (process.env.PLAYER_COUNT_FORMULA_MODE ?? "16x9").trim().toLowerCase();
  return value === "adaptive" ? "adaptive" : "16x9";
}

export function resolvePlayerCountPresetGroup(gameWidth: number, gameHeight: number): PlayerCountPresetGroup {
  const gamePresetKey = `${gameWidth}x${gameHeight}`;
  const presetConfig = PLAYER_COUNT_PRESET_CONFIGS[gamePresetKey];
  if (presetConfig) {
    return presetConfig.group;
  }
  if (PLAYER_COUNT_ADAPTIVE_GAME_PRESETS.has(gamePresetKey)) {
    return "adaptive";
  }
  if (PLAYER_COUNT_16X9_GAME_PRESETS.has(gamePresetKey)) {
    return "16x9";
  }
  return readFormulaModeFallback();
}

function resolvePlayerCountPresetConfig(gameWidth: number, gameHeight: number): PlayerCountPresetConfig {
  const gamePresetKey = `${gameWidth}x${gameHeight}`;
  return PLAYER_COUNT_PRESET_CONFIGS[gamePresetKey] ?? { group: resolvePlayerCountPresetGroup(gameWidth, gameHeight) };
}

function getReferencePresetForGroup(formulaMode: PlayerCountPresetGroup): {
  baseGameWidth: number;
  baseGameHeight: number;
  baseLeftRoi: PlayerCountRoiConfig;
} {
  if (formulaMode === "adaptive") {
    return {
      baseGameWidth: PLAYER_COUNT_REFERENCE_ADAPTIVE_GAME_WIDTH,
      baseGameHeight: PLAYER_COUNT_REFERENCE_ADAPTIVE_GAME_HEIGHT,
      baseLeftRoi: PLAYER_COUNT_REFERENCE_ADAPTIVE_ROIS_1920X1080_1440X1080[0]
    };
  }

  return {
    baseGameWidth: PLAYER_COUNT_REFERENCE_16X9_GAME_WIDTH,
    baseGameHeight: PLAYER_COUNT_REFERENCE_16X9_GAME_HEIGHT,
    baseLeftRoi: PLAYER_COUNT_REFERENCE_16X9_ROIS_1920X1080[0]
  };
}

function readFixedSizeRoi(params: {
  name: string;
  upperRightXEnvName: string;
  upperRightYEnvName: string;
  fallback: PlayerCountRoiConfig;
}): PlayerCountRoiConfig {
  const upperRightX = readNumber(params.upperRightXEnvName, params.fallback.upperRight.x);
  const upperRightY = readNumber(params.upperRightYEnvName, params.fallback.upperRight.y);
  return createFixedSizeRoi(params.name, upperRightX, upperRightY);
}

function mirrorRoiHorizontally(
  roi: PlayerCountRoiConfig,
  screenWidth: number,
  mirroredName: string,
  xOffset: number
): PlayerCountRoiConfig {
  const mirroredUpperRightX = screenWidth - roi.lowerLeft.x + xOffset;
  return {
    name: mirroredName,
    upperRight: {
      x: mirroredUpperRightX,
      y: roi.upperRight.y
    },
    lowerLeft: {
      x: mirroredUpperRightX + PLAYER_COUNT_REFERENCE_ROI_WIDTH,
      y: roi.lowerLeft.y
    }
  };
}

function shiftRoiX(roi: PlayerCountRoiConfig, deltaX: number): PlayerCountRoiConfig {
  return {
    name: roi.name,
    upperRight: {
      x: roi.upperRight.x + deltaX,
      y: roi.upperRight.y
    },
    lowerLeft: {
      x: roi.lowerLeft.x + deltaX,
      y: roi.lowerLeft.y
    }
  };
}

export type RelayConfig = {
  httpPort: number;
  backendUrl: string;
  sharedToken: string;
  roomId: string;
  playerId: string;
  logRawGsi: boolean;
  roundLiveDurationSec: number;
  bombTimerSec: number;
  gsiIntegration: {
    enabled: boolean;
    configPath: string;
    uri: string;
  };
  playerCount: PlayerCountConfig;
};

function getDefaultGsiIntegrationConfigPath(): string {
  const programFilesX86 = process.env["ProgramFiles(x86)"]?.trim();
  const steamRoot = programFilesX86 && programFilesX86.length > 0 ? programFilesX86 : "C:\\Program Files (x86)";
  return path.join(
    steamRoot,
    "Steam",
    "steamapps",
    "common",
    "Counter-Strike Global Offensive",
    "game",
    "csgo",
    "cfg",
    "gamestate_integration_sbe.cfg"
  );
}

export function loadRelayConfig(): RelayConfig {
  const screenWidth = readNumber("PLAYER_COUNT_SCREEN_WIDTH", PLAYER_COUNT_REFERENCE_SCREEN_WIDTH);
  const screenHeight = readNumber("PLAYER_COUNT_SCREEN_HEIGHT", PLAYER_COUNT_REFERENCE_SCREEN_HEIGHT);
  const fallbackGameWidth = readNumber("PLAYER_COUNT_GAME_WIDTH", PLAYER_COUNT_REFERENCE_ADAPTIVE_GAME_WIDTH);
  const fallbackGameHeight = readNumber("PLAYER_COUNT_GAME_HEIGHT", PLAYER_COUNT_REFERENCE_ADAPTIVE_GAME_HEIGHT);
  const presetConfig = resolvePlayerCountPresetConfig(fallbackGameWidth, fallbackGameHeight);
  const formulaMode = presetConfig.group;
  const referencePreset = getReferencePresetForGroup(formulaMode);
  const baseScreenWidth = readNumber("PLAYER_COUNT_BASE_SCREEN_WIDTH", PLAYER_COUNT_REFERENCE_SCREEN_WIDTH);
  const baseScreenHeight = readNumber("PLAYER_COUNT_BASE_SCREEN_HEIGHT", PLAYER_COUNT_REFERENCE_SCREEN_HEIGHT);
  const baseGameWidth = readNumber("PLAYER_COUNT_BASE_GAME_WIDTH", referencePreset.baseGameWidth);
  const baseGameHeight = readNumber("PLAYER_COUNT_BASE_GAME_HEIGHT", referencePreset.baseGameHeight);
  const gameWidth = fallbackGameWidth;
  const gameHeight = fallbackGameHeight;
  const baseLeftRoi = readFixedSizeRoi({
    name: referencePreset.baseLeftRoi.name,
    upperRightXEnvName: "PLAYER_COUNT_ROI1_UR_X",
    upperRightYEnvName: "PLAYER_COUNT_ROI1_UR_Y",
    fallback: referencePreset.baseLeftRoi
  });
  const autoCalibrateFromCenter = readBoolean("PLAYER_COUNT_AUTO_CALIBRATE", true);
  const leftRoi =
    formulaMode === "16x9"
      ? scaleRoisFor16By9({
          rois: [baseLeftRoi, baseLeftRoi],
          targetWidth: screenWidth,
          targetHeight: screenHeight
        })[0]
      : (() => {
          const referenceScreenWidth = autoCalibrateFromCenter ? baseScreenWidth : screenWidth;
          const referenceScreenHeight = autoCalibrateFromCenter ? baseScreenHeight : screenHeight;
          const referenceGameWidth = autoCalibrateFromCenter ? baseGameWidth : gameWidth;
          const referenceGameHeight = autoCalibrateFromCenter ? baseGameHeight : gameHeight;
          return projectRoiFromReference({
            roi: baseLeftRoi,
            referenceScreenWidth,
            referenceScreenHeight,
            referenceGameWidth,
            referenceGameHeight,
            targetGameWidth: gameWidth,
            targetGameHeight: gameHeight,
            targetScreenWidth: screenWidth,
            targetScreenHeight: screenHeight
          });
        })();
  const adjustedLeftRoi =
    presetConfig.leftAnchorDeltaX || presetConfig.leftAnchorDeltaY
      ? {
          ...shiftRoiX(leftRoi, presetConfig.leftAnchorDeltaX ?? 0),
          upperRight: {
            x: leftRoi.upperRight.x + (presetConfig.leftAnchorDeltaX ?? 0),
            y: leftRoi.upperRight.y + (presetConfig.leftAnchorDeltaY ?? 0)
          },
          lowerLeft: {
            x: leftRoi.lowerLeft.x + (presetConfig.leftAnchorDeltaX ?? 0),
            y: leftRoi.lowerLeft.y + (presetConfig.leftAnchorDeltaY ?? 0)
          }
        }
      : leftRoi;
  const rightMirrorOffset = presetConfig.rightMirrorOffset ??
    (formulaMode === "16x9"
      ? PLAYER_COUNT_REFERENCE_16X9_RIGHT_MIRROR_X_OFFSET
      : PLAYER_COUNT_REFERENCE_ADAPTIVE_RIGHT_MIRROR_X_OFFSET);
  const rois: [PlayerCountRoiConfig, PlayerCountRoiConfig] = [
    {
      ...adjustedLeftRoi,
      name: "slot-1"
    },
    mirrorRoiHorizontally(adjustedLeftRoi, screenWidth, "slot-2", rightMirrorOffset)
  ];

  return {
    httpPort: Number(process.env.RELAY_HTTP_PORT ?? 3001),
    backendUrl: readRequired("RELAY_BACKEND_URL", "https://sbe.gg"),
    sharedToken: readRequired("RELAY_SHARED_TOKEN", "dev-relay-shared-token"),
    roomId: readRequired("RELAY_ROOM_ID", "dev-room"),
    playerId: readRequired("RELAY_PLAYER_ID", "dev-player"),
    logRawGsi: readBoolean("RELAY_LOG_RAW_GSI", false),
    roundLiveDurationSec: Number(process.env.RELAY_ROUND_LIVE_DURATION_SEC ?? 115),
    bombTimerSec: Number(process.env.RELAY_BOMB_TIMER_SEC ?? 40),
    gsiIntegration: {
      enabled: readBoolean("RELAY_GSI_CONFIG_ENABLED", true),
      configPath: readRequired("RELAY_GSI_CONFIG_PATH", getDefaultGsiIntegrationConfigPath()),
      uri: readRequired(
        "RELAY_GSI_URI",
        `http://127.0.0.1:${Number(process.env.RELAY_HTTP_PORT ?? 3001)}/gsi`
      )
    },
    playerCount: {
      enabled: readBoolean("PLAYER_COUNT_ENABLED", true),
      formulaMode,
      autoCalibrateFromCenter,
      baseScreenWidth,
      baseScreenHeight,
      baseGameWidth,
      baseGameHeight,
      gameWidth,
      gameHeight,
      screenWidth,
      screenHeight,
      outputDir: readRequired("PLAYER_COUNT_OUTPUT_DIR", resolvePlayerCountOutputDir()),
      templatesDir: readRequired("PLAYER_COUNT_TEMPLATES_DIR", resolveBundledPlayerCountTemplatesDir()),
      rois
    }
  };
}
