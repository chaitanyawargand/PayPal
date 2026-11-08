import { describe, expect, it } from "vitest";
import { CandidateCard } from "../src/candidate.js";
import { Event } from "../src/event.js";
import { phase7Fixtures } from "../src/fixtures.js";
import { Run } from "../src/run.js";

describe("deterministic Phase 7 fixtures", () => {
  it("parses each run, candidate, and event list and keeps per-run sequences increasing", () => {
    expect(phase7Fixtures).toHaveLength(4);
    for (const fixture of phase7Fixtures) {
      expect(Run.safeParse(fixture.run).success).toBe(true);
      expect(CandidateCard.safeParse(fixture.candidate).success).toBe(true);
      expect(fixture.events.every((event) => Event.safeParse(event).success)).toBe(true);
      expect(fixture.events.map((event) => event.seq)).toEqual(fixture.events.map((_, index) => index + 1));
      expect(fixture.events.every((event) => event.runId === fixture.run.id)).toBe(true);
    }
  });

  it("matches all frozen advertised and quote totals", () => {
    const byRun = new Map(phase7Fixtures.map((fixture) => [fixture.run.id, fixture.candidate]));
    expect(byRun.get("run_nova_allow")).toMatchObject({ advertisedTotalCents: 6774, quoteTotalCents: 6774 });
    expect(byRun.get("run_peer_stepup")).toMatchObject({ advertisedTotalCents: 5017, quoteTotalCents: 5017 });
    expect(byRun.get("run_dealdemon_block")).toMatchObject({ advertisedTotalCents: 3834, quoteTotalCents: 9776 });
    expect(byRun.get("run_dealdemon_tamper")).toMatchObject({ advertisedTotalCents: 5999, quoteTotalCents: 7499 });
    expect(phase7Fixtures.map(({ run }) => run.decision?.outcome)).toEqual(["ALLOW", "STEP_UP", "BLOCK", "TAMPER_REJECT"]);
    expect(phase7Fixtures[2]?.run.status).toBe("AWAITING_SELECTION");
    expect(phase7Fixtures[3]?.run.status).toBe("AWAITING_SELECTION");
  });
});
