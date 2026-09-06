import https from 'https';

const ciphers = [
  'TLS_AES_128_GCM_SHA256',
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-RSA-AES128-SHA',
  'ECDHE-RSA-AES256-SHA',
  'AES128-GCM-SHA256',
  'AES256-GCM-SHA384',
  'AES128-SHA',
  'AES256-SHA'
].join(':');

const httpsAgent = new https.Agent({
  ciphers: ciphers,
  honorCipherOrder: true,
  minVersion: 'TLSv1.2',
  maxVersion: 'TLSv1.3'
});

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

function parseRateBoardHtml(html, state, city) {
  if (!html) return null;
  const match = html.match(/component-url="[^"]*RateBoard[^"]*"[^>]*props="([^"]+)"/);
  if (match) {
    const decoded = match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const parsed = JSON.parse(decoded);
    const unwrapped = unwrap(parsed);
    const initial = unwrapped.initial || {};

    if (initial.ref && initial.ref.length > 0) {
      return {
        success: true,
        state,
        city,
        top: initial.top || [],
        ref: initial.ref || [],
        ts: initial.ts || Date.now()
      };
    }
  }
  return null;
}

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
    `https://proxy.cors.sh/https://allindiabullion.com/gold-rate/${stateSlug}/${citySlug}?_t=${Date.now()}`,
    `https://proxy.cors.sh/https://allindiabullion.com/gold-rate/${stateSlug}?_t=${Date.now()}`,
    `https://proxy.cors.sh/https://allindiabullion.com/gold-rate/gujarat/ahmedabad?_t=${Date.now()}`,
    `https://allindiabullion.com/gold-rate/${stateSlug}/${citySlug}?_t=${Date.now()}`
  ];

  for (const url of urlsToTry) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Cache-Control': 'no-cache'
        },
        signal: AbortSignal.timeout(6000)
      });

      if (response.ok) {
        const html = await response.text();
        const result = parseRateBoardHtml(html, state, city);
        if (result) {
          return res.status(200).json(result);
        }
      }
    } catch (e) {
      continue;
    }
  }

  return res.status(500).json({ success: false, error: 'Live rates feed currently unreachable' });
}
