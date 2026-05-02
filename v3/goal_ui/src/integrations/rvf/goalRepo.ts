/**
 * userGoal persistence via the browser RVF backend.
 *
 * Step 18 (ADR-093). Mirrors widgetConfigRepo. Single row in
 * namespace `goal`, key `current` — overwritten on every change.
 *
 * The goal is just a string (no vector index needed at this layer).
 * Step 19's "similar past goals" feature (`SimilarGoals.tsx`) will
 * add a vector-keyed namespace later.
 */

import { getRvfClient } from './client';

const NAMESPACE = 'goal';
const KEY = 'current';

/** Read the persisted goal string. Returns undefined if no row exists. */
export async function getCurrentGoal(): Promise<string | undefined> {
  const client = getRvfClient();
  const entry = await client.get(KEY, { namespace: NAMESPACE });
  // Persisted as `{ goal: "..." }` so future schema additions don't break.
  const v = entry?.value as { goal?: string } | undefined;
  return v?.goal;
}

/** Persist the current goal. */
export async function saveCurrentGoal(goal: string): Promise<void> {
  const client = getRvfClient();
  await client.put({ goal }, { key: KEY, namespace: NAMESPACE });
}

/** Drop the persisted goal (returns to empty on reload). */
export async function clearCurrentGoal(): Promise<void> {
  const client = getRvfClient();
  await client.delete(KEY, { namespace: NAMESPACE });
}
