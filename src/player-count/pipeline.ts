import fs from "node:fs";
import path from "node:path";

import type { PlayerCountConfig } from "../config";
import { captureAndPreprocessRoisDetailed } from "./capture";
import { clampRoiToScreen, toRoiRect, type RoiRect } from "./roi";
import { matchAgainstTemplatesBatchBase64 } from "./template-match";

export type PlayerCountPrediction = {
  roi: string;
  outputPath: string | null;
  processedOutputPath: string | null;
  predictedDigit: string | null;
  predictedScore: number;
  scores: Array<{ digit: string; score: number }>;
  rect: RoiRect;
};

export type PlayerCountPipelineTimings = {
  captureMs: number;
  preprocessMs: number;
  matchMs: number;
  fullLoopMs: number;
};

export type PlayerCountPipelineResult = {
  predictions: PlayerCountPrediction[];
  timings: PlayerCountPipelineTimings;
};

function resolveTemplatesDirForRoi(rootTemplatesDir: string, roiName: string): string {
  const slotDir = path.join(rootTemplatesDir, roiName);
  if (fs.existsSync(slotDir) && fs.statSync(slotDir).isDirectory()) {
    return slotDir;
  }
  return rootTemplatesDir;
}

export async function runPlayerCountPipelineDetailed(
  playerCount: PlayerCountConfig,
  options?: {
    threshold?: number;
    persistArtifacts?: boolean;
  }
): Promise<PlayerCountPipelineResult> {
  const fullLoopStartedAt = Date.now();
  const threshold = options?.threshold ?? 180;
  const persistArtifacts = options?.persistArtifacts ?? false;
  const outputDir = path.resolve(playerCount.outputDir);
  const templatesDir = path.resolve(playerCount.templatesDir);

  if (persistArtifacts) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const roiInputs = playerCount.rois.map((roiConfig) => {
    const rect = clampRoiToScreen(toRoiRect(roiConfig), playerCount.screenWidth, playerCount.screenHeight);
    return {
      roi: roiConfig.name,
      rect,
      outputPath: persistArtifacts ? path.join(outputDir, `${roiConfig.name}.png`) : undefined,
      processedOutputPath: persistArtifacts ? path.join(outputDir, `${roiConfig.name}.proc.png`) : undefined
    };
  });

  const captured = await captureAndPreprocessRoisDetailed({
    screenWidth: playerCount.screenWidth,
    screenHeight: playerCount.screenHeight,
    threshold,
    rois: roiInputs.map((item) => ({
      name: item.roi,
      roi: item.rect,
      outputPath: item.outputPath,
      processedOutputPath: item.processedOutputPath
    }))
  });

  const capturedByName = new Map(captured.items.map((item) => [item.name, item]));
  const matchStartedAt = Date.now();
  const matches = await matchAgainstTemplatesBatchBase64({
    inputs: roiInputs.map((roiInput) => ({
      samplePngBase64: capturedByName.get(roiInput.roi)?.processedPngBase64 ?? "",
      templatesDir: resolveTemplatesDirForRoi(templatesDir, roiInput.roi)
    }))
  });

  const predictions = roiInputs.map((roiInput, index) => {
    const result = capturedByName.get(roiInput.roi);
    const match = matches[index] ?? { digit: null, score: 0, scores: [] };
    if (!result) {
      return {
        roi: roiInput.roi,
        outputPath: roiInput.outputPath ?? null,
        processedOutputPath: roiInput.processedOutputPath ?? null,
        predictedDigit: null,
        predictedScore: 0,
        scores: [],
        rect: roiInput.rect
      };
    }

    return {
      roi: roiInput.roi,
      outputPath: result.outputPath ?? null,
      processedOutputPath: result.processedOutputPath ?? null,
      predictedDigit: match.digit,
      predictedScore: Number(match.score.toFixed(4)),
      scores: match.scores.map((item) => ({
        digit: item.digit,
        score: Number(item.score.toFixed(4))
      })),
      rect: roiInput.rect
    };
  });

  return {
    predictions,
    timings: {
      captureMs: captured.timings.captureMs,
      preprocessMs: captured.timings.preprocessMs,
      matchMs: Date.now() - matchStartedAt,
      fullLoopMs: Date.now() - fullLoopStartedAt
    }
  };
}

export async function runPlayerCountPipeline(
  playerCount: PlayerCountConfig,
  options?: {
    threshold?: number;
    persistArtifacts?: boolean;
  }
): Promise<PlayerCountPrediction[]> {
  const result = await runPlayerCountPipelineDetailed(playerCount, options);
  return result.predictions;
}
