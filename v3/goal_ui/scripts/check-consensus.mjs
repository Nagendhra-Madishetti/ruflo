#!/usr/bin/env tsx
/**
 * R-6.1 hive-mind consensus smoke test.
 *
 * Two suites:
 *
 *   [A] runConsensusVote in mock-mode (no LLM creds) — verify the
 *       synthetic 4-1 keep verdict is well-formed.
 *
 *   [B] runConsensusVote with a stubbed Anthropic fetch that simulates
 *       1 FORCED-FAULTY voter (votes 'drop' regardless of evidence)
 *       across 5 voters → final decision should still be 'keep'
 *       (3+ keep votes survive Byzantine fault tolerance, f < n/3).
 *
 *   [C] runResearchSwarm with a stubbed fetch that synthesizes a
 *       contested claim (analyst conf 0.9 vs critic 0.5, delta=0.4
 *       > 0.2 threshold) → swarmTrace.contestedClaimsCount === 1
 *       and the surviving finding carries `consensusVerdict`.
 */

let pass = 0, fail = 0;
const check = (label, ok, detail) => {
  if (ok) { console.log(`  ✓ ${label}`); pass++; }
  else { console.log(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
};

const { _resetSecretsCacheForTesting } = await import('../functions/_lib/secrets.ts');

// ── [A] mock-mode ──────────────────────────────────────────────
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GCLOUD_PROJECT_ID;
delete process.env.GOOGLE_CLOUD_PROJECT;
_resetSecretsCacheForTesting();
console.log('[A] runConsensusVote — mock mode');
{
  const { runConsensusVote } = await import('../functions/_lib/consensus.ts');
  const v = await runConsensusVote({
    claim: 'Test claim',
    evidence: 'Test evidence',
    source: 'mock://src',
    analystConfidence: 0.9,
    criticConfidence: 0.5,
    criticRationale: 'weak evidence',
  });
  check(`decision is 'keep' (got ${v.decision})`, v.decision === 'keep');
  check('5 votes recorded', v.votes?.length === 5);
  check('contested === true', v.contested === true);
  check('dissentRationale mentions "KEEP 4-1"', /KEEP 4-1/.test(v.dissentRationale));
  check('dissent rationale references the dropping voter', /source-quality/i.test(v.dissentRationale));
}

// ── [B] real-mode with 1 forced-faulty voter ───────────────────
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
_resetSecretsCacheForTesting();
const ORIG_FETCH = global.fetch;
console.log('\n[B] runConsensusVote — 5 voters with 1 forced-faulty (Byzantine f<n/3)');
{
  let voterCalls = 0;
  global.fetch = async (_url, opts) => {
    voterCalls++;
    const body = JSON.parse(opts.body);
    // Inspect system prompt to identify which voter is calling
    const sys = body.system ?? '';
    let vote = 'keep';
    let rationale = `voter ${voterCalls} kept on solid evidence`;
    // Force voter "skeptic" (the 2nd voter) to 'drop' as the faulty node
    if (/voter "skeptic"/.test(sys)) {
      vote = 'drop';
      rationale = '[forced-faulty] skeptic always drops — Byzantine fault simulation';
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{
          type: 'tool_use',
          name: 'cast_vote',
          input: { vote, rationale },
        }],
        stop_reason: 'tool_use',
      }),
      text: async () => '',
    };
  };

  // Re-import to bust module cache
  const { runConsensusVote } = await import('../functions/_lib/consensus.ts?v=' + Date.now());
  const v = await runConsensusVote({
    claim: 'Test claim B',
    evidence: 'Strong primary-source evidence',
    source: 'https://example.invalid/study-2026',
    analystConfidence: 0.9,
    criticConfidence: 0.5,
  });
  check(`decision is 'keep' despite 1 faulty (got ${v.decision})`, v.decision === 'keep');
  check('exactly 5 voter calls', voterCalls === 5);
  check('5 votes recorded', v.votes?.length === 5);
  check('forced-faulty voter recorded as drop', v.votes?.some((x) => x.vote === 'drop' && /forced-faulty/.test(x.rationale)));
  check('majority 4 keep votes', v.votes?.filter((x) => x.vote === 'keep').length === 4);
  check('contested (non-unanimous)', v.contested === true);
  check('dissentRationale mentions KEEP 4-1', /KEEP 4-1/.test(v.dissentRationale));
}

