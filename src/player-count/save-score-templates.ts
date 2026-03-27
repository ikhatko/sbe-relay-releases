import path from "node:path";

import { loadRelayConfig } from "../config";
import { captureAndPreprocessRois } from "./capture";
import { clampRoiToScreen, toRoiRect } from "./roi";
import { saveNextTemplateVariantFromSample } from "./template-match";

async function run(): Promise<void> {
  const config = loadRelayConfig();
  const digit = (process.env.PLAYER_COUNT_TEMPLATE_DIGIT ?? process.argv[2] ?? "").trim();
  if (!digit) {
    throw new Error("Set PLAYER_COUNT_TEMPLATE_DIGIT (for example: 0,1,2,3,4,5).");
  }

  const outputDir = path.resolve(config.playerCount.outputDir);
  const templatesDir = path.resolve(config.playerCount.templatesDir);
  const rois = config.playerCount.rois.map((roiConfig) => {
    const rect = clampRoiToScreen(
      toRoiRect(roiConfig),
      config.playerCount.screenWidth,
      config.playerCount.screenHeight
    );
    return {
      name: roiConfig.name,
      roi: rect,
      outputPath: path.join(outputDir, `${roiConfig.name}.png`),
      processedOutputPath: path.join(outputDir, `${roiConfig.name}.proc.png`)
    };
  });

  await captureAndPreprocessRois({
    screenWidth: config.playerCount.screenWidth,
    screenHeight: config.playerCount.screenHeight,
    threshold: 180,
    rois
  });

  const slot1TemplatePath = saveNextTemplateVariantFromSample({
    samplePath: path.join(outputDir, "slot-1.proc.png"),
    templatesDir,
    digit
  });
  const slot2TemplatePath = saveNextTemplateVariantFromSample({
    samplePath: path.join(outputDir, "slot-2.proc.png"),
    templatesDir,
    digit
  });

  console.log(
    JSON.stringify({
      event: "player_count_score_templates_saved",
      digit,
      outputDir,
      slot1TemplatePath,
      slot2TemplatePath
    })
  );
}

run().catch((error) => {
  console.error(
    JSON.stringify({
      event: "player_count_score_templates_save_failed",
      error: error instanceof Error ? error.message : String(error)
    })
  );
  process.exit(1);
});
