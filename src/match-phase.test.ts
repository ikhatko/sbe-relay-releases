import { describe, expect, it } from "vitest";

import { getMapPhase, getRoundPhase, isMatchEndPhase, isRoundEndPhase } from "./match-phase";

describe("match-phase helpers", () => {
  it("reads round phase from normalized gsi", () => {
    expect(getRoundPhase({ round: { phase: "LIVE" } })).toBe("live");
    expect(getRoundPhase({ round: { phase: "over" } })).toBe("over");
    expect(getRoundPhase({})).toBeNull();
  });

  it("reads map phase from normalized and raw gsi shapes", () => {
    expect(getMapPhase({ round: { map_phase: "GAMEOVER" } })).toBe("gameover");
    expect(getMapPhase({ map: { phase: "intermission" } })).toBe("intermission");
    expect(getMapPhase({})).toBeNull();
  });

  it("detects round end phases", () => {
    expect(isRoundEndPhase("over")).toBe(true);
    expect(isRoundEndPhase("freezetime")).toBe(true);
    expect(isRoundEndPhase("intermission")).toBe(true);
    expect(isRoundEndPhase("live")).toBe(false);
  });

  it("detects match end phases", () => {
    expect(isMatchEndPhase("gameover")).toBe(true);
    expect(isMatchEndPhase("intermission")).toBe(true);
    expect(isMatchEndPhase("live")).toBe(false);
  });
});
