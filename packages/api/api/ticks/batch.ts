import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

interface Tick {
  symbol: string;
  bid: number;
  ask: number;
  last?: number;
  volume?: number;
  time?: number;
  source?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { ticks } = (req.body ?? {}) as { ticks: Tick[] };

  if (!Array.isArray(ticks) || ticks.length === 0) {
    return res.status(400).json({ error: 'Body must be { "ticks": [...] }' });
  }

  const rows = ticks.map((t) => ({
    symbol: t.symbol,
    bid: t.bid,
    ask: t.ask,
    last: t.last ?? (t.bid + t.ask) / 2,
    volume: t.volume ?? 0,
    time: t.time,
    source: t.source ?? 'mt5',
    updated_at: new Date().toISOString(),
  }));

  const supaRes = await fetch(`${SUPABASE_URL}/rest/v1/ticks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  });

  if (!supaRes.ok) {
    const error = await supaRes.text();
    return res.status(supaRes.status).json({ error });
  }

  return res.status(200).json({ ok: true, count: rows.length });
}
