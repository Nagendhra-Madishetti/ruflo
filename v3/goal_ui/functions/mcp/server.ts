/**
 * goal_ui-research MCP server (R-5.2 / ADR-098).
 *
 * stdio transport. Exposes the 5 tools declared in `mcp-server.json`
 * (R-5.1) by proxying each call to the corresponding handler in
 * `functions/<name>/handler.ts`. Adds one new aggregate:
 *   `run_full_research` — drives goal generation → 7-step research →
 *   action items as a single tool call. Lets external claude-flow
 *   agents use RuFlo Research as a subroutine.
 *
 * Run via `npm run mcp:start` (stdio). Connect via:
 *   claude mcp add goal_ui-research tsx functions/mcp/server.ts
 *   claude mcp call goal_ui-research run_full_research \
 *     --goal "Best EV under $50k"
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateResearchGoalHandler } from '../generate-research-goal/handler.js';
import { researchStepHandler } from '../research-step/handler.js';
import { generateActionItemsHandler } from '../generate-action-items/handler.js';
import { optimizeResearchConfigHandler } from '../optimize-research-config/handler.js';

// ── Load + freeze tool definitions from the R-5.1 manifest ──────

const manifestPath = resolve(dirname(fileURLToPath(import.meta.url)), 'mcp-server.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
  name: string;
  version: string;
  tools: Tool[];
};

// ── run_full_research aggregate orchestrator ────────────────────

interface RunFullResearchInput {
  goal: string;
  preset?: string;
  stepCount?: number;
}

const DEFAULT_STEP_TITLES = [
  'Goal Analysis',
  'State Assessment',
  'Web Search',
  'Document Analysis',
  'Knowledge Synthesis',
  'Insight Generation',
  'Verification',
];

async function runFullResearch(input: RunFullResearchInput): Promise<unknown> {
  const { goal, preset = 'academic-deep', stepCount = 7 } = input;
  const steps = DEFAULT_STEP_TITLES.slice(0, Math.max(1, Math.min(stepCount, DEFAULT_STEP_TITLES.length)));

  // 1. Optimize config for the preset.
  const cfgResult = await optimizeResearchConfigHandler({ preset, currentGoal: goal });
  const config = (cfgResult.body as { config?: unknown })?.config ?? null;

  // 2. Run each step sequentially, accumulating findings.
  const perStep: Array<{ stepTitle: string; data: Array<{ title: string; content: string; source?: string; confidence?: number }> }> = [];
  for (const stepTitle of steps) {
    const stepResult = await researchStepHandler({
      goal,
      stepTitle,
      stepDescription: `Execute research step "${stepTitle}" toward: ${goal}`,
      stepType: stepTitle.toLowerCase().replace(/\s+/g, '-'),
      previousStepsData: perStep,
    });
    if (stepResult.status !== 200) {
      return {
        success: false,
        failedAt: stepTitle,
        status: stepResult.status,
        error: stepResult.body,
      };
    }
    const findings = Array.isArray(stepResult.body)
      ? (stepResult.body as Array<{ title: string; content: string; source?: string; confidence?: number }>)
      : [];
    perStep.push({ stepTitle, data: findings });
  }

  // 3. Generate action items + summary.
  const actionsResult = await generateActionItemsHandler({
    goal,
    researchContext: perStep.map((s) => ({
      stepTitle: s.stepTitle,
      findings: s.data.map((d) => ({ title: d.title, content: d.content, source: d.source })),
    })),
    totalSteps: perStep.length,
    totalDataPoints: perStep.reduce((sum, s) => sum + s.data.length, 0),
  });

  return {
    success: true,
    config,
    perStep,
    finalReport: actionsResult.body,
    stats: {
      stepsExecuted: perStep.length,
      totalFindings: perStep.reduce((sum, s) => sum + s.data.length, 0),
    },
  };
}

// ── MCP server wiring ───────────────────────────────────────────

const server = new Server(
  { name: manifest.name, version: manifest.version },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: manifest.tools,
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const a = (args ?? {}) as Record<string, unknown>;

  let result: unknown;
  try {
    switch (name) {
      case 'generate_research_goal': {
        const r = await generateResearchGoalHandler({
          category: typeof a.category === 'string' ? a.category : '',
          customContext: typeof a.customContext === 'string' ? a.customContext : undefined,
        });
        result = r.body;
        break;
      }
      case 'research_step': {
        const r = await researchStepHandler({
          goal: typeof a.goal === 'string' ? a.goal : '',
          stepTitle: typeof a.stepTitle === 'string' ? a.stepTitle : '',
          stepDescription: typeof a.stepDescription === 'string' ? a.stepDescription : '',
          stepType: typeof a.stepType === 'string' ? a.stepType : '',
          aiModel: typeof a.aiModel === 'string' ? a.aiModel : undefined,
          config: a.config,
          previousStepsData: Array.isArray(a.previousStepsData) ? (a.previousStepsData as never) : undefined,
        });
        result = r.body;
        break;
      }
      case 'generate_action_items': {
        const r = await generateActionItemsHandler({
          goal: typeof a.goal === 'string' ? a.goal : '',
          researchContext: Array.isArray(a.researchContext) ? (a.researchContext as never) : [],
          totalSteps: typeof a.totalSteps === 'number' ? a.totalSteps : 0,
          totalDataPoints: typeof a.totalDataPoints === 'number' ? a.totalDataPoints : 0,
        });
        result = r.body;
        break;
      }
      case 'optimize_research_config': {
        const r = await optimizeResearchConfigHandler({
          preset: typeof a.preset === 'string' ? a.preset : '',
          currentGoal: typeof a.currentGoal === 'string' ? a.currentGoal : undefined,
        });
        result = r.body;
        break;
      }
      case 'run_full_research': {
        result = await runFullResearch({
          goal: typeof a.goal === 'string' ? a.goal : '',
          preset: typeof a.preset === 'string' ? a.preset : undefined,
          stepCount: typeof a.stepCount === 'number' ? a.stepCount : undefined,
        });
        break;
      }
      default:
        return {
          isError: true,
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Error executing ${name}: ${(err as Error)?.message ?? err}` }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

// eslint-disable-next-line no-console
console.error(`[mcp] ${manifest.name}@${manifest.version} listening on stdio (${manifest.tools.length} tools)`);
