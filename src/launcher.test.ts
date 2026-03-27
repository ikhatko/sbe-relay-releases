import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  isCounterStrikeRunningFromTasklist,
  parseTasklistCsvOutput,
  resolveLauncherLogPath,
  shouldStopRelayAfterMisses
} from "./launcher";

describe("relay launcher", () => {
  it("parses process names from tasklist csv output", () => {
    const parsed = parseTasklistCsvOutput(`"cs2.exe","1234","Console","1","120,000 K"
"explorer.exe","999","Console","1","80,000 K"
`);

    expect(parsed).toEqual(["cs2.exe", "explorer.exe"]);
  });

  it("detects cs2 or csgo process in tasklist output", () => {
    expect(
      isCounterStrikeRunningFromTasklist(`"explorer.exe","999","Console","1","80,000 K"
"cs2.exe","1234","Console","1","120,000 K"
`)
    ).toBe(true);

    expect(
      isCounterStrikeRunningFromTasklist(`"steam.exe","222","Console","1","90,000 K"
"discord.exe","333","Console","1","200,000 K"
`)
    ).toBe(false);
  });

  it("stores launcher logs under the relay logs directory", () => {
    expect(resolveLauncherLogPath("C:\\Users\\Test\\AppData\\Local\\SBE Relay")).toBe(
      path.join("C:\\Users\\Test\\AppData\\Local\\SBE Relay", "logs", "launcher.log")
    );
  });

  it("requires repeated misses before stopping relay", () => {
    expect(shouldStopRelayAfterMisses(1, 3)).toBe(false);
    expect(shouldStopRelayAfterMisses(2, 3)).toBe(false);
    expect(shouldStopRelayAfterMisses(3, 3)).toBe(true);
  });

  it("includes a single-instance launcher lock", () => {
    const source = fs.readFileSync(path.join(__dirname, "launcher.ts"), "utf8");

    expect(source).toContain("relay_launcher_already_running");
    expect(source).toContain("launcher.lock");
    expect(source).toContain("relay_launcher_stale_lock_removed");
  });

  it("logs unhandled launcher failures before exit", () => {
    const source = fs.readFileSync(path.join(__dirname, "launcher.ts"), "utf8");

    expect(source).toContain("relay_launcher_child_start_failed");
    expect(source).toContain("relay_launcher_tick_failed");
    expect(source).toContain("relay_launcher_uncaught_exception");
    expect(source).toContain("relay_launcher_unhandled_rejection");
  });

  it("does not crash on transient log file lock errors", () => {
    const source = fs.readFileSync(path.join(__dirname, "launcher.ts"), "utf8");

    expect(source).toContain('code === "EBUSY"');
    expect(source).toContain('code === "EPERM"');
    expect(source).toContain('code === "EACCES"');
  });
});
