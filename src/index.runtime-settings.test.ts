import { describe, expect, it } from "vitest";

import { sanitizeRuntimePlayerCountSettings } from "./player-count-runtime-settings";

describe("sanitizeRuntimePlayerCountSettings", () => {
  it("drops legacy formulaMode and keeps only runtime dimensions", () => {
    const result = sanitizeRuntimePlayerCountSettings({
      formulaMode: "adaptive",
      screenWidth: 1920,
      screenHeight: 1080,
      gameWidth: 1280,
      gameHeight: 960
    });

    expect(result).toEqual({
      settings: {
        screenWidth: 1920,
        screenHeight: 1080,
        gameWidth: 1280,
        gameHeight: 960
      },
      droppedLegacyFormulaMode: true
    });
  });

  it("ignores invalid runtime values", () => {
    const result = sanitizeRuntimePlayerCountSettings({
      formulaMode: "16x9",
      screenWidth: "1920",
      gameHeight: 100
    });

    expect(result).toEqual({
      settings: {},
      droppedLegacyFormulaMode: true
    });
  });
});
