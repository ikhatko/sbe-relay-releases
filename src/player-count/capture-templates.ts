import fs from "node:fs";
import path from "node:path";

import { loadRelayConfig } from "../config";
import { captureAndPreprocessRois } from "./capture";
import { clampRoiToScreen, toRoiRect } from "./roi";

async function run(): Promise<void> {
  const relayConfig = loadRelayConfig();
  const playerCount = relayConfig.playerCount;

  if (!playerCount.enabled) {
    console.log(JSON.stringify({ event: "player_count_capture_templates_skipped", reason: "disabled" }));
    return;
  }

  const outputDir = path.resolve(playerCount.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const rois = playerCount.rois.map((roiConfig) => {
    const rect = clampRoiToScreen(toRoiRect(roiConfig), playerCount.screenWidth, playerCount.screenHeight);
    return {
      name: roiConfig.name,
      roi: rect,
      outputPath: path.join(outputDir, `${roiConfig.name}.png`),
      processedOutputPath: path.join(outputDir, `${roiConfig.name}.proc.png`)
    };
  });

  const captured = await captureAndPreprocessRois({
    screenWidth: playerCount.screenWidth,
    screenHeight: playerCount.screenHeight,
    threshold: 180,
    rois
  });

  console.log(
    JSON.stringify({
      event: "player_count_templates_captured",
      outputDir,
      files: captured.flatMap((item) => [item.outputPath, item.processedOutputPath]).filter(Boolean)
    })
  );
}

run().catch((error) => {
  console.error(
    JSON.stringify({
      event: "player_count_capture_templates_failed",
      error: error instanceof Error ? error.message : String(error)
    })
  );
  process.exit(1);
});
