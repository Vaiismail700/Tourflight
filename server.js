// Tourflight server: no dependencies, Node 18+
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TP_TOKEN || '';
const BASE = process.env.TP_BASE || 'https://api.travelpayouts.com';
const MARKER = process.env.TP_MARKER || '';
const SITE_HOST = process.env.TP_HOST || 'tourflight.onrender.com';
const SEARCH_BASE = process.env.TP_SEARCH_BASE || 'https://tickets-api.travelpayouts.com';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const DEBUG = !!process.env.TP_DEBUG;
const PUB = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8'
};

const cache = new Map();
const hits = new Map();
const searches = new Map();
const offerCache = new Map();
const inflight = new Map();
let clicks = 0;

function limited(ip) {
  const now = Date.now();
  const a = (hits.get(ip) || []).filter(t => now - t < 60000);
  a.push(now);
  hits.set(ip, a);
  return a.length > 30;
}

function setCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return;
  if (!ALLOWED_ORIGINS.length || ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}

function json(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(obj));
}

const NAMES = {
  "EK": "Emirates", "QR": "Qatar Airways", "EY": "Etihad Airways",
  "FZ": "flydubai", "G9": "Air Arabia", "SV": "Saudia",
  "XY": "flynas", "F3": "flyadeal", "GF": "Gulf Air",
  "WY": "Oman Air", "KU": "Kuwait Airways", "RJ": "Royal Jordanian",
  "ME": "Middle East Airlines", "BG": "Biman Bangladesh Airlines",
  "BS": "US-Bangla Airlines", "VQ": "Novoair", "AI": "Air India",
  "6E": "IndiGo", "UK": "Vistara", "SG": "SpiceJet", "AK": "AirAsia",
  "MH": "Malaysia Airlines", "SQ": "Singapore Airlines", "TG": "Thai Airways",
  "CX": "Cathay Pacific", "TK": "Turkish Airlines", "BA": "British Airways",
  "AF": "Air France", "KL": "KLM", "LH": "Lufthansa", "LX": "SWISS"
};

(async () => {
  try {
    const r = await fetch('https://api.travelpayouts.com/data/en/airlines.json');
    if (r.ok) {
      const list = await r.json();
      if (Array.isArray(list)) {
        for (const x of list) {
          if (x && x.code && x.name && !NAMES[x.code]) {
            NAMES[x.code] = x.name;
          }
        }
      }
    }
  } catch (e) {
    if (DEBUG) console.log('Airlines preload failed:', e.message);
  }
})();

const FALLBACK = {
  USD: 1, BDT: 122, EUR: 0.92, GBP: 0.79, AED: 3.67,
  SAR: 3.75, INR: 84, MYR: 4.4, SGD: 1.34, THB: 36,
  QAR: 3.64, KWD: 0.31, BHD: 0.376, OMR: 0.385,
  PKR: 280, LKR: 300, NPR: 134, IDR: 15800, PHP: 57,
  VND: 25000, JPY: 150, CNY: 7.2, KRW: 1350, HKD: 7.8,
  AUD: 1.52, CAD: 1.37, NZD: 1.65, CHF: 0.88,
  TRY: 34, EGP: 49, ZAR: 18, NGN: 1600, RUB: 95,
  BRL: 5.5, MXN: 18
};

const md5 = x => crypto.createHash('md5').update(x).digest('hex');

function flat(o) {
  if (Array.isArray(o)) return o.flatMap(flat);
  if (o && typeof o === 'object') {
    return Object.keys(o).sort().flatMap(k => flat(o[k]));
  }
  return [String(o)];
}

function sign(body) {
  const b = Object.assign({}, body);
  delete b.signature;
  delete b.marker;
  return md5([TOKEN, MARKER].concat(flat(b)).join(':'));
}

function clientIp(req) {
  const x = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const raw = x || (req.socket && req.socket.remoteAddress) || '127.0.0.1';
  return raw.replace(/^::ffff:/, '');
}

async function tp(url, opt, ms) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), ms || 15000);
  try {
    const r = await fetch(url, Object.assign({ signal: ctl.signal }, opt));
    const txt = await r.text();
    let j = null;
    try { j = JSON.parse(txt); } catch (e) {}
    if (DEBUG && !r.ok) {
      console.log('TP', r.status, url.split('?')[0], txt.slice(0, 300));
    }
    return { ok: r.ok, status: r.status, json: j };
  } finally {
    clearTimeout(to);
  }
}

