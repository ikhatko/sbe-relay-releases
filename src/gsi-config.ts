import fs from "node:fs";
import path from "node:path";

export type RelayGsiIntegrationConfig = {
  enabled: boolean;
  configPath: string;
  uri: string;
};

export type EnsureRelayGsiConfigResult =
  | { status: "disabled"; path: string }
  | { status: "written"; path: string }
  | { status: "unchanged"; path: string };

export function buildRelayGsiConfigContent(uri: string): string {
  return `"GameStateIntegration"
{
  "uri" "${uri}"
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
`;
}

export function ensureRelayGsiConfig(config: RelayGsiIntegrationConfig): EnsureRelayGsiConfigResult {
  const configPath = path.resolve(config.configPath);
  if (!config.enabled) {
    return { status: "disabled", path: configPath };
  }

  const nextContent = buildRelayGsiConfigContent(config.uri);
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(configPath)) {
    const currentContent = fs.readFileSync(configPath, "utf8");
    if (currentContent === nextContent) {
      return { status: "unchanged", path: configPath };
    }
  }

  fs.writeFileSync(configPath, nextContent, "utf8");
  return { status: "written", path: configPath };
}
