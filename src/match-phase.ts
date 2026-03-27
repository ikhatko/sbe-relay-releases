export function getRoundPhase(gsi: unknown): string | null {
  if (!gsi || typeof gsi !== "object") {
    return null;
  }
  const round = (gsi as { round?: unknown }).round;
  if (!round || typeof round !== "object") {
    return null;
  }
  const phase = (round as { phase?: unknown }).phase;
  return typeof phase === "string" ? phase.toLowerCase() : null;
}

export function getMapPhase(gsi: unknown): string | null {
  if (!gsi || typeof gsi !== "object") {
    return null;
  }
  const data = gsi as { round?: unknown; map?: unknown };
  const round = data.round;
  if (round && typeof round === "object") {
    const mapPhase = (round as { map_phase?: unknown }).map_phase;
    if (typeof mapPhase === "string") {
      return mapPhase.toLowerCase();
    }
  }
  const map = data.map;
  if (map && typeof map === "object") {
    const phase = (map as { phase?: unknown }).phase;
    if (typeof phase === "string") {
      return phase.toLowerCase();
    }
  }
  return null;
}

export function isRoundEndPhase(phase: string): boolean {
  return phase === "over" || phase === "freezetime" || phase === "intermission";
}

export function isMatchEndPhase(phase: string): boolean {
  return phase === "gameover" || phase === "intermission";
}