function tpHeaders(ip, body) {
  const h = {
    'content-type': 'application/json',
    'x-affiliate-user-id': TOKEN,
    'x-real-host': SITE_HOST,
    'x-user-ip': ip
  };
  h['x-signature'] = body ? sign(body) : md5(TOKEN + ':' + MARKER);
  return h;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getRates() {
  const key = 'fx_rates';
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < 3600000) return hit.v;
  try {
    const r = await tp('https://open.er-api.com/v6/latest/USD', {}, 8000);
    if (r.ok && r.json && r.json.rates && typeof r.json.rates === 'object') {
      const merged = Object.assign({}, FALLBACK, r.json.rates);
      const val = { t: Date.now(), r: merged };
      cache.set(key, val);
      return val;
    }
  } catch (e) {
    if (DEBUG) console.log('FX error:', e.message);
  }
  const fb = { t: Date.now(), r: FALLBACK };
  cache.set(key, fb);
  return fb;
}

function legOf(l) {
  const c = l.operating_carrier_designator || l.marketing_carrier_designator || {};
  return {
    carrier: String(c.carrier || l.carrier || '').toUpperCase(),
    dep: String(l.local_departure_date_time || l.departure_at || '')
      .replace(' ', 'T').slice(0, 16)
  };
}

function normTicket(t, legs) {
  const segs = (t.segments || []).map(sg =>
    (sg.flights || [])
      .map(x => typeof x === 'number' ? legs[x] : x)
      .filter(Boolean)
      .map(legOf)
  );
  const proposals = (t.proposals || []).map(p => ({
    id: String(p.id || ''),
    agent_id: String(p.agent_id == null ? '' : p.agent_id),
    price: Number(
      p.price && typeof p.price === 'object'
        ? (p.price.value != null ? p.price.value : p.price.amount)
        : (p.price != null ? p.price : p.unified_price)
    )
  })).filter(p => p.id && Number.isFinite(p.price) && p.price > 0);
  return { segs, proposals };
}

async function runSearch(w, ip) {
  const directions = [{ origin: w.origin, destination: w.dest, date: w.date }];
  if (w.ret) directions.push({ origin: w.dest, destination: w.origin, date: w.ret });

  const body = {
    marker: MARKER,
    locale: 'en',
    currency_code: w.currencyCode || 'USD',
    search_params: {
      trip_class: w.cabin === 'business' ? 'C' : 'Y',
      passengers: {
        adults: w.adults || 1,
        children: w.children || 0,
        infants: w.infants || 0
      },
      directions
    }
  };
  body.signature = sign(body);

  const st = await tp(SEARCH_BASE + '/search/affiliate/start', {
    method: 'POST',
    headers: tpHeaders(ip, body),
    body: JSON.stringify(body)
  });

  if (!st.ok || !st.json || !st.json.search_id || !st.json.results_url) {
    throw new Error('start failed ' + st.status);
  }

  const search_id = String(st.json.search_id);
  const ru = String(st.json.results_url);
  const base = new URL(/^https?:/i.test(ru) ? ru : 'https://' + ru).origin;
  searches.set(search_id, { base, t: Date.now() });

  const tickets = [];
  const seen = new Map();
  let agents = {};
  let last = 0;
  const t0 = Date.now();

  while (Date.now() - t0 < 20000) {
    const rb = { search_id, last_update_timestamp: last };
    const r = await tp(base + '/search/affiliate/results', {
      method: 'POST',
      headers: tpHeaders(ip, rb),
      body: JSON.stringify(rb)
    });

    if (r.ok && r.json) {
      const j = r.json;
      if (j.agents && typeof j.agents === 'object') {
        agents = Object.assign(agents, j.agents);
      }
      const legs = Array.isArray(j.flight_legs) ? j.flight_legs : [];
      for (const t of (Array.isArray(j.tickets) ? j.tickets : [])) {
        const key = String(t.id || t.signature || tickets.length);
        const nt = normTicket(t, legs);
        if (seen.has(key)) {
          const old = seen.get(key);
          const ids = new Map(old.proposals.map(x => [x.id, x]));
          nt.proposals.forEach(x => ids.set(x.id, x));
          old.proposals = Array.from(ids.values());
          if (!old.segs.length) old.segs = nt.segs;
          continue;
        }
        seen.set(key, nt);
        tickets.push(nt);
      }
      if (j.last_update_timestamp) last = j.last_update_timestamp;
      if (j.is_over) break;
    } else if (r.status >= 400 && r.status !== 304) {
      throw new Error('results failed ' + r.status);
    }
    await sleep(1500);
  }

  return { t: Date.now(), search_id, tickets, agents };
}