// ── [C] runResearchSwarm with synthetic contested claim ────────
console.log('\n[C] runResearchSwarm — synthetic contested claim through full pipeline');
{
  let agentCallCount = 0;
  const TOOL_RESPONSES = {
    researcher_findings: { observations: [{ text: 'Observation A', source: 'src://A' }] },
    analyst_claims: { claims: [
      { claim: 'Claim X has high confidence per analyst', evidence: 'good evidence', source: 'src://A', confidence: 0.9 },
    ] },
    critic_review: { decisions: [
      { claim: 'Claim X has high confidence per analyst', decision: 'keep', adjustedConfidence: 0.5, rationale: 'evidence weaker than analyst graded' },
    ] },
    scribe_findings: { findings: [
      { title: 'Claim X has high confidence per analyst', content: 'final shape', source: 'src://A', confidence: 0.5 },
    ] },
    cast_vote: { vote: 'keep', rationale: 'consensus voter kept' },
  };
  global.fetch = async (_url, opts) => {
    agentCallCount++;
    const body = JSON.parse(opts.body);
    const toolName = body.tool_choice?.name;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'tool_use', name: toolName, input: TOOL_RESPONSES[toolName] }],
        stop_reason: 'tool_use',
      }),
      text: async () => '',
    };
  };

  const { runResearchSwarm } = await import('../functions/_lib/swarm.ts?v=' + Date.now());
  const result = await runResearchSwarm({
    goal: 'test goal',
    stepTitle: 'Discovery',
  });
  check(`status 200 (got ${result.status})`, result.status === 200);
  check('contestedClaimsCount === 1 (delta 0.4 > threshold 0.2)', result.swarmTrace?.contestedClaimsCount === 1);
  check('consensusDroppedCount === 0 (consensus kept it)', result.swarmTrace?.consensusDroppedCount === 0);
  check('exactly 4 agent + 5 voter = 9 LLM calls', agentCallCount === 9);
  check('1 finding survived', result.findings?.length === 1);
  check('finding has consensusVerdict attached', !!result.findings?.[0]?.consensusVerdict);
  check('consensusVerdict.decision === "keep"', result.findings?.[0]?.consensusVerdict?.decision === 'keep');
  check('consensusVerdict has dissentRationale', !!result.findings?.[0]?.consensusVerdict?.dissentRationale);
}

// ── [D] R-6.2: 5 simulated runs, rotating faulty voter ─────────
// DoD: 5 simulated runs all reach consensus within 3 rounds.
// Our consensus model is single-round majority — "rounds" maps to
// "how many voter-batches were dispatched". The current impl dispatches
// once and tallies, so rounds=1 trivially ≤ 3.
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
_resetSecretsCacheForTesting();
console.log('\n[D] 5 simulated runs, rotating faulty voter (R-6.2 DoD)');
{
  const VOTERS = ['evidence-weighter', 'skeptic', 'source-quality', 'confidence-calibrator', 'pragmatist'];
  const SEEDS = [
    { claim: 'Tesla Model Y top family-EV pick',           evidence: 'EVIA 2024 sales rank',     analyst: 0.9, critic: 0.5 },
    { claim: 'IONIQ 5 best in interior space',             evidence: 'Edmunds review',           analyst: 0.8, critic: 0.4 },
    { claim: 'Federal tax credit covers $7.5k for EVs',    evidence: 'IRS.gov clean-vehicle',    analyst: 0.95, critic: 0.6 },
    { claim: 'Charging infrastructure improving in US',    evidence: 'Bloomberg report',         analyst: 0.7, critic: 0.3 },
    { claim: 'Battery degradation lower than ICE wear',    evidence: 'Recurrent study 2024',     analyst: 0.85, critic: 0.55 },
  ];

  const runs = [];
  for (let i = 0; i < 5; i++) {
    const faultyVoter = VOTERS[i];
    const seed = SEEDS[i];

    // Stub fetch: count voter calls (= round count × voter count).
    let callCount = 0;
    global.fetch = async (_url, opts) => {
      callCount++;
      const body = JSON.parse(opts.body);
      const sys = body.system ?? '';
      let vote = 'keep';
      let rationale = `kept on solid evidence (run ${i})`;
      if (new RegExp(`voter "${faultyVoter}"`).test(sys)) {
        vote = 'drop';
        rationale = `[forced-faulty voter "${faultyVoter}"] always drops`;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: 'tool_use', name: 'cast_vote', input: { vote, rationale } }],
          stop_reason: 'tool_use',
        }),
        text: async () => '',
      };
    };

    const { runConsensusVote } = await import('../functions/_lib/consensus.ts?v=' + Date.now() + '-' + i);
    const t0 = performance.now();
    const v = await runConsensusVote({
      claim: seed.claim,
      evidence: seed.evidence,
      analystConfidence: seed.analyst,
      criticConfidence: seed.critic,
    });
    const t1 = performance.now();
    // 1 round = 5 voter calls in parallel. Round count = callCount / 5.
    const rounds = Math.ceil(callCount / 5);
    runs.push({
      i,
      faulty: faultyVoter,
      decision: v.decision,
      rounds,
      latencyMs: Math.round(t1 - t0),
      keepCount: v.votes.filter((x) => x.vote === 'keep').length,
      dropCount: v.votes.filter((x) => x.vote === 'drop').length,
    });
  }

  console.log('  Per-run results:');
  for (const r of runs) {
    console.log(`    run ${r.i} (faulty=${r.faulty}): ${r.decision} ${r.keepCount}-${r.dropCount} in ${r.rounds} round(s), ${r.latencyMs}ms`);
  }

  check(`5 runs executed`, runs.length === 5);
  check(`all 5 runs decided 'keep' (4 keeps each, 1 forced-faulty drop)`,
    runs.every((r) => r.decision === 'keep' && r.keepCount === 4 && r.dropCount === 1));
  check(`all 5 runs reached consensus in ≤ 3 rounds`,
    runs.every((r) => r.rounds <= 3));
  check(`max rounds across all runs`, Math.max(...runs.map((r) => r.rounds)) <= 3);
  check(`every voter has been the faulty one (rotation)`,
    new Set(runs.map((r) => r.faulty)).size === 5);
}

global.fetch = ORIG_FETCH;
console.log(`\nPassed: ${pass}  Failed: ${fail}`);
process.exit(fail);
