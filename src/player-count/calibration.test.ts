import { describe, expect, it } from "vitest";

import { calibrateRoisFromCenter, mapRoiBetweenSpaces } from "./calibration";

describe("player-count calibration", () => {
  it("maps 1920x1080 baseline rois to 1440x1080", () => {
    const rois = calibrateRoisFromCenter({
      rois: [
        {
          name: "slot-1",
          upperRight: { x: 938, y: 76 },
          lowerLeft: { x: 947, y: 89 }
        },
        {
          name: "slot-2",
          upperRight: { x: 980, y: 76 },
          lowerLeft: { x: 989, y: 89 }
        }
      ],
      baseScreenWidth: 1920,
      baseScreenHeight: 1080,
      targetScreenWidth: 1440,
      targetScreenHeight: 1080
    });

    expect(rois[0]).toEqual({
      name: "slot-1",
      upperRight: { x: 704, y: 76 },
      lowerLeft: { x: 710, y: 89 }
    });
    expect(rois[1]).toEqual({
      name: "slot-2",
      upperRight: { x: 735, y: 76 },
      lowerLeft: { x: 742, y: 89 }
    });
  });

  it("maps roi from 1440x1080 game space to 1920x1080 screen space", () => {
    const mapped = mapRoiBetweenSpaces(
      {
        name: "slot-1",
        upperRight: { x: 704, y: 76 },
        lowerLeft: { x: 710, y: 89 }
      },
      1440,
      1080,
      1920,
      1080
    );

    expect(mapped).toEqual({
      name: "slot-1",
      upperRight: { x: 939, y: 76 },
      lowerLeft: { x: 947, y: 89 }
    });
  });
});
