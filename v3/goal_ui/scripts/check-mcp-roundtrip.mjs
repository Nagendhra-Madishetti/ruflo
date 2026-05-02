#!/usr/bin/env tsx
/**
 * R-5.2 round-trip test — spawns `mcp:start` as a subprocess via
 * `StdioClientTransport`, calls each of the 5 tools, and verifies
 * the response matches the manifest contract.
 *
 * Mock-mode behaviour: tools return their existing handler mock
 * responses (no LLM creds needed). The aggregate `run_full_research`
 * threads through 7 steps using the canned mock responses, so the
 * round-trip exercises the full orchestration path without spending
 * tokens or requiring credentials.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';

let pass = 0, fail = 0;
const check = (label, ok, detail) => {
  if (ok) { console.log(`  ✓ ${label}`); pass++; }
  else { console.log(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
};

const transport = new StdioClientTransport({
  command: 'npx',
  args: ['tsx', resolve('functions/mcp/server.ts')],
});

const client = new Client(
  { name: 'r52-roundtrip-test', version: '0.1.0' },
  { capabilities: {} },
);

console.log('R-5.2 MCP round-trip test\n');

await client.connect(transport);
console.log('  ✓ client connected to mcp server');
pass++;

// 1. tools/list
console.log('\n[1] tools/list');
const list = await client.listTools();
check(`returned ${list.tools?.length ?? 0} tools`, Array.isArray(list.tools) && list.tools.length === 5);
const expected = ['generate_research_goal', 'research_step', 'generate_action_items', 'optimize_research_config', 'run_full_research'];
for (const name of expected) {
  check(`tool "${name}" listed`, list.tools.some((t) => t.name === name));
}

// 2. generate_research_goal
console.log('\n[2] tools/call generate_research_goal');
{
  const r = await client.callTool({ name: 'generate_research_goal', arguments: { category: 'finance' } });
  const text = r.content?.[0]?.text;
  check('content[0].type === "text"', r.content?.[0]?.type === 'text');
  let body = null;
  try { body = JSON.parse(text); } catch {}
  check('JSON-parsable body', body !== null);
  check('body.goals is array', Array.isArray(body?.goals));
  check('body.mock === true', body?.mock === true);
}

// 3. research_step
console.log('\n[3] tools/call research_step');
{
  const r = await client.callTool({
    name: 'research_step',
    arguments: { goal: 'Test', stepTitle: 'Discovery', stepDescription: 'desc', stepType: 'goal-analysis' },
  });
  const body = JSON.parse(r.content?.[0]?.text);
  check('body is array', Array.isArray(body));
  check('3 mock findings', body?.length === 3);
  check('first finding has title', !!body?.[0]?.title);
}

// 4. generate_action_items
console.log('\n[4] tools/call generate_action_items');
{
  const r = await client.callTool({
    name: 'generate_action_items',
    arguments: { goal: 'Test goal', researchContext: [], totalSteps: 0, totalDataPoints: 0 },
  });
  const body = JSON.parse(r.content?.[0]?.text);
  check('body.actionItems is array', Array.isArray(body?.actionItems));
  check('3 mock action items', body?.actionItems?.length === 3);
  check('summary present', typeof body?.summary === 'string');
}

// 5. optimize_research_config
console.log('\n[5] tools/call optimize_research_config');
{
  const r = await client.callTool({
    name: 'optimize_research_config',
    arguments: { preset: 'academic-deep' },
  });
  const body = JSON.parse(r.content?.[0]?.text);
  check('body.config.researchGuidance present', !!body?.config?.researchGuidance);
}

// 6. run_full_research aggregate
console.log('\n[6] tools/call run_full_research (aggregate, drives 7 steps)');
{
  const r = await client.callTool({
    name: 'run_full_research',
    arguments: { goal: 'Test full research run', stepCount: 3 },
  });
  const body = JSON.parse(r.content?.[0]?.text);
  check('success === true', body?.success === true);
  check('config present', !!body?.config);
  check('perStep is array of 3', Array.isArray(body?.perStep) && body.perStep.length === 3);
  check('finalReport.actionItems present', Array.isArray(body?.finalReport?.actionItems));
  check('stats.stepsExecuted === 3', body?.stats?.stepsExecuted === 3);
  check('stats.totalFindings > 0', (body?.stats?.totalFindings ?? 0) > 0);
}

await client.close();

console.log(`\nPassed: ${pass}  Failed: ${fail}`);
process.exit(fail);
