/**
 * research-step — Anthropic-direct port. Calls `_lib/llm.ts` with a
 * tool-forced request. API key resolved via `_lib/secrets.ts`.
 *
 * Returns a flat array of `ResearchDataItem` (not `{findings: [...]}`)
 * to preserve the wire shape the UI consumes.
 *
 * Mock mode when no API key resolves: returns 3 canned findings.
 */

import { z } from 'zod';
import { wrapUserInput, UserPromptInputSchema } from '../_lib/sanitize';
import { callLlmWithTool, isLlmAvailable } from '../_lib/llm';
import { runResearchSwarm } from '../_lib/swarm';

interface ResearchDataItem {
  title: string;
  content: string;
  source?: string;
  confidence?: number;
  timestamp?: string;
}

const ToolOutputSchema = z.object({
  findings: z
    .array(z.object({
      title: z.string().min(1),
      content: z.string(),
      source: z.string().optional(),
      confidence: z.number().min(0).max(1).optional(),
    }))
    .min(1),
});

const SYSTEM_PROMPT =
  'You are a meticulous research analyst executing a single step of a ' +
  'larger research plan. Return concrete findings as structured data. ' +
  'Prefer authoritative sources, named entities, and concrete metrics ' +
  'over vague summaries.';

const TOOL_PARAMS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          content: { type: 'string' },
          source: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['title', 'content'],
      },
      minItems: 1,
    },
  },
  required: ['findings'],
} as const;

export interface ResearchStepRequest {
  goal: string;
  stepTitle: string;
  stepDescription: string;
  stepType: string;
  aiModel?: string;
  config?: unknown;
  previousStepsData?: Array<{ stepTitle: string; data: ResearchDataItem[] }>;
}

export interface HandlerResult {
  status: number;
  body: unknown;
}

export async function researchStepHandler(
  req: ResearchStepRequest,
): Promise<HandlerResult> {
  const { goal, stepTitle, stepDescription } = req;
  // R-1.3: Validate via shared UserPromptInputSchema (control-byte
  // rejection + 10k cap; preserves shell-meta characters used legitimately
  // in research goals like "$50k", "(US)", etc.).
  for (const [name, value] of [
    ['goal', goal],
    ['stepTitle', stepTitle],
    ['stepDescription', stepDescription],
  ] as const) {
    const v = UserPromptInputSchema.safeParse(value);
    if (!v.success) {
      return {
        status: 400,
        body: { error: `${name} invalid: ${v.error.issues[0]?.message ?? 'invalid'}` },
      };
    }
  }

  if (!(await isLlmAvailable())) {
    return {
      status: 200,
      body: [
        { title: `[mock] ${stepTitle} — finding 1`, content: `Stub content for ${stepTitle}`, source: 'mock://source-1', confidence: 0.9, timestamp: new Date().toISOString() },
        { title: `[mock] ${stepTitle} — finding 2`, content: `Second stub finding`, source: 'mock://source-2', confidence: 0.8, timestamp: new Date().toISOString() },
        { title: `[mock] ${stepTitle} — finding 3`, content: `Third stub finding`, source: 'mock://source-3', confidence: 0.7, timestamp: new Date().toISOString() },
      ],
    };
  }

  // Build prior-context once — both paths consume it.
  const ctx = (req.previousStepsData ?? []).map(s =>
    `${wrapUserInput(s.stepTitle)}:\n` + s.data.map(d => `- ${wrapUserInput(d.title)}: ${wrapUserInput(d.content)}`).join('\n')
  ).join('\n\n');

  // R-3.2: env-gated swarm path. When `RUFLO_USE_SWARM=true`, dispatch
  // to the 4-agent specialized pipeline (researcher → analyst → critic
  // → scribe). Default = single-call path (cheaper, faster, what the
  // current production goal.ruv.io behaviour is).
  if (process.env.RUFLO_USE_SWARM === 'true') {
    const swarm = await runResearchSwarm({
      goal,
      stepTitle,
      stepDescription,
      priorContext: ctx || undefined,
    });
    if (swarm.status !== 200) {
      return { status: swarm.status, body: { error: `swarm failed at ${swarm.failedAgent}: ${swarm.error}` } };
    }
    // Map SwarmFinding → ResearchDataItem (drop critique; add timestamp).
    const now = new Date().toISOString();
    const items: ResearchDataItem[] = swarm.findings.map((f) => ({
      title: f.title,
      content: f.content,
      source: f.source,
      confidence: f.confidence,
      timestamp: now,
    }));
    return { status: 200, body: items };
  }

  // Default single-call path.
  const userPrompt = [
    `Research goal: ${wrapUserInput(goal)}`,
    `Current step: ${wrapUserInput(stepTitle)} — ${wrapUserInput(stepDescription)}`,
    ctx ? `Prior step findings:\n${ctx}` : 'No prior steps yet.',
  ].join('\n\n');

  const result = await callLlmWithTool({
    system: SYSTEM_PROMPT,
    user: userPrompt,
    tool: { name: 'return_findings', description: 'Return findings for the current research step', parameters: TOOL_PARAMS },
    model: req.aiModel,
  });

  if (result.status !== 200) return { status: result.status, body: { error: result.error } };

  const validated = ToolOutputSchema.safeParse(result.input);
  if (!validated.success) {
    return { status: 502, body: { error: 'AI tool-call output failed schema validation' } };
  }
  // UI expects a flat array, not `{findings: [...]}`.
  return { status: 200, body: validated.data.findings as ResearchDataItem[] };
}
