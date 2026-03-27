function readObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

type GsiFilterOptions = {
  now?: () => number;
  liveRoundDurationSec: number;
  bombTimerSec: number;
};

const ROUND_TIME_MARKS_SEC = [60, 45, 30, 20, 10, 5] as const;
const BOMB_TIME_MARKS_SEC = [30, 20, 10, 5] as const;
const BOMB_UNDEFUSABLE_TAIL_SEC = 2;

export function createGsiFilterForPreRound(
  options: GsiFilterOptions
): (raw: Record<string, unknown>) => Record<string, unknown> {
  const now = options.now ?? (() => Date.now());
  let liveRoundStartedAtMs: number | null = null;
  let lastRoundKey: string | null = null;
  let lastRoundPhase: string | null = null;
  let freezeSnapshotRoundKey: string | null = null;
  let bombPlantedAtMs: number | null = null;
  let lastBombState: string | null = null;
  let emittedRoundTimeMarks = new Set<number>();
  let emittedBombTimeMarks = new Set<number>();

  return (raw: Record<string, unknown>): Record<string, unknown> => {
    const map = readObject(raw.map);
    const round = readObject(raw.round);
    const player = readObject(raw.player);
    const playerState = readObject(player?.state);
    const playerMatchStats = readObject(player?.match_stats);
    const previously = readObject(raw.previously);
    const prevPlayer = readObject(previously?.player);
    const prevPlayerState = readObject(prevPlayer?.state);
    const prevPlayerMatchStats = readObject(prevPlayer?.match_stats);

    const mapName = readString(map?.name);
    const mapPhase = readString(map?.phase);
    const roundNumber = readNumber(map?.round);
    const roundPhase = readString(round?.phase);
    const bombState = readString(round?.bomb);
    const roundWinTeam = readString(round?.win_team);
    const teamCt = readObject(map?.team_ct);
    const teamT = readObject(map?.team_t);
    const scoreCt = readNumber(teamCt?.score);
    const scoreT = readNumber(teamT?.score);

    const playerTeam = readString(player?.team);
    const playerSteamId = readString(player?.steamid);
    const playerName = readString(player?.name);
    const health = readNumber(playerState?.health);
    const armor = readNumber(playerState?.armor);
    const money = readNumber(playerState?.money);
    const equipValue = readNumber(playerState?.equip_value);
    const helmet = readBoolean(playerState?.helmet);
    const roundKills = readNumber(playerState?.round_kills);
    const roundKillHs = readNumber(playerState?.round_killhs);
    const deaths = readNumber(playerMatchStats?.deaths);

    const prevRoundKills = readNumber(prevPlayerState?.round_kills);
    const prevRoundKillHs = readNumber(prevPlayerState?.round_killhs);
    const prevMoney = readNumber(prevPlayerState?.money);
    const prevHealth = readNumber(prevPlayerState?.health);
    const prevDeaths = readNumber(prevPlayerMatchStats?.deaths);

    const roundKillDelta =
      roundKills !== null && prevRoundKills !== null ? Math.max(0, roundKills - prevRoundKills) : null;
    const roundHsDelta =
      roundKillHs !== null && prevRoundKillHs !== null
        ? Math.max(0, roundKillHs - prevRoundKillHs)
        : null;
    const moneyDelta = money !== null && prevMoney !== null ? money - prevMoney : null;
    const playerDeadByHealth =
      roundPhase === "live" && health !== null && prevHealth !== null && prevHealth > 0 && health === 0;
    const playerDeadByDeathsDelta =
      roundPhase === "live" && deaths !== null && prevDeaths !== null && deaths > prevDeaths;
    const playerDeadEvent = playerDeadByHealth || playerDeadByDeathsDelta;

    const roundKey = mapName !== null && roundNumber !== null ? `${mapName}:${roundNumber}` : null;
    const previousPhase = lastRoundPhase;
    if (roundKey !== null && roundKey !== lastRoundKey) {
      liveRoundStartedAtMs = null;
      bombPlantedAtMs = null;
      lastBombState = null;
      emittedRoundTimeMarks = new Set<number>();
      emittedBombTimeMarks = new Set<number>();
      lastRoundKey = roundKey;
    }
    if (roundPhase === "live" && lastRoundPhase !== "live") {
      liveRoundStartedAtMs = now();
    }
    const bombJustPlanted = bombState === "planted" && lastBombState !== "planted";
    if (bombJustPlanted && bombPlantedAtMs === null) {
      bombPlantedAtMs = now();
      emittedBombTimeMarks = new Set<number>();
    }
    if (bombState !== "planted") {
      bombPlantedAtMs = null;
    }
    lastRoundPhase = roundPhase;

    let timer: Record<string, unknown> | null = null;
    let timerMode: "round_live" | "bomb_planted" | null = null;
    let timerRemainingSec: number | null = null;
    if (bombPlantedAtMs !== null) {
      const effectiveBombTimerSec = Math.max(0, options.bombTimerSec - BOMB_UNDEFUSABLE_TAIL_SEC);
      const elapsedSec = Math.max(0, Math.floor((now() - bombPlantedAtMs) / 1000));
      const remainingSec = Math.max(0, effectiveBombTimerSec - elapsedSec);
      timerMode = "bomb_planted";
      timerRemainingSec = remainingSec;
      timer = {
        source: "computed",
        mode: "bomb_planted",
        duration_sec: effectiveBombTimerSec,
        elapsed_sec: elapsedSec,
        remaining_sec: remainingSec
      };
    } else if (liveRoundStartedAtMs !== null) {
      const elapsedSec = Math.max(0, Math.floor((now() - liveRoundStartedAtMs) / 1000));
      const remainingSec = Math.max(0, options.liveRoundDurationSec - elapsedSec);
      timerMode = "round_live";
      timerRemainingSec = remainingSec;
      timer = {
        source: "computed",
        mode: "round_live",
        duration_sec: options.liveRoundDurationSec,
        elapsed_sec: elapsedSec,
        remaining_sec: remainingSec
      };
    }

    const filtered: Record<string, unknown> = {};
    filtered.round = {
      map: mapName,
      map_phase: mapPhase,
      phase: roundPhase,
      bomb: bombState,
      number: roundNumber,
      win_team: roundWinTeam,
      score_ct: scoreCt,
      score_t: scoreT
    };

    if (timer) {
      filtered.round_timer = timer;
    }

    filtered.local_player = {
      steamid: playerSteamId,
      name: playerName,
      team: playerTeam,
      health,
      armor,
      helmet,
      money,
      equip_value: equipValue
    };

    const localEvents: Record<string, unknown> = {};
    if (roundPhase === "live" && roundKillDelta !== null && roundKillDelta > 0) {
      localEvents.kill_delta = roundKillDelta;
      if (roundHsDelta !== null && roundHsDelta > 0) {
        localEvents.hs_delta = roundHsDelta;
      }
    }
    if (roundPhase === "live" && moneyDelta !== null && moneyDelta !== 0) {
      localEvents.money_delta = moneyDelta;
    }
    if (playerDeadEvent) {
      localEvents.player_dead = true;
    }
    if (bombJustPlanted) {
      localEvents.bomb_event = "PLANTED";
    }
    if (Object.keys(localEvents).length > 0) {
      filtered.local_events = localEvents;
    }

    if (timerMode !== null && timerRemainingSec !== null) {
      const marks = timerMode === "bomb_planted" ? BOMB_TIME_MARKS_SEC : ROUND_TIME_MARKS_SEC;
      const emitted = timerMode === "bomb_planted" ? emittedBombTimeMarks : emittedRoundTimeMarks;
      const timeEvents: Array<{ type: "round_time_mark" | "bomb_time_mark"; seconds: number }> = [];
      for (const mark of marks) {
        if (timerRemainingSec <= mark && !emitted.has(mark)) {
          emitted.add(mark);
          timeEvents.push({
            type: timerMode === "bomb_planted" ? "bomb_time_mark" : "round_time_mark",
            seconds: mark
          });
        }
      }
      if (timeEvents.length > 0) {
        filtered.time_events = timeEvents;
      }
    }

    const enteredFreezetime = roundPhase === "freezetime" && previousPhase !== "freezetime";
    if (enteredFreezetime && roundKey !== null && freezeSnapshotRoundKey !== roundKey) {
      filtered.freeze_snapshot = {
        map: mapName,
        round_number: roundNumber,
        team: playerTeam,
        money,
        equip_value: equipValue
      };
      freezeSnapshotRoundKey = roundKey;
    }

    lastBombState = bombState;

    return filtered;
  };
}