function agentName(id, agents) {
  const a = agents && agents[id];
  if (a && typeof a === 'object') {
    return String(
      a.label || a.name || a.gate_name || a.title || a.short_name || ''
    ).trim();
  }
  return typeof a === 'string' ? a.trim() : '';
}

async function calendar(q) {
  const origin = (q.get('origin') || '').toUpperCase();
  const dest = (q.get('destination') || '').toUpperCase();
  const month = (q.get('month') || '').slice(0, 7);
  const cur = (q.get('currency') || 'usd').toLowerCase();

  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(dest) || origin === dest || !/^\d{4}-\d{2}$/.test(month) || !/^[a-z]{3}$/.test(cur)) {
    return { code: 400, body: { error: 'Invalid calendar query.' } };
  }

  const R = await getRates();
  const toRate = R.r[cur.toUpperCase()];
  if (!toRate) {
    return { code: 400, body: { error: 'The selected currency is not supported.' } };
  }

  const cacheKey = 'cal:' + origin + ':' + dest + ':' + month;
  let rawData = null;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.t < 900000) {
    rawData = hit.v;
  } else if (TOKEN) {
    const u = BASE + '/v1/prices/calendar?origin=' + encodeURIComponent(origin) +
      '&destination=' + encodeURIComponent(dest) +
      '&depart_date=' + encodeURIComponent(month + '-01') +
      '&calendar_type=departure&currency=USD&token=' + encodeURIComponent(TOKEN);
    const r = await tp(u, {}, 12000);
    if (r.ok && r.json && r.json.data && typeof r.json.data === 'object') {
      rawData = r.json.data;
      cache.set(cacheKey, { t: Date.now(), v: rawData });
    }
  }

  const prices = {};
  if (rawData) {
    Object.keys(rawData).forEach(day => {
      if (day.startsWith(month)) {
        const item = rawData[day];
        const usdPrice = Number(item && item.price);
        if (Number.isFinite(usdPrice) && usdPrice > 0) {
          prices[day] = Math.round(usdPrice * toRate);
        }
      }
    });
  }

  return { code: 200, body: { currency: cur, prices } };
}

async function flights(q) {
  const origin = (q.get('origin') || '').toUpperCase();
  const dest = (q.get('destination') || '').toUpperCase();
  const date = (q.get('date') || q.get('depart_date') || '').trim();
  const ret = (q.get('return') || '').trim();
  const reqCur = (q.get('currency') || 'usd').toLowerCase();

  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(dest) || origin === dest || !/^[a-z]{3}$/.test(reqCur)) {
    return { code: 400, body: { error: 'Invalid search parameters.' } };
  }

  const R = await getRates();
  const toRate = R.r[reqCur.toUpperCase()];
  if (!toRate) {
    return { code: 400, body: { error: 'The selected currency is not supported.', requested: reqCur, currency: 'usd' } };
  }

  const cacheKey = 'flt:' + origin + ':' + dest + ':' + date + ':' + ret;
  let items = null;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.t < 600000) {
    items = hit.v;
  } else if (TOKEN) {
    const params = new URLSearchParams({
      origin,
      destination: dest,
      currency: 'USD',
      token: TOKEN
    });
    if (date) params.set('depart_date', date);
    if (ret) params.set('return_date', ret);
    const r = await tp(BASE + '/v1/prices/cheap?' + params.toString(), {}, 12000);
    if (r.ok && r.json && r.json.data && r.json.data[dest]) {
      const byDest = r.json.data[dest];
      items = Object.keys(byDest).map(k => Object.assign({ _slot: k }, byDest[k]));
      cache.set(cacheKey, { t: Date.now(), v: items });
    }
  }

  const out = (items || []).map((it, idx) => {
    const code = String(it.airline || '').toUpperCase();
    const usdPrice = Number(it.price || 0);
    const converted = Number.isFinite(usdPrice) && usdPrice > 0 ? Math.round(usdPrice * toRate) : 0;
    const rawLink = it.link || '';
    const link = rawLink
      ? (rawLink.startsWith('/') ? '/out?link=' + encodeURIComponent(rawLink) + '&src=site1' : rawLink)
      : '';
    return {
      id: String(idx),
      airline: code,
      airline_name: NAMES[code] || code || 'Airline',
      flight_number: it.flight_number || '',
      origin,
      destination: dest,
      departure_at: it.departure_at || (date.length === 10 ? date + 'T00:00:00' : ''),
      return_at: it.return_at || (ret.length === 10 ? ret + 'T00:00:00' : ''),
      duration: it.duration || 0,
      duration_to: it.duration || 0,
      duration_back: 0,
      transfers: typeof it.transfers === 'number' ? it.transfers : 0,
      price: converted,
      currency: reqCur,
      gate: it.gate || 'Aviasales',
      link
    };
  }).filter(f => f.price > 0);

  return {
    code: 200,
    body: {
      currency: reqCur,
      requested: reqCur,
      data: out
    }
  };
}

