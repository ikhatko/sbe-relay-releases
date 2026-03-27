import { afterEach, describe, expect, it, vi } from "vitest";

import {
  loadRelayConfig,
  PLAYER_COUNT_REFERENCE_ADAPTIVE_GAME_HEIGHT,
  PLAYER_COUNT_REFERENCE_ADAPTIVE_GAME_WIDTH,
  PLAYER_COUNT_REFERENCE_SCREEN_HEIGHT,
  PLAYER_COUNT_REFERENCE_SCREEN_WIDTH
} from "./config";

describe("loadRelayConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("loads adaptive roi config for the default 1920x1080 screen / 1440x1080 game preset", () => {
    const config = loadRelayConfig();

    expect(config.playerCount.screenWidth).toBe(PLAYER_COUNT_REFERENCE_SCREEN_WIDTH);
    expect(config.playerCount.screenHeight).toBe(PLAYER_COUNT_REFERENCE_SCREEN_HEIGHT);
    expect(config.playerCount.gameWidth).toBe(PLAYER_COUNT_REFERENCE_ADAPTIVE_GAME_WIDTH);
    expect(config.playerCount.gameHeight).toBe(PLAYER_COUNT_REFERENCE_ADAPTIVE_GAME_HEIGHT);
    expect(config.playerCount.formulaMode).toBe("adaptive");
    expect(config.playerCount.autoCalibrateFromCenter).toBe(true);
    expect(config.playerCount.rois).toEqual([
      {
        name: "slot-1",
        upperRight: { x: 978, y: 76 },
        lowerLeft: { x: 988, y: 89 }
      },
      {
        name: "slot-2",
        upperRight: { x: 932, y: 76 },
        lowerLeft: { x: 942, y: 89 }
      }
    ]);
  });

  it("auto-calibrates player-count roi for 1440x1080", () => {
    vi.stubEnv("PLAYER_COUNT_SCREEN_WIDTH", "1440");
    vi.stubEnv("PLAYER_COUNT_SCREEN_HEIGHT", "1080");

    const config = loadRelayConfig();

    expect(config.playerCount.rois[0]).toEqual({
      name: "slot-1",
      upperRight: { x: 733, y: 76 },
      lowerLeft: { x: 741, y: 89 }
    });
    expect(config.playerCount.rois[1]).toEqual({
      name: "slot-2",
      upperRight: { x: 699, y: 76 },
      lowerLeft: { x: 707, y: 89 }
    });
  });

  it("maps 4:3 stretched game coordinates to 16:9 capture space", () => {
    vi.stubEnv("PLAYER_COUNT_SCREEN_WIDTH", "1920");
    vi.stubEnv("PLAYER_COUNT_SCREEN_HEIGHT", "1080");
    vi.stubEnv("PLAYER_COUNT_GAME_WIDTH", "1440");
    vi.stubEnv("PLAYER_COUNT_GAME_HEIGHT", "1080");

    const config = loadRelayConfig();

    expect(config.playerCount.formulaMode).toBe("adaptive");
    expect(config.playerCount.rois[0]).toEqual({
      name: "slot-1",
      upperRight: { x: 978, y: 76 },
      lowerLeft: { x: 988, y: 89 }
    });
    expect(config.playerCount.rois[1]).toEqual({
      name: "slot-2",
      upperRight: { x: 932, y: 76 },
      lowerLeft: { x: 942, y: 89 }
    });
  });

  it("projects 4:3 stretched presets from the stretched reference defaults", () => {
    vi.stubEnv("PLAYER_COUNT_SCREEN_WIDTH", "1920");
    vi.stubEnv("PLAYER_COUNT_SCREEN_HEIGHT", "1080");
    vi.stubEnv("PLAYER_COUNT_GAME_WIDTH", "1280");
    vi.stubEnv("PLAYER_COUNT_GAME_HEIGHT", "960");

    const config = loadRelayConfig();

    expect(config.playerCount.rois[0]).toEqual({
      name: "slot-1",
      upperRight: { x: 978, y: 76 },
      lowerLeft: { x: 988, y: 89 }
    });
    expect(config.playerCount.rois[1]).toEqual({
      name: "slot-2",
      upperRight: { x: 932, y: 76 },
      lowerLeft: { x: 942, y: 89 }
    });
  });

  it("uses 16x9 formula for listed 16x9 game presets even if env says adaptive", () => {
    vi.stubEnv("PLAYER_COUNT_FORMULA_MODE", "adaptive");
    vi.stubEnv("PLAYER_COUNT_SCREEN_WIDTH", "1920");
    vi.stubEnv("PLAYER_COUNT_SCREEN_HEIGHT", "1080");
    vi.stubEnv("PLAYER_COUNT_GAME_WIDTH", "1920");
    vi.stubEnv("PLAYER_COUNT_GAME_HEIGHT", "1080");

    const config = loadRelayConfig();

    expect(config.playerCount.formulaMode).toBe("16x9");
    expect(config.playerCount.rois[0]).toEqual({
      name: "slot-1",
      upperRight: { x: 978, y: 76 },
      lowerLeft: { x: 988, y: 89 }
    });
    expect(config.playerCount.rois[1]).toEqual({
      name: "slot-2",
      upperRight: { x: 932, y: 76 },
      lowerLeft: { x: 942, y: 89 }
    });
  });

  it("projects other 16x9 presets from the 1920x1080 16x9 defaults", () => {
    vi.stubEnv("PLAYER_COUNT_SCREEN_WIDTH", "1600");
    vi.stubEnv("PLAYER_COUNT_SCREEN_HEIGHT", "900");
    vi.stubEnv("PLAYER_COUNT_GAME_WIDTH", "1600");
    vi.stubEnv("PLAYER_COUNT_GAME_HEIGHT", "900");

    const config = loadRelayConfig();

    expect(config.playerCount.formulaMode).toBe("16x9");
    expect(config.playerCount.rois).toEqual([
      {
        name: "slot-1",
        upperRight: { x: 815, y: 63 },
        lowerLeft: { x: 823, y: 74 }
      },
      {
        name: "slot-2",
        upperRight: { x: 777, y: 63 },
        lowerLeft: { x: 785, y: 74 }
      }
    ]);
  });

  it("projects other stretched presets from the 1920x1080 -> 1440x1080 defaults", () => {
    vi.stubEnv("PLAYER_COUNT_SCREEN_WIDTH", "1680");
    vi.stubEnv("PLAYER_COUNT_SCREEN_HEIGHT", "1050");
    vi.stubEnv("PLAYER_COUNT_GAME_WIDTH", "1400");
    vi.stubEnv("PLAYER_COUNT_GAME_HEIGHT", "1050");

    const config = loadRelayConfig();

    expect(config.playerCount.formulaMode).toBe("adaptive");
    expect(config.playerCount.rois).toEqual([
      {
        name: "slot-1",
        upperRight: { x: 856, y: 74 },
        lowerLeft: { x: 864, y: 87 }
      },
      {
        name: "slot-2",
        upperRight: { x: 816, y: 74 },
        lowerLeft: { x: 824, y: 87 }
      }
    ]);
  });

  it("loads default relay gsi integration config", () => {
    vi.stubEnv("LOCALAPPDATA", "C:\\Users\\Test\\AppData\\Local");
    const config = loadRelayConfig();

    expect(config.gsiIntegration.enabled).toBe(true);
    expect(config.gsiIntegration.uri).toBe("http://127.0.0.1:3001/gsi");
    expect(config.gsiIntegration.configPath).toContain("gamestate_integration_sbe.cfg");
    expect(config.gsiIntegration.configPath).toContain("Counter-Strike Global Offensive");
    expect(config.playerCount.outputDir).toBe(
      "C:\\Users\\Test\\AppData\\Local\\SBE Relay\\player-count\\tmp"
    );
  });

  it("allows overriding relay gsi integration path and uri", () => {
    vi.stubEnv("RELAY_HTTP_PORT", "3333");
    vi.stubEnv("RELAY_GSI_URI", "http://127.0.0.1:3333/gsi");
    vi.stubEnv("RELAY_GSI_CONFIG_PATH", "D:\\SBE\\gamestate_integration_sbe.cfg");
    vi.stubEnv("RELAY_GSI_CONFIG_ENABLED", "false");

    const config = loadRelayConfig();

    expect(config.gsiIntegration.enabled).toBe(false);
    expect(config.gsiIntegration.uri).toBe("http://127.0.0.1:3333/gsi");
    expect(config.gsiIntegration.configPath).toBe("D:\\SBE\\gamestate_integration_sbe.cfg");
  });

  it("falls back to default player-count paths when env values are empty strings", () => {
    vi.stubEnv("LOCALAPPDATA", "C:\\Users\\Test\\AppData\\Local");
    vi.stubEnv("PLAYER_COUNT_OUTPUT_DIR", "");
    vi.stubEnv("PLAYER_COUNT_TEMPLATES_DIR", "");

    const config = loadRelayConfig();

    expect(config.playerCount.outputDir).toBe(
      "C:\\Users\\Test\\AppData\\Local\\SBE Relay\\player-count\\tmp"
    );
    expect(config.playerCount.templatesDir.length).toBeGreaterThan(0);
  });
});
