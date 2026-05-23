import { describe, it, expect } from "vitest";
import { simulate } from "./simulator";
import { simulatorFixture1 } from "./fixture/simulator.fixture";
import { projectSpSeries } from "./projection/projectSpSeries";
import { projectStaggerSeries } from "./projection/projectStaggerSeries";
import { projectUltimateSeries } from "./projection/projectUltimateSeries";
import { compileScenario } from "./compiler/compileScenario";
import { formatSimLogEntry } from "./formatSimLogEntry";
import { createDefaultStats } from "@/utils/coreStats";
import type { Action, ScenarioData, ScenarioTrack } from "./compiler/types";

type TrackPatch = Omit<Partial<ScenarioTrack>, "stats"> & {
  stats?: Partial<ScenarioTrack["stats"]>;
};

function createAction(
  id: string,
  type: Action["type"],
  patch: Partial<Action> = {},
): Action {
  const startTime = Number(patch.startTime) || 0;
  return {
    id,
    instanceId: patch.instanceId || `${id}_inst`,
    type,
    name: patch.name || id,
    startTime,
    logicalStartTime: patch.logicalStartTime ?? startTime,
    cooldown: 0,
    spCost: 0,
    spGain: 0,
    spGainKind: "recover",
    element: "physical",
    gaugeCost: 0,
    gaugeGain: 0,
    teamGaugeGain: 0,
    enhancementTime: 0,
    duration: 1,
    triggerWindow: 0,
    animationTime: 0,
    isDisabled: false,
    allowedTypes: [],
    damageTicks: [],
    physicalAnomaly: [],
    ...patch,
  };
}

function createTrack(
  id: string,
  actions: Action[],
  patch: TrackPatch = {},
): ScenarioTrack {
  const { stats: statsPatch, ...restPatch } = patch;
  const stats = {
    ...createDefaultStats(),
    ...(statsPatch || {}),
  } as ScenarioTrack["stats"];
  return {
    id,
    actions,
    stats,
    gaugeEfficiency: Number(stats.ult_charge_eff) || 100,
    originiumArtsPower: Number(stats.originium_arts_power) || 0,
    linkCdReduction: Number(stats.link_cd_reduction) || 0,
    initialGauge: 0,
    maxGaugeOverride: null,
    acceptTeamGauge: true,
    ...restPatch,
  };
}

function createScenario(tracks: ScenarioTrack[]): ScenarioData {
  return {
    tracks,
    connections: [],
  };
}

function getUltimateChargeLogs(result: ReturnType<typeof simulate>) {
  return result.simLog.filter((entry) => entry.type === "ULTIMATE_CHARGE_CHANGE");
}

