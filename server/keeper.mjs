import http from 'node:http';
import { randomUUID } from 'node:crypto';

const KEY = process.env.CREAO_API_KEY;
const AGENT_ID = process.env.CREAO_AGENT_ID;
const BASE = 'https://agent.creao.ai';
const PORT = 8787;
const ALLOWED_ORIGINS = new Set(['http://localhost:5173', 'http://localhost:5174']);
const MAX_BODY = 20_000;
const MAX_IN_FLIGHT = 3;

if (!KEY || !AGENT_ID) {
  console.error('Missing CREAO_API_KEY or CREAO_AGENT_ID. Put them in .env.server and start with:');
  console.error('node --env-file=.env.server server/keeper.mjs');
  process.exit(1);
}

let inFlight = 0;
const oppCache = new Map();

// The agent's text can hold several JSON blocks (a run summary, then the result,
// sometimes printed twice). Scan every balanced {...} block and keep the first
// one that has an "action" field, since that is the keeper's real answer.
function findKeeperJson(text) {
  let loose = null;
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf('{', i);
    if (start < 0) return loose;
    let depth = 0;
    let inStr = false;
    let esc = false;
    let end = -1;
    for (let j = start; j < text.length; j++) {
      const c = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end < 0) return loose;
    try {
      const obj = JSON.parse(text.slice(start, end + 1));
      if (obj && typeof obj === 'object') {
        if (typeof obj.action === 'string') return obj;
        // Fallback: a block that clearly holds the keeper's answer but lacks "action".
        if (!loose && (Array.isArray(obj.items) || typeof obj.cleanedText === 'string' || typeof obj.crisisMessage === 'string')) {
          loose = obj;
        }
      }
    } catch {
      // not valid JSON, keep scanning
    }
    i = start + 1;
  }
  return loose;
}

async function creao(path, init = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Creao responded ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Retries when Creao says "too many requests", waiting longer each time.
async function creaoRetry(path, init) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await creao(path, init);
    } catch (err) {
      if (err.status !== 429 || attempt >= 4) throw err;
      await sleep(3000 * (attempt + 1));
    }
  }
}

async function runKeeper(payload) {
  const started = await creaoRetry('/api/v1/runs', {
    method: 'POST',
    body: JSON.stringify({
      appId: AGENT_ID,
      inputs: { prompt: JSON.stringify(payload) },
      idempotencyKey: randomUUID(),
    }),
  });
  const id = started.id;
  if (!id) throw new Error('No run id returned');
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    await sleep(2500);
    const run = await creaoRetry(`/api/v1/runs/${id}`);
    if (run.status === 'completed') {
      const r = run.result ?? {};
      const sources = [r.text, r.chatText, JSON.stringify(r)].filter(x => typeof x === 'string');
      for (const src of sources) {
        const parsed = findKeeperJson(src);
        if (parsed) return parsed;
      }
      // Show the start of what the agent said (never the API key) so the cause is visible.
      console.error('agent replied with:', String(r.text ?? r.chatText ?? JSON.stringify(r)).slice(0, 500));
      throw new Error('The keeper returned no result block');
    }
    if (run.status === 'failed' || run.status === 'cancelled') {
      throw new Error(`The keeper run ${run.status}`);
    }
  }
  throw new Error('The keeper timed out');
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

function buildPayload(body) {
  const mode = body.mode === 'find_opportunities' ? 'find_opportunities' : body.mode === 'match' ? 'match' : null;
  if (!mode) return null;
  const m = body.member && typeof body.member === 'object' ? body.member : {};
  const candidates = Array.isArray(body.candidates)
    ? body.candidates.slice(0, 20).map(c => ({
        name: str(c?.name, 60),
        skills: str(c?.skills, 200),
        goals: str(c?.goals, 200),
      }))
    : [];
  const today = new Date().toISOString().slice(0, 10);
  const out = {
    mode,
    member: { name: str(m.name, 60), skills: str(m.skills, 200), goals: str(m.goals, 200) },
    raw_post: str(body.raw_post, 600),
    candidates,
    interests: str(body.interests, 200),
  };
  if (mode === 'find_opportunities') {
    out.today = today;
    out.rules =
      `Today is ${today}. Only return opportunities that are still open on or after today, ` +
      'or that are rolling with no closing date. Never return anything whose deadline, season or year is before today. ' +
      'Prefer the next upcoming cycle. If you are not sure it is current, leave it out. Do not use the member name in the text. ' +
      'Be fast: return at most 3 items, use no more than 3 web searches, and keep each whyItFits under 200 characters.';
  }
  return out;
}

// Safety net: even if the agent returns stale results, drop anything dated in the past.
function dropExpired(items) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const startOfToday = new Date(now.toISOString().slice(0, 10) + 'T00:00:00Z');
  return items.filter(it => {
    const text = `${it?.title ?? ''} ${it?.deadline ?? it?.date ?? ''}`;
    const years = [...text.matchAll(/\b(20\d{2})\b/g)].map(x => Number(x[1]));
    if (years.length > 0 && Math.max(...years) < year) return false;
    // A "Summer <this year>" program is over once summer has ended (after August).
    const summer = text.match(/summer\s*(20\d{2})/i);
    if (summer && Number(summer[1]) === year && now.getUTCMonth() >= 8) return false;
    const parsed = Date.parse(String(it?.deadline ?? it?.date ?? '').replace(/\(.*?\)/g, '').trim());
    if (!Number.isNaN(parsed) && parsed < startOfToday.getTime()) return false;
    return true;
  });
}

function send(res, origin, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'http://localhost:5173',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  });
  res.end(JSON.stringify(obj));
}

http
  .createServer((req, res) => {
    const origin = req.headers.origin || '';
    if (req.method === 'OPTIONS') return send(res, origin, 204, {});
    if (req.method !== 'POST' || req.url !== '/api/keeper') return send(res, origin, 404, { error: 'not found' });
    if (inFlight >= MAX_IN_FLIGHT) return send(res, origin, 429, { error: 'busy, try again shortly' });

    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) req.destroy();
      else chunks.push(c);
    });
    req.on('end', async () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return send(res, origin, 400, { error: 'bad json' });
      }
      const payload = buildPayload(body);
      if (!payload) return send(res, origin, 400, { error: 'bad mode' });
      // Opportunity searches are slow and the answer barely changes, so remember
      // each one for 30 minutes. A repeat of the same search returns instantly.
      const cacheKey = payload.mode === 'find_opportunities' ? payload.interests.trim().toLowerCase() : null;
      if (cacheKey) {
        const hit = oppCache.get(cacheKey);
        if (hit && Date.now() - hit.at < 30 * 60_000) return send(res, origin, 200, hit.out);
      }
      inFlight++;
      try {
        const out = await runKeeper(payload);
        if (payload.mode === 'find_opportunities' && Array.isArray(out.items)) {
          out.items = dropExpired(out.items);
        }
        if (cacheKey &&Array.isArray(out.items) && out.items.length > 0) {
          oppCache.set(cacheKey, { at: Date.now(), out });
        }
        send(res, origin, 200, out);
      } catch (err) {
        console.error('keeper error:', err.message);
        send(res, origin, 502, { error: 'keeper unavailable' });
      } finally {
        inFlight--;
      }
    });
  })
  .listen(PORT, () => console.log(`Keeper server listening on http://localhost:${PORT}`));
