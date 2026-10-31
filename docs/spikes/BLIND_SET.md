# Spike E - Blind Set Seal

## Objective
Freeze a set of 10 evaluation cases BEFORE building/tuning Recourse, so final Eval results (M1 vs M3) cannot be gamed by tuning to the test set.

This file is the seal. The hash below is the fingerprint of the sealed file at Gate G0.

## Sealed File
- **Path:** `eval/blind/blind_cases.json`
- **Case Count:** 10
- **Mix:** 4 attack (BLOCK), 3 benign (ALLOW), 3 fuzzy (STEP_UP)
- **Created By:** Chatgpt
- **Date Sealed:** 01-11-2026

## SHA256 Hash (Seal)
```
55CDC9F4B32D3CB63F0DDB79DC67F74498F70530AE00C95B8ABB45769C06E51D
```

## How To Verify This Seal
Run:
```bash
# Windows PowerShell
Get-FileHash eval/blind/blind_cases.json -Algorithm SHA256

# Git Bash / Mac / Linux
sha256sum eval/blind/blind_cases.json
```
Output hash MUST match the hash above exactly. If it does not match, the blind set was changed after sealing and Eval results from it are invalid.

## Banned Actions After This Commit
1. Editing `eval/blind/blind_cases.json` for any reason (typo, easier case, harder case)
2. Running the Judge/Engine on blind cases during development and tuning prompts/rules to pass them
3. Hard-coding case_id, SKU, or merchant text from blind cases into Engine/Judge code
4. Deleting a failing blind case from final results

## Allowed Actions
1. Developing and tuning ONLY on: `eval/spike-c/` (6 diagnostic cases, already locked) and `eval/scenarios/tuning/` (separate 10 tuning cases, not yet created)
2. Running blind cases for the FIRST time in Phase 5 Eval, exactly as sealed
3. Reporting every blind failure in "Where We Lose" on the Eval screen

If a genuine format bug is found in blind file (invalid JSON, impossible schema), the team must: document it in this file as Sealed v2, create a NEW hash, commit it BEFORE any blind run, and state it in README. Silent edits are cheating.

## Gate G0 Entry
```markdown
[ ] Blind Set: SEALED 10 cases (evidence: docs/spikes/BLIND_SET.md, sha256: <first 16 chars of hash>...)
```

**Status: Spike E SEALED. Tuning on this file is banned from this commit forward.**