import { loadRelayConfig } from "../config";
import { runPlayerCountPipeline } from "./pipeline";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(): Promise<void> {
  const relayConfig = loadRelayConfig();
  const playerCount = relayConfig.playerCount;
  const intervalMs = Number(process.env.PLAYER_COUNT_LIVE_INTERVAL_MS ?? 700);

  if (!playerCount.enabled) {
    console.log(JSON.stringify({ event: "player_count_live_skipped", reason: "disabled" }));
    return;
  }

  console.log(
    JSON.stringify({
      event: "player_count_live_started",
      intervalMs,
      formulaMode: playerCount.formulaMode,
      screen: `${playerCount.screenWidth}x${playerCount.screenHeight}`,
      game: `${playerCount.gameWidth}x${playerCount.gameHeight}`
    })
  );

  while (true) {
    const cycle = Date.now();
    const predictions = await runPlayerCountPipeline(playerCount, { threshold: 180 });
    for (const prediction of predictions) {
      console.log(
        JSON.stringify({
          event: "player_count_live_tick",
          cycle,
          roi: prediction.roi,
          predictedDigit: prediction.predictedDigit,
          predictedScore: prediction.predictedScore
        })
      );
    }
    await sleep(intervalMs);
  }
}

run().catch((error) => {
  console.error(
    JSON.stringify({
      event: "player_count_live_failed",
      error: error instanceof Error ? error.message : String(error)
    })
  );
  process.exit(1);
});