async function offers(q, ip) {
  const origin = (q.get('origin') || '').toUpperCase();
  const dest = (q.get('destination') || '').toUpperCase();
  const date = (q.get('date') || '').slice(0, 10);
  const ret = (q.get('return') || '').slice(0, 10);
  const cur = (q.get('currency') || 'usd').toLowerCase();
  const cabin = q.get('cabin') === 'business' ? 'business' : 'economy';
  const airline = (q.get('airline') || '').toUpperCase();
  const dep = String(q.get('dep') || '').replace(' ', 'T').slice(0, 16);
  const adults = Math.min(9, Math.max(1, parseInt(q.get('adults') || '1', 10) || 1));
  const children = Math.min(8, Math.max(0, parseInt(q.get('children') || '0', 10) || 0));
  const infants = Math.min(adults, Math.max(0, parseInt(q.get('infants') || '0', 10) || 0));
  const ymd = /^\d{4}-\d{2}-\d{2}$/;

  if (
    !/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(dest) ||
    origin === dest || !ymd.test(date) || (ret && !ymd.test(ret)) ||
    (ret && ret < date) || !/^[a-z]{3}$/.test(cur)
  ) {
    return { code: 400, body: { error: 'Invalid request.' } };
  }

  if (!TOKEN || !MARKER) {
    return { code: 200, body: { live: false, reason: 'not_configured', offers: [] } };
  }

  const R = await getRates();
  const toRate = R.r[cur.toUpperCase()];
  if (!toRate) {
    return { code: 400, body: { error: 'The selected currency is not supported.' } };
  }

  const w = { origin, dest, date, ret, cabin, adults, children, infants, currencyCode: 'USD' };
  const key = [origin, dest, date, ret, cabin, adults, children, infants].join('|');
  let c = offerCache.get(key);

  if (!c || Date.now() - c.t > 480000) {
    try {
      let pr = inflight.get(key);
      if (!pr) {
        pr = runSearch(w, ip).finally(() => inflight.delete(key));
        inflight.set(key, pr);
      }
      c = await pr;
      offerCache.set(key, c);
    } catch (e) {
      if (DEBUG) console.log('offers error', e.message);
      return { code: 200, body: { live: false, reason: 'unavailable', offers: [] } };
    }
  }

  const matched = [];
  for (const t of (c.tickets || [])) {
    const firstLeg = t.segs && t.segs[0] && t.segs[0][0];
    if (airline && firstLeg && firstLeg.carrier && firstLeg.carrier !== airline) continue;
    if (dep && firstLeg && firstLeg.dep && firstLeg.dep !== dep) continue;

    for (const p of (t.proposals || [])) {
      const agent = agentName(p.agent_id, c.agents) || 'Travel Partner';
      const price = Math.round(p.price * toRate);
      if (price > 0) {
        matched.push({
          id: p.id,
          search_id: c.search_id,
          agent,
          price,
          currency: cur
        });
      }
    }
  }

  matched.sort((a, b) => a.price - b.price);
  return {
    code: 200,
    body: {
      live: matched.length > 0,
      currency: cur,
      offers: matched.slice(0, 20)
    }
  };
}

