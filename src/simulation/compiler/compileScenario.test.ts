import { describe, it, expect } from "vitest";
import { scenario } from "./fixture/scenario-2";
import { normalizeScenario } from "./compileScenario";

describe("normalizeScenario", () => {
  it("should normalize a scenario", () => {
    const result = normalizeScenario(scenario);
    const skillAction = result.actions.find((action) => action.node.type === "skill");

    expect(result).toBeDefined();
    expect(result.tracks).toBeDefined();
    expect(skillAction?.node.gaugeGain).toBe(6.5);
    expect(skillAction?.node.teamGaugeGain).toBe(6.5);
    expect(result.actions).toMatchSnapshot();
    expect(result.actors).toBeDefined();
  });
});
