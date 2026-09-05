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

function fetchWithTls(urlPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'allindiabullion.com',
      port: 443,
      path: urlPath,
      method: 'GET',
      agent: httpsAgent,
      headers: {
        'Host': 'allindiabullion.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-IN,en;q=0.9',
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
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, data });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.setTimeout(8000, () => {
      req.destroy(new Error('Request timeout'));
    });

    req.end();
  });
}

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

  const pathsToTry = [
    `/gold-rate/${stateSlug}/${citySlug}?_t=${Date.now()}`,
    `/gold-rate/${stateSlug}?_t=${Date.now()}`,
    `/gold-rate/gujarat/ahmedabad?_t=${Date.now()}`
  ];

  const debugInfo = [];

  for (const path of pathsToTry) {
    try {
      const response = await fetchWithTls(path);
      debugInfo.push({ path, status: response.status });

      if (response.status !== 200) continue;

      const html = response.data;
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
        debugInfo.push({ path, error: 'RateBoard props not found in HTML' });
      }
    } catch (e) {
      debugInfo.push({ path, error: e.message });
      continue;
    }
  }

  return res.status(500).json({ success: false, error: 'Live market rates could not be fetched', debug: debugInfo });
}
