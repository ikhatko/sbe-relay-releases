import path from "node:path";

import { loadRelayConfig } from "../config";
import { saveTemplateFromSample } from "./template-match";

function run(): void {
  const config = loadRelayConfig();
  const digit = (process.env.PLAYER_COUNT_TEMPLATE_DIGIT ?? "").trim();
  const slot = (process.env.PLAYER_COUNT_TEMPLATE_SLOT ?? "slot-1").trim();
  if (!digit) {
    throw new Error("Set PLAYER_COUNT_TEMPLATE_DIGIT (for example: 1,2,3,4,5).");
  }

  const samplePath = path.resolve(config.playerCount.outputDir, `${slot}.proc.png`);
  const templatePath = saveTemplateFromSample({
    samplePath,
    templatesDir: path.resolve(config.playerCount.templatesDir),
    digit
  });

  console.log(
    JSON.stringify({
      event: "player_count_template_saved",
      digit,
      slot,
      samplePath,
      templatePath
    })
  );
}

run();