async function goAgency(req, res, url) {
  const sid = (url.searchParams.get('s') || '').replace(/[^A-Za-z0-9_-]/g, '');
  const pid = (url.searchParams.get('p') || '').replace(/[^A-Za-z0-9_.:-]/g, '');
  const ag = (url.searchParams.get('ag') || '').slice(0, 80);
  const src = (url.searchParams.get('src') || url.searchParams.get('ref') || 'site1')
    .replace(/[^A-Za-z0-9._-]/g, '')
    .slice(0, 40);
  const meta = searches.get(sid);
  const fail = msg => {
    res.writeHead(410, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(msg || 'This booking link has expired. Please search again.');
  };

  if (!sid || !pid || !meta || !TOKEN || !MARKER) return fail();

  try {
    const r = await tp(
      meta.base + '/searches/' + sid + '/clicks/' + pid,
      { headers: tpHeaders(clientIp(req)) }
    );
    const j = r.json || {};
    const raw = j.url || j.click_url || j.redirect_url || '';
    const target = new URL(raw);
    if (!r.ok || target.protocol !== 'https:' || target.username || target.password) {
      return fail();
    }
    clicks++;
    console.log(JSON.stringify({
      click: clicks,
      at: new Date().toISOString(),
      src,
      agent: ag,
      host: target.hostname
    }));
    res.writeHead(302, { Location: target.toString(), 'Cache-Control': 'no-store' });
    return res.end();
  } catch (e) {
    return fail();
  }
}

function bookingRedirect(req, res, url) {
  const raw = url.searchParams.get('link') || '';
  const src = (url.searchParams.get('src') || url.searchParams.get('ref') || 'site1')
    .replace(/[^A-Za-z0-9._-]/g, '')
    .slice(0, 40);
  let target;

  try {
    if (raw.startsWith('/')) {
      if (raw.startsWith('//') || /[\s\\\u0000-\u001f]/.test(raw) || raw.length > 1500) {
        throw new Error('Invalid relative URL');
      }
      target = new URL(raw, 'https://www.aviasales.com');
      if (target.hostname !== 'www.aviasales.com') {
        throw new Error('Invalid host');
      }
      if (MARKER && !target.searchParams.has('marker')) {
        target.searchParams.set('marker', MARKER);
      }
    } else {
      target = new URL(raw);
      if (target.protocol !== 'https:') throw new Error('HTTPS required');
      if (target.username || target.password) throw new Error('Credentials not allowed');
      const host = target.hostname.toLowerCase();
      const allowedHosts = [
        'aviasales.com',
        'trip.com',
        'wingie.com',
        'goindigo.in',
        'indigo.com'
      ];
      const allowed = allowedHosts.some(domain => host === domain || host.endsWith('.' + domain));
      if (!allowed) throw new Error('Provider domain not allowed');
    }
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Invalid booking link');
  }

  clicks++;
  console.log(JSON.stringify({
    click: clicks,
    at: new Date().toISOString(),
    src,
    host: target.hostname
  }));

  res.writeHead(302, {
    Location: target.toString(),
    'Cache-Control': 'no-store'
  });
  return res.end();
}

http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  let u;
  try {
    u = new URL(req.url, 'http://localhost');
  } catch (e) {
    res.writeHead(400);
    return res.end('Bad request');
  }

  const ip = clientIp(req);

  if (u.pathname === '/health') {
    return json(res, 200, {
      ok: true,
      tokenSet: !!TOKEN,
      liveOffers: !!(TOKEN && MARKER)
    });
  }

  if (u.pathname === '/adclick') {
    console.log(JSON.stringify({
      adclick: (u.searchParams.get('id') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40),
      at: new Date().toISOString()
    }));
    res.writeHead(204);
    return res.end();
  }

  if (u.pathname === '/api/calendar') {
    if (limited(ip + '|cal')) {
      return json(res, 429, { error: 'Too many requests. Please wait a minute.' });
    }
    const r = await calendar(u.searchParams);
    return json(res, r.code, r.body);
  }

  if (u.pathname === '/api/flights') {
    if (limited(ip)) {
      return json(res, 429, { error: 'Too many requests. Please wait a minute.' });
    }
    const r = await flights(u.searchParams);
    return json(res, r.code, r.body);
  }

  if (u.pathname === '/api/offers') {
    if (limited(ip + '|off')) {
      return json(res, 429, { error: 'Too many requests. Please wait a minute.' });
    }
    const r = await offers(u.searchParams, ip);
    return json(res, r.code, r.body);
  }

  if (u.pathname === '/go') {
    return goAgency(req, res, u);
  }

  if (u.pathname === '/out') {
    return bookingRedirect(req, res, u);
  }

  let f;
  try {
    f = path.resolve(PUB, '.' + decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
  } catch (e) {
    res.writeHead(400);
    return res.end('Bad request');
  }

  if (f !== PUB && !f.startsWith(PUB + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(f, (e, d) => {
    if (e) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(f)] || 'application/octet-stream'
    });
    res.end(d);
  });
}).listen(PORT, () => {
  console.log('Tourflight running on port ' + PORT);
});
