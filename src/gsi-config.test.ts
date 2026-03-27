import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildRelayGsiConfigContent, ensureRelayGsiConfig } from "./gsi-config";

describe("gsi-config", () => {
  it("builds the expected gamestate integration file", () => {
    expect(buildRelayGsiConfigContent("http://127.0.0.1:3001/gsi")).toBe(`"GameStateIntegration"
{
  "uri" "http://127.0.0.1:3001/gsi"
  "timeout" "5.0"
  "buffer"  "0.1"
  "throttle" "0.1"
  "heartbeat" "30.0"

  "data"
  {
    "provider"       "1"
    "map"            "1"
    "round"          "1"
    "player_id"      "1"
    "player_state"   "1"
    "player_weapons" "1"
    "allplayers_id"  "1"
    "allplayers_state" "1"
    "phase_countdowns" "1"
  }
}
`);
  });

  it("writes the config file and is idempotent on the next run", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sbe-gsi-config-"));
    const configPath = path.join(tempDir, "cfg", "gamestate_integration_sbe.cfg");

    const first = ensureRelayGsiConfig({
      enabled: true,
      configPath,
      uri: "http://127.0.0.1:3001/gsi"
    });
    const second = ensureRelayGsiConfig({
      enabled: true,
      configPath,
      uri: "http://127.0.0.1:3001/gsi"
    });

    expect(first.status).toBe("written");
    expect(second.status).toBe("unchanged");
    expect(fs.readFileSync(configPath, "utf8")).toBe(buildRelayGsiConfigContent("http://127.0.0.1:3001/gsi"));
  });

  it("does nothing when config generation is disabled", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sbe-gsi-config-"));
    const configPath = path.join(tempDir, "cfg", "gamestate_integration_sbe.cfg");

    const result = ensureRelayGsiConfig({
      enabled: false,
      configPath,
      uri: "http://127.0.0.1:3001/gsi"
    });

    expect(result.status).toBe("disabled");
    expect(fs.existsSync(configPath)).toBe(false);
  });
});
