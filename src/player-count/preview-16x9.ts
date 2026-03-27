import { loadRelayConfig } from "../config";
import { toRoiRect } from "./roi";
import { scaleRoisFor16By9 } from "./calibration";

const resolutions = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1600, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 3840, height: 2160 }
];

function run(): void {
  const config = loadRelayConfig();
  const baseRois = config.playerCount.rois;

  for (const resolution of resolutions) {
    const rois = scaleRoisFor16By9({
      rois: baseRois,
      targetWidth: resolution.width,
      targetHeight: resolution.height
    });
    const slot1 = toRoiRect(rois[0]);
    const slot2 = toRoiRect(rois[1]);
    console.log(
      JSON.stringify({
        resolution: `${resolution.width}x${resolution.height}`,
        slot1,
        slot2
      })
    );
  }
}

run();
