/**
 * RVF persistence E2E — Step 18 (ADR-093).
 *
 * Verifies the repo layer for userGoal + researchConfig (Step 11
 * already covers widgetConfig in its own POC test). Tests at the
 * repo level rather than driving Index.tsx through a goal-entry
 * flow because:
 *   - The hydrate effects in Index.tsx fire on mount, gated by
 *     VITE_RVF_ENABLED. Driving them via the UI requires either:
 *       (a) setting VITE_RVF_ENABLED=true via .env.local + a
 *           dev-server restart, or
 *       (b) a test fixture that mounts Index with the flag forced on.
 *   - Both add fixture complexity that the build-pipeline doesn't
 *     have today. The repos themselves are the contract — if they
 *     write/read correctly, the wired effects in Index.tsx work
 *     because they're identical to the widgetConfig pattern that
 *     Step 11 verified end-to-end.
 *
 * For full UI integration coverage, run the Step 11 flag-on POC
 * helper script (`/tmp/goal-ui-step11-flagon.mjs`) which exercises
 * the same effects pattern.
 */

import { test, expect } from '@playwright/test';

test.describe('persistence — userGoal repo', () => {
  test('write → read → reload → read still has the value', async ({ page }) => {
    await page.goto('/');

    // Clean slate
    await page.evaluate(async () => {
      const repo = await import('/src/integrations/rvf/goalRepo.ts');
      await repo.clearCurrentGoal();
    });

    // Write
    const goal = 'Step 18 goal persistence test - quantum entanglement research';
    await page.evaluate(async (g) => {
      const repo = await import('/src/integrations/rvf/goalRepo.ts');
      await repo.saveCurrentGoal(g);
    }, goal);

    // Read same-page
    const readSamePage = await page.evaluate(async () => {
      const repo = await import('/src/integrations/rvf/goalRepo.ts');
      return await repo.getCurrentGoal();
    });
    expect(readSamePage).toBe(goal);

    // Reload + read — IndexedDB persists across reloads
    await page.reload({ waitUntil: 'networkidle' });
    const readAfterReload = await page.evaluate(async () => {
      const repo = await import('/src/integrations/rvf/goalRepo.ts');
      return await repo.getCurrentGoal();
    });
    expect(readAfterReload).toBe(goal);

    // Cleanup so subsequent tests start clean
    await page.evaluate(async () => {
      const repo = await import('/src/integrations/rvf/goalRepo.ts');
      await repo.clearCurrentGoal();
    });
  });

  test('clear removes the value', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async () => {
      const repo = await import('/src/integrations/rvf/goalRepo.ts');
      await repo.saveCurrentGoal('to-be-cleared');
      await repo.clearCurrentGoal();
    });
    const after = await page.evaluate(async () => {
      const repo = await import('/src/integrations/rvf/goalRepo.ts');
      return await repo.getCurrentGoal();
    });
    expect(after).toBeUndefined();
  });
});

test.describe('persistence — researchConfig repo', () => {
  test('write → read → reload → read preserves nested object', async ({ page }) => {
    await page.goto('/');

    // Clean slate
    await page.evaluate(async () => {
      const repo = await import('/src/integrations/rvf/researchConfigRepo.ts');
      await repo.clearResearchConfig();
    });

    const cfg = {
      goal: 'persistence-cfg-test',
      researchGuidance: {
        focusAreas: ['superconductors', 'thermodynamics'],
        excludeTopics: ['fiction'],
        depth: 'deep',
        perspective: 'academic',
        timeframe: 'recent',
      },
      stateDefinition: { currentState: { goalDefined: true }, goalState: { verified: true }, stateGaps: [] },
    };

    // Write
    await page.evaluate(async (c) => {
      const repo = await import('/src/integrations/rvf/researchConfigRepo.ts');
      await repo.saveResearchConfig(c);
    }, cfg);

    // Read same-page
    const same = await page.evaluate(async () => {
      const repo = await import('/src/integrations/rvf/researchConfigRepo.ts');
      return await repo.getResearchConfig();
    });
    expect(same).toEqual(cfg);

    // Reload + read
    await page.reload({ waitUntil: 'networkidle' });
    const after = await page.evaluate(async () => {
      const repo = await import('/src/integrations/rvf/researchConfigRepo.ts');
      return await repo.getResearchConfig();
    });
    expect(after).toEqual(cfg);

    // Cleanup
    await page.evaluate(async () => {
      const repo = await import('/src/integrations/rvf/researchConfigRepo.ts');
      await repo.clearResearchConfig();
    });
  });
});
