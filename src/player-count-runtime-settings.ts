export type RuntimePlayerCountSettings = {
  screenWidth: number;
  screenHeight: number;
  gameWidth: number;
  gameHeight: number;
};

function isResolutionNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 200 && value <= 10000;
}

export function sanitizeRuntimePlayerCountSettings(payload: unknown): {
  settings: Partial<RuntimePlayerCountSettings>;
  droppedLegacyFormulaMode: boolean;
} {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { settings: {}, droppedLegacyFormulaMode: false };
  }

  const input = payload as Record<string, unknown>;
  const settings: Partial<RuntimePlayerCountSettings> = {};
  if (isResolutionNumber(input.screenWidth)) {
    settings.screenWidth = Math.round(input.screenWidth);
  }
  if (isResolutionNumber(input.screenHeight)) {
    settings.screenHeight = Math.round(input.screenHeight);
  }
  if (isResolutionNumber(input.gameWidth)) {
    settings.gameWidth = Math.round(input.gameWidth);
  }
  if (isResolutionNumber(input.gameHeight)) {
    settings.gameHeight = Math.round(input.gameHeight);
  }

  return {
    settings,
    droppedLegacyFormulaMode: input.formulaMode === "16x9" || input.formulaMode === "adaptive"
  };
}
