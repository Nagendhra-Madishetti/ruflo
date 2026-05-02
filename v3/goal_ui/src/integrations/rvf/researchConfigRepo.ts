/**
 * researchConfig persistence via the browser RVF backend.
 *
 * Step 18 (ADR-093). Mirrors widgetConfigRepo. Single row in
 * namespace `research-config`, key `default` — overwritten on
 * every preset / setting change.
 *
 * Generic-typed so the consumer's ResearchConfig shape stays
 * authoritative; the repo just persists the JSON value.
 */

import { getRvfClient } from './client';

const NAMESPACE = 'research-config';
const KEY = 'default';

export async function getResearchConfig<T>(): Promise<T | undefined> {
  const client = getRvfClient();
  const entry = await client.get(KEY, { namespace: NAMESPACE });
  return entry?.value as T | undefined;
}

export async function saveResearchConfig<T>(cfg: T): Promise<void> {
  const client = getRvfClient();
  await client.put(cfg, { key: KEY, namespace: NAMESPACE });
}

export async function clearResearchConfig(): Promise<void> {
  const client = getRvfClient();
  await client.delete(KEY, { namespace: NAMESPACE });
}
