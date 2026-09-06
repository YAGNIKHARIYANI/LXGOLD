import crypto from 'crypto';

// In-Memory Global Server Cache & Rate Limiting Map
const MEMORY_CACHE = new Map();
const IN_FLIGHT_REQUESTS = new Map();
const RATE_LIMIT_MAP = new Map();
const CACHE_TTL_MS = 6000; // 6 seconds memory cache
const MAX_REQUESTS_PER_MINUTE = 40; // Max requests per IP per minute

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
    try {
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
    } catch (_) {}
  }
  return null;
}

async function fetchFromUpstream(stateSlug, citySlug, state, city) {
  const urlsToTry = [
    `https://allindiabullion.com/gold-rate/${stateSlug}/${citySlug}`,
    `https://proxy.cors.sh/https://allindiabullion.com/gold-rate/${stateSlug}/${citySlug}`,
    `https://allindiabullion.com/gold-rate/${stateSlug}`,
    `https://allindiabullion.com/gold-rate/gujarat/ahmedabad`
  ];

  for (const url of urlsToTry) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        signal: AbortSignal.timeout(4500)
      });

      if (response.ok) {
        const html = await response.text();
        const result = parseRateBoardHtml(html, state, city);
        if (result) return result;
      }
    } catch (e) {
      continue;
    }
  }
  return null;
}

// Security: IP Rate Limiting Guard
function isRateLimited(ip) {
  if (!ip) return false;
  const now = Date.now();
  const windowMs = 60000;
  
  const record = RATE_LIMIT_MAP.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > record.resetAt) {
    record.count = 1;
    record.resetAt = now + windowMs;
  } else {
    record.count++;
  }
  RATE_LIMIT_MAP.set(ip, record);

  // Clean stale IP records periodically
  if (RATE_LIMIT_MAP.size > 2000) {
    for (const [k, v] of RATE_LIMIT_MAP.entries()) {
      if (now > v.resetAt) RATE_LIMIT_MAP.delete(k);
    }
  }

  return record.count > MAX_REQUESTS_PER_MINUTE;
}

export default async function handler(req, res) {
  // 1. Enterprise Security Headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  
  // CORS & Modern Cache Directives for Vercel Edge Network
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-None-Match');
  
  // High-performance Edge CDN caching: Edge caches for 8s, browser caches for 5s, stale-while-revalidate for 30s
  res.setHeader('Cache-Control', 'public, max-age=5, s-maxage=8, stale-while-revalidate=30');
  res.setHeader('CDN-Cache-Control', 'public, s-maxage=8, stale-while-revalidate=30');
  res.setHeader('Vercel-CDN-Cache-Control', 'public, s-maxage=8, stale-while-revalidate=30');

  // 2. HTTP Method Whitelist
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  // 3. Bot & Malicious Scraper Filter
  const userAgent = req.headers['user-agent'] || '';
  if (/sqlmap|nikto|w3af|acunetix|masscan|zgrab/i.test(userAgent)) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  // 4. Rate Limiting Protection
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(clientIp)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ success: false, error: 'Too Many Requests - Rate limit exceeded' });
  }

  // 5. Strict Input Sanitization & Whitelisting
  const query = req.query || {};
  const rawState = String(query.state || 'gujarat').trim();
  const rawCity = String(query.city || 'ahmedabad').trim();

  // Whitelist: letters, numbers, spaces, and hyphens (max 50 chars)
  const inputRegex = /^[a-zA-Z0-9\s\-]{1,50}$/;
  if (!inputRegex.test(rawState) || !inputRegex.test(rawCity)) {
    return res.status(400).json({ success: false, error: 'Invalid input parameters' });
  }

  const state = rawState.toLowerCase();
  const city = rawCity.toLowerCase();
  const stateSlug = state.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const citySlug = city.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const cacheKey = `${stateSlug}_${citySlug}`;

  const now = Date.now();
  const cached = MEMORY_CACHE.get(cacheKey);

  // 6. Check In-Memory Fast Cache
  if (cached && (now - cached.cachedAt < CACHE_TTL_MS)) {
    const clientEtag = req.headers['if-none-match'];
    if (clientEtag && clientEtag === cached.etag) {
      return res.status(304).end();
    }
    res.setHeader('ETag', cached.etag);
    res.setHeader('X-Cache-Status', 'HIT-MEMORY');
    return res.status(200).json(cached.data);
  }

  // 7. Coalesce concurrent requests into a single in-flight Promise (deduplication)
  let fetchPromise = IN_FLIGHT_REQUESTS.get(cacheKey);
  if (!fetchPromise) {
    fetchPromise = fetchFromUpstream(stateSlug, citySlug, state, city)
      .finally(() => {
        IN_FLIGHT_REQUESTS.delete(cacheKey);
      });
    IN_FLIGHT_REQUESTS.set(cacheKey, fetchPromise);
  }

  const result = await fetchPromise;

  if (result) {
    const jsonStr = JSON.stringify(result);
    const etag = `"${crypto.createHash('md5').update(jsonStr).digest('hex').slice(0, 16)}"`;
    
    // Save to memory cache
    MEMORY_CACHE.set(cacheKey, {
      data: result,
      cachedAt: now,
      etag
    });

    const clientEtag = req.headers['if-none-match'];
    if (clientEtag && clientEtag === etag) {
      return res.status(304).end();
    }

    res.setHeader('ETag', etag);
    res.setHeader('X-Cache-Status', 'MISS-SAVED');
    return res.status(200).json(result);
  }

  // If upstream fails but we have stale cache, serve stale cache with 200 rather than failing
  if (cached && cached.data) {
    res.setHeader('ETag', cached.etag);
    res.setHeader('X-Cache-Status', 'STALE-FALLBACK');
    return res.status(200).json(cached.data);
  }

  return res.status(500).json({ success: false, error: 'Live rates feed temporarily unreachable' });
}
