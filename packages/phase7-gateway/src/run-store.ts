import { CandidateCard, type CandidateCard as CandidateCardType } from "../../phase7-contracts/src/candidate.js";
import { assertEventDataSafe, Event, type Event as EventType } from "../../phase7-contracts/src/event.js";
import { Run, type Run as RunType } from "../../phase7-contracts/src/run.js";

function clone<T>(value: T): T { return structuredClone(value); }
export type RunSnapshot = { run: RunType; candidates: CandidateCardType[] };

export class InMemoryRunStore {
  private readonly runs = new Map<string, RunType>();
  private readonly candidates = new Map<string, CandidateCardType[]>();
  private readonly events = new Map<string, EventType[]>();

  createRun(value: unknown): RunType {
    const run = Run.parse(value);
    if (this.runs.has(run.id)) throw new Error(`Run already exists: ${run.id}`);
    this.runs.set(run.id, clone(run));
    this.candidates.set(run.id, []);
    this.events.set(run.id, []);
    return clone(run);
  }
  getRun(runId: string): RunType | undefined { const run = this.runs.get(runId); return run ? clone(run) : undefined; }
  updateRun(value: unknown): RunType {
    const run = Run.parse(value);
    if (!this.runs.has(run.id)) throw new Error(`Run not found: ${run.id}`);
    this.runs.set(run.id, clone(run));
    return clone(run);
  }
  getCandidates(runId: string): CandidateCardType[] { return clone(this.candidates.get(runId) ?? []); }
  setCandidates(runId: string, values: unknown[]): CandidateCardType[] {
    if (!this.runs.has(runId)) throw new Error(`Run not found: ${runId}`);
    const parsed = values.map((value) => CandidateCard.parse(value));
    this.candidates.set(runId, clone(parsed));
    return clone(parsed);
  }
  updateCandidate(runId: string, value: unknown): CandidateCardType {
    const candidate = CandidateCard.parse(value);
    const rows = this.candidates.get(runId);
    const index = rows?.findIndex((row) => row.id === candidate.id) ?? -1;
    if (!rows || index < 0) throw new Error(`Candidate not found: ${candidate.id}`);
    rows[index] = clone(candidate);
    return clone(candidate);
  }
  appendEvent(input: Omit<EventType, "seq"> & { seq?: never }): EventType {
    assertEventDataSafe(input.data ?? {});
    const rows = this.events.get(input.runId);
    if (!rows) throw new Error(`Run not found: ${input.runId}`);
    const event = Event.parse({ ...input, seq: (rows.at(-1)?.seq ?? 0) + 1 });
    rows.push(clone(event));
    return clone(event);
  }
  getEvents(runId: string, afterSeq = 0): EventType[] {
    const rows = this.events.get(runId);
    return rows ? clone(rows.filter((event) => event.seq > afterSeq)) : [];
  }
  snapshot(runId: string): RunSnapshot | undefined {
    const run = this.runs.get(runId);
    return run ? clone({ run, candidates: this.candidates.get(runId) ?? [] }) : undefined;
  }
}
