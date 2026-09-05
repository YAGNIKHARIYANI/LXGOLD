export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const query = req.query || {};
  const state = query.state || 'gujarat';
  const city = query.city || 'ahmedabad';
  const stateSlug = String(state).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const citySlug = String(city).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  const urlsToTry = [
    `https://allindiabullion.com/gold-rate/${stateSlug}/${citySlug}?_t=${Date.now()}`,
    `https://allindiabullion.com/gold-rate/${stateSlug}?_t=${Date.now()}`,
    `https://allindiabullion.com/gold-rate/gujarat/ahmedabad?_t=${Date.now()}`
  ];

  function unwrap(val) {
    if (Array.isArray(val)) {
      if (val.length === 2 && typeof val[0] === 'number') return unwrap(val[1]);
      return val.map(unwrap);
    } else if (val && typeof val === 'object') {
      const out = {};
      for (const k in val) out[k] = unwrap(val[k]);
      return out;
    }
    return val;
  }

  const browserHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-IN,en-GB;q=0.9,en;q=0.8,hi;q=0.7',
    'Sec-Ch-Ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
  };

  const debugInfo = [];

  for (const url of urlsToTry) {
    try {
      const response = await fetch(url, {
        headers: browserHeaders
      });

      debugInfo.push({ url, status: response.status });

      if (!response.ok) continue;

      const html = await response.text();
      const match = html.match(/component-url="[^"]*RateBoard[^"]*"[^>]*props="([^"]+)"/);
      if (match) {
        const decoded = match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        const parsed = JSON.parse(decoded);
        const unwrapped = unwrap(parsed);
        const initial = unwrapped.initial || {};

        return res.status(200).json({
          success: true,
          state,
          city,
          top: initial.top || [],
          ref: initial.ref || [],
          ts: initial.ts || Date.now()
        });
      } else {
        debugInfo.push({ url, error: 'RateBoard props not found in HTML' });
      }
    } catch (e) {
      debugInfo.push({ url, error: e.message });
      continue;
    }
  }

  return res.status(500).json({ success: false, error: 'Live market rates could not be fetched', debug: debugInfo });
}
