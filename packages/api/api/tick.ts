import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { symbol, bid, ask, last, volume, time, source } = req.body ?? {};

  if (!symbol || bid == null || ask == null) {
    return res.status(400).json({ error: 'Missing required fields: symbol, bid, ask' });
  }

  const row = {
    symbol,
    bid,
    ask,
    last: last ?? (bid + ask) / 2,
    volume: volume ?? 0,
    time,
    source: source ?? 'mt5',
    updated_at: new Date().toISOString(),
  };

  const supaRes = await fetch(`${SUPABASE_URL}/rest/v1/ticks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(row),
  });

  if (!supaRes.ok) {
    const error = await supaRes.text();
    return res.status(supaRes.status).json({ error });
  }

  return res.status(200).json({ ok: true });
}
