import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getRelayDataDir,
  resolvePlayerCountOutputDir,
  resolvePlayerCountRuntimeSettingsPath
} from "./app-paths";

describe("app-paths", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses LOCALAPPDATA for relay writable data by default", () => {
    vi.stubEnv("LOCALAPPDATA", "C:\\Users\\Test\\AppData\\Local");

    expect(getRelayDataDir()).toBe(path.join("C:\\Users\\Test\\AppData\\Local", "SBE Relay"));
    expect(resolvePlayerCountOutputDir()).toBe(
      path.join("C:\\Users\\Test\\AppData\\Local", "SBE Relay", "player-count", "tmp")
    );
    expect(resolvePlayerCountRuntimeSettingsPath()).toBe(
      path.join("C:\\Users\\Test\\AppData\\Local", "SBE Relay", "player-count", "runtime-settings.json")
    );
  });

  it("allows overriding writable data root", () => {
    vi.stubEnv("SBE_DATA_DIR", "D:\\SBEData");

    expect(getRelayDataDir()).toBe("D:\\SBEData");
    expect(resolvePlayerCountOutputDir()).toBe(path.join("D:\\SBEData", "player-count", "tmp"));
  });

  it("falls back to homedir when LOCALAPPDATA is missing", () => {
    vi.stubEnv("LOCALAPPDATA", "");
    vi.spyOn(os, "homedir").mockReturnValue("C:\\Users\\Fallback");

    expect(getRelayDataDir()).toBe(path.join("C:\\Users\\Fallback", "AppData", "Local", "SBE Relay"));
  });
});
