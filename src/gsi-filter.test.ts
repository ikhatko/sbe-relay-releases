import { describe, expect, it } from "vitest";

import { createGsiFilterForPreRound } from "./gsi-filter";

describe("createGsiFilterForPreRound", () => {
  it("keeps only useful local fields and computes timer from live start", () => {
    let nowMs = 1_000_000;
    const filter = createGsiFilterForPreRound({
      liveRoundDurationSec: 115,
      bombTimerSec: 40,
      now: () => nowMs
    });

    const atLiveStart = filter({
      map: {
        name: "de_dust2",
        phase: "live",
        round: 5,
        team_ct: { score: 3 },
        team_t: { score: 2 }
      },
      round: {
        phase: "live"
      },
      player: {
        steamid: "s1",
        name: "reality",
        team: "CT",
        state: {
          health: 100,
          armor: 100,
          helmet: false,
          money: 3950,
          equip_value: 850,
          round_kills: 0,
          round_killhs: 0
        }
      },
      previously: {
        player: {
          state: {
            money: 3800,
            round_kills: 0,
            round_killhs: 0
          }
        }
      }
    });

    expect(atLiveStart).toEqual({
      round: {
        map: "de_dust2",
        map_phase: "live",
        phase: "live",
        bomb: null,
        number: 5,
        win_team: null,
        score_ct: 3,
        score_t: 2
      },
      round_timer: {
        source: "computed",
        mode: "round_live",
        duration_sec: 115,
        elapsed_sec: 0,
        remaining_sec: 115
      },
      local_player: {
        steamid: "s1",
        name: "reality",
        team: "CT",
        health: 100,
        armor: 100,
        helmet: false,
        money: 3950,
        equip_value: 850
      },
      local_events: {
        money_delta: 150
      }
    });

    nowMs += 7_000;
    const laterInRound = filter({
      map: {
        name: "de_dust2",
        phase: "live",
        round: 5,
        team_ct: { score: 3 },
        team_t: { score: 2 }
      },
      round: {
        phase: "live"
      },
      player: {
        steamid: "s1",
        name: "reality",
        team: "CT",
        state: {
          health: 90,
          armor: 95,
          helmet: false,
          money: 3950,
          equip_value: 850,
          round_kills: 1,
          round_killhs: 1
        }
      },
      previously: {
        player: {
          state: {
            money: 3950,
            round_kills: 0,
            round_killhs: 0
          }
        }
      }
    });

    expect(laterInRound).toEqual({
      round: {
        map: "de_dust2",
        map_phase: "live",
        phase: "live",
        bomb: null,
        number: 5,
        win_team: null,
        score_ct: 3,
        score_t: 2
      },
      round_timer: {
        source: "computed",
        mode: "round_live",
        duration_sec: 115,
        elapsed_sec: 7,
        remaining_sec: 108
      },
      local_player: {
        steamid: "s1",
        name: "reality",
        team: "CT",
        health: 90,
        armor: 95,
        helmet: false,
        money: 3950,
        equip_value: 850
      },
      local_events: {
        kill_delta: 1,
        hs_delta: 1
      }
    });
  });

  it("emits freeze snapshot once on entering freezetime", () => {
    const filter = createGsiFilterForPreRound({
      liveRoundDurationSec: 115,
      bombTimerSec: 40,
      now: () => 0
    });

    const first = filter({
      map: { name: "de_dust2", phase: "live", round: 10, team_ct: { score: 7 }, team_t: { score: 3 } },
      round: { phase: "freezetime" },
      player: {
        team: "CT",
        state: { money: 5200, equip_value: 1200 }
      }
    });

    expect(first).toEqual({
      round: {
        map: "de_dust2",
        map_phase: "live",
        phase: "freezetime",
        bomb: null,
        number: 10,
        win_team: null,
        score_ct: 7,
        score_t: 3
      },
      local_player: {
        steamid: null,
        name: null,
        team: "CT",
        health: null,
        armor: null,
        helmet: null,
        money: 5200,
        equip_value: 1200
      },
      freeze_snapshot: {
        map: "de_dust2",
        round_number: 10,
        team: "CT",
        money: 5200,
        equip_value: 1200
      }
    });

    const second = filter({
      map: { name: "de_dust2", phase: "live", round: 10, team_ct: { score: 7 }, team_t: { score: 3 } },
      round: { phase: "freezetime" },
      player: {
        team: "CT",
        state: { money: 5200, equip_value: 1200 }
      }
    });

    expect(second).toEqual({
      round: {
        map: "de_dust2",
        map_phase: "live",
        phase: "freezetime",
        bomb: null,
        number: 10,
        win_team: null,
        score_ct: 7,
        score_t: 3
      },
      local_player: {
        steamid: null,
        name: null,
        team: "CT",
        health: null,
        armor: null,
        helmet: null,
        money: 5200,
        equip_value: 1200
      }
    });
  });

  it("emits bomb planted event when round bomb changes to planted", () => {
    const filter = createGsiFilterForPreRound({
      liveRoundDurationSec: 115,
      bombTimerSec: 40,
      now: () => 0
    });

    const result = filter({
      map: { name: "de_dust2", phase: "live", round: 12, team_ct: { score: 6 }, team_t: { score: 5 } },
      round: { phase: "live", bomb: "planted" },
      player: {
        team: "CT",
        state: {
          money: 1000
        }
      },
      previously: {
        round: { bomb: "carried" },
        player: { state: { money: 1000 } }
      }
    });

    expect(result).toMatchObject({
      round: {
        bomb: "planted"
      },
      local_events: {
        bomb_event: "PLANTED"
      }
    });

    const repeated = filter({
      map: { name: "de_dust2", phase: "live", round: 12, team_ct: { score: 6 }, team_t: { score: 5 } },
      round: { phase: "live", bomb: "planted" },
      player: {
        team: "CT",
        state: {
          money: 1000
        }
      },
      previously: {
        round: { bomb: "carried" },
        player: { state: { money: 1000 } }
      }
    });
    expect(repeated).not.toHaveProperty("local_events.bomb_event");
  });

  it("switches timer to bomb timer after planted", () => {
    let nowMs = 10_000;
    const filter = createGsiFilterForPreRound({
      liveRoundDurationSec: 115,
      bombTimerSec: 40,
      now: () => nowMs
    });

    filter({
      map: { name: "de_dust2", phase: "live", round: 8, team_ct: { score: 4 }, team_t: { score: 3 } },
      round: { phase: "live", bomb: "carried" },
      player: { team: "T", state: { money: 2000 } },
      previously: { round: { bomb: "carried" }, player: { state: { money: 2000 } } }
    });

    nowMs += 5_000;
    const planted = filter({
      map: { name: "de_dust2", phase: "live", round: 8, team_ct: { score: 4 }, team_t: { score: 3 } },
      round: { phase: "live", bomb: "planted" },
      player: { team: "T", state: { money: 2000 } },
      previously: { round: { bomb: "carried" }, player: { state: { money: 2000 } } }
    });

    expect(planted).toMatchObject({
      round_timer: {
        source: "computed",
        mode: "bomb_planted",
        duration_sec: 38,
        elapsed_sec: 0,
        remaining_sec: 38
      },
      local_events: {
        bomb_event: "PLANTED"
      }
    });

    nowMs += 6_000;
    const ticking = filter({
      map: { name: "de_dust2", phase: "live", round: 8, team_ct: { score: 4 }, team_t: { score: 3 } },
      round: { phase: "live", bomb: "planted" },
      player: { team: "T", state: { money: 2000 } },
      previously: { round: { bomb: "planted" }, player: { state: { money: 2000 } } }
    });

    expect(ticking).toMatchObject({
      round_timer: {
        mode: "bomb_planted",
        elapsed_sec: 6,
        remaining_sec: 32
      }
    });
  });

  it("emits player_dead once when local HP drops to zero", () => {
    const filter = createGsiFilterForPreRound({
      liveRoundDurationSec: 115,
      bombTimerSec: 40,
      now: () => 0
    });

    const dead = filter({
      map: { name: "de_ancient", phase: "live", round: 6, team_ct: { score: 3 }, team_t: { score: 2 } },
      round: { phase: "live", bomb: "carried" },
      player: {
        steamid: "local",
        name: "local",
        team: "CT",
        state: {
          health: 0,
          armor: 0,
          helmet: false,
          money: 2200,
          equip_value: 1400
        }
      },
      previously: {
        player: {
          state: {
            health: 46,
            money: 2200
          }
        }
      }
    });

    expect(dead).toMatchObject({
      local_player: {
        health: 0
      },
      local_events: {
        player_dead: true
      }
    });

    const duplicate = filter({
      map: { name: "de_ancient", phase: "live", round: 6, team_ct: { score: 3 }, team_t: { score: 2 } },
      round: { phase: "live", bomb: "carried" },
      player: {
        steamid: "local",
        name: "local",
        team: "CT",
        state: {
          health: 0,
          armor: 0,
          helmet: false,
          money: 2200,
          equip_value: 1400
        }
      },
      previously: {
        player: {
          state: {
            health: 0,
            money: 2200
          }
        }
      }
    });

    expect(duplicate).not.toHaveProperty("local_events.player_dead");
  });

  it("emits player_dead when match_stats.deaths increases even if health transition is missing", () => {
    const filter = createGsiFilterForPreRound({
      liveRoundDurationSec: 115,
      bombTimerSec: 40,
      now: () => 0
    });

    const deadByDeathsDelta = filter({
      map: { name: "de_ancient", phase: "live", round: 7, team_ct: { score: 3 }, team_t: { score: 3 } },
      round: { phase: "live", bomb: "carried" },
      player: {
        steamid: "local",
        name: "local",
        team: "CT",
        state: {
          health: null,
          money: 2200
        },
        match_stats: {
          deaths: 5
        }
      },
      previously: {
        player: {
          state: {
            health: null,
            money: 2200
          },
          match_stats: {
            deaths: 4
          }
        }
      }
    });

    expect(deadByDeathsDelta).toMatchObject({
      local_events: {
        player_dead: true
      }
    });

    const noDuplicate = filter({
      map: { name: "de_ancient", phase: "live", round: 7, team_ct: { score: 3 }, team_t: { score: 3 } },
      round: { phase: "live", bomb: "carried" },
      player: {
        steamid: "local",
        name: "local",
        team: "CT",
        state: {
          health: null,
          money: 2200
        },
        match_stats: {
          deaths: 5
        }
      },
      previously: {
        player: {
          state: {
            health: null,
            money: 2200
          },
          match_stats: {
            deaths: 5
          }
        }
      }
    });

    expect(noDuplicate).not.toHaveProperty("local_events.player_dead");
  });

  it("emits stable round and bomb time mark events without duplicates", () => {
    let nowMs = 0;
    const filter = createGsiFilterForPreRound({
      liveRoundDurationSec: 115,
      bombTimerSec: 40,
      now: () => nowMs
    });

    filter({
      map: { name: "de_dust2", phase: "live", round: 13, team_ct: { score: 8 }, team_t: { score: 4 } },
      round: { phase: "live", bomb: "carried" },
      player: { team: "CT", state: { money: 1000 } },
      previously: { round: { phase: "freezetime", bomb: "carried" }, player: { state: { money: 1000 } } }
    });

    nowMs = 55_000; // remaining 60
    const round60 = filter({
      map: { name: "de_dust2", phase: "live", round: 13, team_ct: { score: 8 }, team_t: { score: 4 } },
      round: { phase: "live", bomb: "carried" },
      player: { team: "CT", state: { money: 1000 } },
      previously: { round: { bomb: "carried" }, player: { state: { money: 1000 } } }
    });
    expect(round60).toMatchObject({
      time_events: [{ type: "round_time_mark", seconds: 60 }]
    });

    const round60Duplicate = filter({
      map: { name: "de_dust2", phase: "live", round: 13, team_ct: { score: 8 }, team_t: { score: 4 } },
      round: { phase: "live", bomb: "carried" },
      player: { team: "CT", state: { money: 1000 } },
      previously: { round: { bomb: "carried" }, player: { state: { money: 1000 } } }
    });
    expect(round60Duplicate).not.toHaveProperty("time_events");

    nowMs = 75_000; // remaining 40, crosses 45
    const round45 = filter({
      map: { name: "de_dust2", phase: "live", round: 13, team_ct: { score: 8 }, team_t: { score: 4 } },
      round: { phase: "live", bomb: "carried" },
      player: { team: "CT", state: { money: 1000 } },
      previously: { round: { bomb: "carried" }, player: { state: { money: 1000 } } }
    });
    expect(round45).toMatchObject({
      time_events: [{ type: "round_time_mark", seconds: 45 }]
    });

    nowMs = 80_000;
    const planted = filter({
      map: { name: "de_dust2", phase: "live", round: 13, team_ct: { score: 8 }, team_t: { score: 4 } },
      round: { phase: "live", bomb: "planted" },
      player: { team: "CT", state: { money: 1000 } },
      previously: { round: { bomb: "carried" }, player: { state: { money: 1000 } } }
    });
    expect(planted).not.toHaveProperty("time_events");

    nowMs = 88_000; // bomb remaining 30 (effective bomb timer is 38)
    const bomb30 = filter({
      map: { name: "de_dust2", phase: "live", round: 13, team_ct: { score: 8 }, team_t: { score: 4 } },
      round: { phase: "live", bomb: "planted" },
      player: { team: "CT", state: { money: 1000 } },
      previously: { round: { bomb: "planted" }, player: { state: { money: 1000 } } }
    });
    expect(bomb30).toMatchObject({
      time_events: [{ type: "bomb_time_mark", seconds: 30 }]
    });

    nowMs = 98_000; // bomb remaining 20
    const bomb20 = filter({
      map: { name: "de_dust2", phase: "live", round: 13, team_ct: { score: 8 }, team_t: { score: 4 } },
      round: { phase: "live", bomb: "planted" },
      player: { team: "CT", state: { money: 1000 } },
      previously: { round: { bomb: "planted" }, player: { state: { money: 1000 } } }
    });
    expect(bomb20).toMatchObject({
      time_events: [{ type: "bomb_time_mark", seconds: 20 }]
    });
  });
});
