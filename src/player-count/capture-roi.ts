import { loadRelayConfig } from "../config";
import { runPlayerCountPipeline } from "./pipeline";

async function run(): Promise<void> {
  const relayConfig = loadRelayConfig();
  const playerCount = relayConfig.playerCount;

  if (!playerCount.enabled) {
    console.log(JSON.stringify({ event: "player_count_capture_skipped", reason: "disabled" }));
    return;
  }
  const predictions = await runPlayerCountPipeline(playerCount, { threshold: 180, persistArtifacts: true });
  for (const prediction of predictions) {
    console.log(
      JSON.stringify({
        event: "player_count_roi_captured",
        roi: prediction.roi,
        outputPath: prediction.outputPath,
        processedOutputPath: prediction.processedOutputPath,
        predictedDigit: prediction.predictedDigit,
        predictedScore: prediction.predictedScore,
        scores: prediction.scores,
        rect: prediction.rect
      })
    );
  }
}

run().catch((error) => {
  console.error(
    JSON.stringify({
      event: "player_count_capture_failed",
      error: error instanceof Error ? error.message : String(error)
    })
  );
  process.exit(1);
});
