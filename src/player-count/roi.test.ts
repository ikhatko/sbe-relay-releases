import { describe, expect, it } from "vitest";

import { clampRoiToScreen, toRoiRect } from "./roi";

describe("player-count roi", () => {
  it("normalizes configured corners to a rectangle", () => {
    const rect = toRoiRect({
      name: "slot-1",
      upperRight: { x: 938, y: 74 },
      lowerLeft: { x: 947, y: 87 }
    });

    expect(rect).toEqual({
      left: 938,
      top: 74,
      width: 10,
      height: 14
    });
  });

  it("clamps rectangle to screen bounds", () => {
    const clamped = clampRoiToScreen(
      {
        left: -10,
        top: -5,
        width: 20,
        height: 20
      },
      1920,
      1080
    );

    expect(clamped).toEqual({
      left: 0,
      top: 0,
      width: 10,
      height: 15
    });
  });
});
