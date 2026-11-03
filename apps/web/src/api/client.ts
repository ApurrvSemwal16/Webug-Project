const BASE_URL = '/api';

export interface TestCreateParams {
  url: string;
  goal: string;
  demoMode?: boolean;
}

export async function createTest(params: TestCreateParams) {
  const res = await fetch(`${BASE_URL}/tests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getTest(runId: string) {
  const res = await fetch(`${BASE_URL}/tests/${runId}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listTests() {
  const res = await fetch(`${BASE_URL}/tests`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function stopTest(runId: string) {
  const res = await fetch(`${BASE_URL}/tests/${runId}/stop`, { method: 'POST' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getEvents(runId: string) {
  const res = await fetch(`${BASE_URL}/tests/${runId}/events`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getBugs(runId: string) {
  const res = await fetch(`${BASE_URL}/tests/${runId}/bugs`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getReplay(runId: string) {
  const res = await fetch(`${BASE_URL}/tests/${runId}/replay`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function generateFix(bugId: string) {
  const res = await fetch(`${BASE_URL}/bugs/${bugId}/fix`, { method: 'POST' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function applyFix(bugId: string) {
  const res = await fetch(`${BASE_URL}/bugs/${bugId}/apply`, { method: 'POST' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function verifyFix(runId: string) {
  const res = await fetch(`${BASE_URL}/tests/${runId}/verify`, { method: 'POST' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getHealth() {
  const res = await fetch(`${BASE_URL}/health`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export function createSSEStream(runId: string, onEvent: (type: string, data: unknown) => void): () => void {
  const es = new EventSource(`${BASE_URL}/tests/${runId}/events/stream`);
  const events = [
    'test_started','agent_observing','agent_action','navigation',
    'network_error','console_error','incident_detected','investigation_started',
    'bug_found','test_completed','verification_started','verification_completed','error'
  ];
  events.forEach(ev => {
    es.addEventListener(ev, (e: MessageEvent) => {
      try { onEvent(ev, JSON.parse(e.data)); } catch { onEvent(ev, e.data); }
    });
  });
  es.onerror = () => { /* connection closed or error, ignore */ };
  return () => es.close();
}