describe("SimulationEngine Integration", () => {
  it("keeps skill SP-derived base team charge", () => {
    const scenario = createScenario([
      createTrack("alpha", [
        createAction("alpha_skill", "skill", {
          spCost: 100,
        }),
      ]),
      createTrack("beta", []),
    ]);

    const { timeline, teamConfig, enemyConfig, actors } = compileScenario(scenario);
    const result = simulate(timeline, teamConfig, enemyConfig, actors);
    const gaugeLogs = getUltimateChargeLogs(result);

    expect(gaugeLogs).toHaveLength(2);
    expect(gaugeLogs).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          actorId: "alpha",
          change: 6.5,
          reason: "skill_sp_recover",
        }),
      }),
      expect.objectContaining({
        payload: expect.objectContaining({
          actorId: "beta",
          change: 6.5,
          reason: "skill_sp_recover",
        }),
      }),
    ]);
  });

  it("stacks manual skill self gauge gain with SP-derived charge", () => {
    const scenario = createScenario([
      createTrack("alpha", [
        createAction("alpha_skill", "skill", {
          spCost: 100,
          gaugeGain: 10,
        }),
      ]),
      createTrack("beta", []),
    ]);

    const { timeline, teamConfig, enemyConfig, actors } = compileScenario(scenario);
    const result = simulate(timeline, teamConfig, enemyConfig, actors);
    const gaugeLogs = getUltimateChargeLogs(result);

    const alphaChanges = gaugeLogs
      .filter((entry) => entry.payload.actorId === "alpha")
      .map((entry) => ({ change: entry.payload.change, reason: entry.payload.reason }));
    const betaChanges = gaugeLogs
      .filter((entry) => entry.payload.actorId === "beta")
      .map((entry) => ({ change: entry.payload.change, reason: entry.payload.reason }));

    expect(alphaChanges).toEqual([
      { change: 6.5, reason: "skill_sp_recover" },
      { change: 10, reason: "skill_gain" },
    ]);
    expect(betaChanges).toEqual([
      { change: 6.5, reason: "skill_sp_recover" },
    ]);
  });

  it("applies manual skill team charge only to actors that accept team gauge", () => {
    const scenario = createScenario([
      createTrack("alpha", [
        createAction("alpha_skill", "skill", {
          teamGaugeGain: 5,
        }),
      ]),
      createTrack("beta", [], {
        acceptTeamGauge: false,
      }),
      createTrack("gamma", []),
    ]);

    const { timeline, teamConfig, enemyConfig, actors } = compileScenario(scenario);
    const result = simulate(timeline, teamConfig, enemyConfig, actors);
    const gaugeLogs = getUltimateChargeLogs(result);

    expect(gaugeLogs).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          actorId: "alpha",
          change: 5,
          reason: "skill_team_gain",
        }),
      }),
      expect.objectContaining({
        payload: expect.objectContaining({
          actorId: "gamma",
          change: 5,
          reason: "skill_team_gain",
        }),
      }),
    ]);
  });

  it("applies ult charge efficiency to manual skill gauge gains", () => {
    const scenario = createScenario([
      createTrack(
        "alpha",
        [
          createAction("alpha_skill", "skill", {
            gaugeGain: 10,
            teamGaugeGain: 5,
          }),
        ],
        {
          stats: {
            ult_charge_eff: 200,
          },
        },
      ),
      createTrack("beta", [], {
        stats: {
          ult_charge_eff: 300,
        },
      }),
    ]);

    const { timeline, teamConfig, enemyConfig, actors } = compileScenario(scenario);
    const result = simulate(timeline, teamConfig, enemyConfig, actors);
    const gaugeLogs = getUltimateChargeLogs(result);

    expect(gaugeLogs).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          actorId: "alpha",
          change: 20,
          reason: "skill_gain",
        }),
      }),
      expect.objectContaining({
        payload: expect.objectContaining({
          actorId: "alpha",
          change: 10,
          reason: "skill_team_gain",
        }),
      }),
      expect.objectContaining({
        payload: expect.objectContaining({
          actorId: "beta",
          change: 15,
          reason: "skill_team_gain",
        }),
      }),
    ]);
  });

  it("blocks manual skill gauge gain during ultimate animation and enhancement windows", () => {
    const scenario = createScenario([
      createTrack("alpha", [
        createAction("alpha_ultimate", "ultimate", {
          startTime: 0,
          duration: 0.5,
          animationTime: 1.5,
          enhancementTime: 1.5,
        }),
        createAction("alpha_skill", "skill", {
          startTime: 1,
          duration: 1,
          gaugeGain: 10,
        }),
      ]),
    ]);

    const { timeline, teamConfig, enemyConfig, actors } = compileScenario(scenario);
    const result = simulate(timeline, teamConfig, enemyConfig, actors);
    const gaugeLogs = getUltimateChargeLogs(result);

    expect(gaugeLogs).toEqual([]);
  });

  it("should match SP snapshot", () => {
    const { timeline, teamConfig, enemyConfig, actors } = compileScenario(
      simulatorFixture1.scenario,
    );

    const result = simulate(timeline, teamConfig, enemyConfig, actors);

    result.simLog.forEach((entry) => {
      console.log(formatSimLogEntry(entry));
    });

    const projection = projectSpSeries(
      result.simLog,
      result.state.getInitialSnapshot(),
    );

    expect(projection).toMatchSnapshot();
  });

  it("should match Stagger snapshot", () => {
    const { timeline, teamConfig, enemyConfig, actors } = compileScenario(
      simulatorFixture1.scenario,
      {
        systemConstants: {
          maxStagger: 125,
          staggerNodeDuration: 2,
          staggerNodeCount: 0,
        },
      },
    );

    const result = simulate(timeline, teamConfig, enemyConfig, actors);

    const projection = projectStaggerSeries(
      result.simLog,
      result.state.getInitialSnapshot(),
      enemyConfig,
    );

    expect(projection.nodeStep).toBe(125);

    expect(projection).toMatchSnapshot();
  });

  it("should match ultimate charge snapshots", () => {
    const { timeline, teamConfig, enemyConfig, actors } = compileScenario(
      simulatorFixture1.scenario,
    );

    const result = simulate(timeline, teamConfig, enemyConfig, actors);
    const initialSnapshot = result.state.getInitialSnapshot();

    const projections = Object.fromEntries(
      actors.map((actor) => [
        actor.id,
        projectUltimateSeries(
          result.simLog,
          initialSnapshot,
          actor.id,
          timeline.meta.totalDuration,
        ),
      ]),
    );

    expect(projections).toMatchSnapshot();
  });
});
