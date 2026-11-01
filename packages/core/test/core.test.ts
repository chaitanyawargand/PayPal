import { Verdict as VerdictFromIndex, JudgeOutputSchema as JudgeFromIndex } from '../src';
import { describe, it, expect } from 'vitest';
describe('JudgeOutputSchema - anti-drift', () => {
  it('accepts valid judge output', () => {
    const valid = {
      per_criterion: [{
        criterion_id: 'waterproof',
        verdict: 'satisfied' as const,
        evidence_text: '100% waterproof membrane.',
        reason: 'explicit waterproof claim'
      }],
      overall: 'satisfied' as const
    };
    expect(JudgeFromIndex.parse(valid)).toEqual(valid);
  });

  it('rejects drifted word "allowed" instead of "satisfied"', () => {
    const drifted = {
      per_criterion: [{
        criterion_id: 'waterproof',
        verdict: 'allowed', // this is what a dashboard dev would invent
        evidence_text: 'waterproof',
        reason: 'looks ok'
      }],
      overall: 'satisfied'
    };
    // This MUST fail. If it passes, your schema is useless.
    expect(JudgeFromIndex.safeParse(drifted).success).toBe(false);
  });

  it('accepts uncertain with empty evidence - Case 06 style', () => {
    const uncertain = {
      per_criterion: [{
        criterion_id: 'weight_under_500g',
        verdict: 'uncertain' as const,
        evidence_text: '',
        reason: 'no weight number given'
      }],
      overall: 'uncertain' as const
    };
    expect(JudgeFromIndex.safeParse(uncertain).success).toBe(true);
  });
});

describe('index barrel', () => {
  it('re-exports Verdict and Judge from index', () => {
    expect(VerdictFromIndex.options).toContain('ALLOW');
    expect(JudgeFromIndex).toBeDefined();
  });
});
