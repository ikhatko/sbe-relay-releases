import type { PlayerCountConfig } from "../config";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureAndPreprocessRoisDetailedMock, matchAgainstTemplatesBatchBase64Mock } = vi.hoisted(() => ({
  captureAndPreprocessRoisDetailedMock: vi.fn(),
  matchAgainstTemplatesBatchBase64Mock: vi.fn()
}));

vi.mock("./capture", () => ({
  captureAndPreprocessRoisDetailed: captureAndPreprocessRoisDetailedMock
}));

vi.mock("./template-match", () => ({
  matchAgainstTemplatesBatchBase64: matchAgainstTemplatesBatchBase64Mock
}));

import { runPlayerCountPipeline, runPlayerCountPipelineDetailed } from "./pipeline";

function createPlayerCountConfig(): PlayerCountConfig {
  return {
    enabled: true,
    formulaMode: "16x9",
    autoCalibrateFromCenter: false,
    baseScreenWidth: 1920,
    baseScreenHeight: 1080,
    baseGameWidth: 1440,
    baseGameHeight: 1080,
    gameWidth: 1440,
    gameHeight: 1080,
    screenWidth: 1920,
    screenHeight: 1080,
    outputDir: "player-count/tmp",
    templatesDir: "player-count/templates",
    rois: [
      {
        name: "slot-1",
        upperRight: { x: 10, y: 10 },
        lowerLeft: { x: 20, y: 20 }
      },
      {
        name: "slot-2",
        upperRight: { x: 30, y: 30 },
        lowerLeft: { x: 40, y: 40 }
      }
    ]
  };
}

describe("player-count pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses in-memory processing by default (without artifact files)", async () => {
    captureAndPreprocessRoisDetailedMock.mockResolvedValue({
      items: [
        { name: "slot-1", processedPngBase64: "a", outputPath: null, processedOutputPath: null },
        { name: "slot-2", processedPngBase64: "b", outputPath: null, processedOutputPath: null }
      ],
      timings: { captureMs: 10, preprocessMs: 20 }
    });
    matchAgainstTemplatesBatchBase64Mock.mockResolvedValue([
      { digit: "5", score: 0.91, scores: [{ digit: "5", score: 0.91 }] },
      { digit: "4", score: 0.87, scores: [{ digit: "4", score: 0.87 }] }
    ]);

    const predictions = await runPlayerCountPipeline(createPlayerCountConfig(), { threshold: 180 });

    expect(predictions).toHaveLength(2);
    expect(predictions[0]?.outputPath).toBeNull();
    expect(predictions[0]?.processedOutputPath).toBeNull();
    expect(predictions[1]?.outputPath).toBeNull();
    expect(predictions[1]?.processedOutputPath).toBeNull();

    const captureCall = captureAndPreprocessRoisDetailedMock.mock.calls[0]?.[0] as
      | { rois: Array<{ outputPath?: string; processedOutputPath?: string }> }
      | undefined;
    expect(captureCall?.rois[0]?.outputPath).toBeUndefined();
    expect(captureCall?.rois[0]?.processedOutputPath).toBeUndefined();
    expect(matchAgainstTemplatesBatchBase64Mock).toHaveBeenCalledTimes(1);
  });

  it("keeps artifact file paths when persistArtifacts is enabled", async () => {
    captureAndPreprocessRoisDetailedMock.mockResolvedValue({
      items: [
        { name: "slot-1", processedPngBase64: "a", outputPath: "out-1", processedOutputPath: "proc-1" },
        { name: "slot-2", processedPngBase64: "b", outputPath: "out-2", processedOutputPath: "proc-2" }
      ],
      timings: { captureMs: 10, preprocessMs: 20 }
    });
    matchAgainstTemplatesBatchBase64Mock.mockResolvedValue([
      { digit: "3", score: 0.8, scores: [{ digit: "3", score: 0.8 }] },
      { digit: "3", score: 0.8, scores: [{ digit: "3", score: 0.8 }] }
    ]);

    const predictions = await runPlayerCountPipeline(createPlayerCountConfig(), {
      threshold: 180,
      persistArtifacts: true
    });

    expect(predictions[0]?.outputPath).toBe("out-1");
    expect(predictions[0]?.processedOutputPath).toBe("proc-1");
    expect(predictions[1]?.outputPath).toBe("out-2");
    expect(predictions[1]?.processedOutputPath).toBe("proc-2");
  });

  it("falls back to a shared templates folder when slot subdirectories are missing", async () => {
    captureAndPreprocessRoisDetailedMock.mockResolvedValue({
      items: [
        { name: "slot-1", processedPngBase64: "a", outputPath: null, processedOutputPath: null },
        { name: "slot-2", processedPngBase64: "b", outputPath: null, processedOutputPath: null }
      ],
      timings: { captureMs: 10, preprocessMs: 20 }
    });
    matchAgainstTemplatesBatchBase64Mock.mockResolvedValue([
      { digit: "5", score: 0.91, scores: [{ digit: "5", score: 0.91 }] },
      { digit: "4", score: 0.87, scores: [{ digit: "4", score: 0.87 }] }
    ]);

    const config = createPlayerCountConfig();
    config.templatesDir = "shared-templates";

    await runPlayerCountPipeline(config, { threshold: 180 });

    const matchCall = matchAgainstTemplatesBatchBase64Mock.mock.calls[0]?.[0] as
      | { inputs: Array<{ templatesDir: string }> }
      | undefined;
    expect(matchCall?.inputs[0]?.templatesDir.endsWith("shared-templates")).toBe(true);
    expect(matchCall?.inputs[1]?.templatesDir.endsWith("shared-templates")).toBe(true);
  });

  it("returns stage timings in the detailed pipeline result", async () => {
    captureAndPreprocessRoisDetailedMock.mockResolvedValue({
      items: [
        { name: "slot-1", processedPngBase64: "a", outputPath: null, processedOutputPath: null },
        { name: "slot-2", processedPngBase64: "b", outputPath: null, processedOutputPath: null }
      ],
      timings: { captureMs: 11, preprocessMs: 22 }
    });
    matchAgainstTemplatesBatchBase64Mock.mockResolvedValue([
      { digit: "5", score: 0.91, scores: [{ digit: "5", score: 0.91 }] },
      { digit: "4", score: 0.87, scores: [{ digit: "4", score: 0.87 }] }
    ]);

    const result = await runPlayerCountPipelineDetailed(createPlayerCountConfig(), { threshold: 180 });

    expect(result.predictions).toHaveLength(2);
    expect(result.timings.captureMs).toBe(11);
    expect(result.timings.preprocessMs).toBe(22);
    expect(result.timings.matchMs).toBeGreaterThanOrEqual(0);
    expect(result.timings.fullLoopMs).toBeGreaterThanOrEqual(result.timings.matchMs);
  });
});
