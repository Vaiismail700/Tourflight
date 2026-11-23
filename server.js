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
  "ME": "Middle East Airlines", "MS": "EgyptAir", "TK": "Turkish Airlines",
  "BG": "Biman Bangladesh Airlines", "BS": "US-Bangla Airlines",
  "VQ": "Novoair", "AI": "Air India", "6E": "IndiGo",
  "UK": "Air India Express", "BA": "British Airways", "LH": "Lufthansa",
  "AF": "Air France", "KL": "KLM", "SQ": "Singapore Airlines",
  "MH": "Malaysia Airlines", "TG": "Thai Airways", "CX": "Cathay Pacific"
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
  TRY: 34, EGP: 49
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
  const c = cache.get('rates');
  if (c && Date.now() - c.t < 3600000) return c.v;
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD');
    if (r.ok) {
      const j = await r.json();
      if (j && j.rates && j.rates.USD) {
        const v = { r: j.rates, live: true };
        cache.set('rates', { t: Date.now(), v });
        return v;
      }
    }
  } catch (e) {}
  return { r: FALLBACK, live: false };
}

function convertPrice(amount, fromCur, toCur, ratesObj) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const f = String(fromCur || 'USD').toUpperCase();
  const t = String(toCur || 'USD').toUpperCase();
  if (f === t) return n;
  const r = ratesObj.r || FALLBACK;
  const rf = r[f];
  const rt = r[t];
  if (!rf || !rt) return n;
  return (n / rf) * rt;
}

function linkOf(origin, dest, date, ret) {
  const p = new URLSearchParams({
    origin_iata: origin,
    destination_iata: dest,
    depart_date: date
  });
  if (ret) p.set('return_date', ret);
  if (MARKER) p.set('marker', MARKER);
  return 'https://www.aviasales.com/search?' + p.toString();
}

function normPriceItem(item, origin, dest, retDate, cur, ratesObj) {
  const carrier = String(item.airline || item.carrier || '').toUpperCase();
  const rawPrice = Number(item.price != null ? item.price : item.value);
  const srcCur = String(item.currency || 'USD').toUpperCase();
  const price = Math.round(convertPrice(rawPrice, srcCur, cur, ratesObj));
  const dep = String(item.departure_at || item.depart_date || '').replace(' ', 'T');
  const ret = String(item.return_at || item.return_date || retDate || '').replace(' ', 'T');
  const transfers = typeof item.transfers === 'number'
    ? item.transfers
    : (typeof item.number_of_changes === 'number' ? item.number_of_changes : 0);

  return {
    id: String(item.id || [carrier, origin, dest, dep, price].join('-')),
    airline: carrier,
    airline_name: NAMES[carrier] || item.airline_name || carrier || 'Airline',
    flight_number: item.flight_number || '',
    origin,
    destination: dest,
    origin_airport: item.origin_airport || origin,
    destination_airport: item.destination_airport || dest,
    departure_at: dep,
    return_at: ret || '',
    duration: Number(item.duration || 0),
    duration_to: Number(item.duration_to || item.duration || 0),
    duration_back: Number(item.duration_back || 0),
    transfers,
    return_transfers: typeof item.return_transfers === 'number' ? item.return_transfers : 0,
    price,
    currency: cur.toLowerCase(),
    gate: item.gate || 'Aviasales',
    link: item.link || linkOf(origin, dest, dep.slice(0, 10), ret ? ret.slice(0, 10) : '')
  };
}

async function calendar(q) {
  const origin = (q.get('origin') || '').toUpperCase();
  const dest = (q.get('destination') || '').toUpperCase();
  const month = (q.get('month') || '').slice(0, 7);
  const cur = (q.get('currency') || 'usd').toLowerCase();

  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(dest) || origin === dest || !/^\d{4}-\d{2}$/.test(month) || !/^[a-z]{3}$/.test(cur)) {
    return { code: 400, body: { error: 'Invalid calendar request.' } };
  }
  if (!TOKEN) {
    return { code: 200, body: { currency: cur, prices: {} } };
  }

  const ck = ['cal', origin, dest, month, cur].join('|');
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.t < 900000) return { code: 200, body: hit.v };

  const ratesObj = await getRates();
  const u = BASE + '/v1/prices/calendar?origin=' + encodeURIComponent(origin)
    + '&destination=' + encodeURIComponent(dest)
    + '&month=' + encodeURIComponent(month + '-01')
    + '&currency=USD&token=' + encodeURIComponent(TOKEN);

  const r = await tp(u, {}, 12000);
  const prices = {};
  if (r.ok && r.json && r.json.data && typeof r.json.data === 'object') {
    Object.keys(r.json.data).forEach(dateStr => {
      const it = r.json.data[dateStr];
      const raw = it && (it.price != null ? it.price : it.value);
      if (Number(raw) > 0 && dateStr.startsWith(month)) {
        prices[dateStr] = Math.round(convertPrice(raw, 'USD', cur, ratesObj));
      }
    });
  }

  const body = { currency: cur, prices };
  cache.set(ck, { t: Date.now(), v: body });
  return { code: 200, body };
}

function legDetailOf(l) {
  const c = l.operating_carrier_designator || l.marketing_carrier_designator || {};
  const carrier = String(c.carrier || l.carrier || '').toUpperCase();
  const num = String(l.flight_number || l.number || '').trim();
  const dep = String(l.local_departure_date_time || l.departure_at || '').replace(' ', 'T');
  const arr = String(l.local_arrival_date_time || l.arrival_at || '').replace(' ', 'T');
  const orig = String(l.origin || l.origin_airport || '').toUpperCase();
  const dest = String(l.destination || l.destination_airport || '').toUpperCase();
  const dur = Number(l.duration || 0);
  return { carrier, num, dep, arr, orig, dest, dur };
}

function normLiveTicket(t, legs, agents, origin, dest, retDate, cur, ratesObj, searchId) {
  const segs = (t.segments || []).map(sg =>
    (sg.flights || [])
      .map(x => typeof x === 'number' ? legs[x] : x)
      .filter(Boolean)
      .map(legDetailOf)
  );
  const outFlights = segs[0] || [];
  const backFlights = segs[1] || [];
  if (!outFlights.length) return [];

  const firstOut = outFlights[0];
  const lastOut = outFlights[outFlights.length - 1];
  const firstBack = backFlights[0] || null;
  const lastBack = backFlights[backFlights.length - 1] || null;

  const carrier = firstOut.carrier || '';
  const transfers = Math.max(0, outFlights.length - 1);
  const retTransfers = backFlights.length > 0 ? Math.max(0, backFlights.length - 1) : 0;

  const layovers = [];
  for (let i = 0; i < outFlights.length - 1; i++) {
    const a = outFlights[i];
    const b = outFlights[i + 1];
    let mins = 0;
    if (a.arr && b.dep) {
      const diff = Math.round((new Date(b.dep).getTime() - new Date(a.arr).getTime()) / 60000);
      if (Number.isFinite(diff) && diff > 0 && diff < 3000) mins = diff;
    }
    layovers.push({ airport: a.dest || b.orig || '', minutes: mins });
  }

  let durTo = Number(t.duration_to || t.total_duration || 0);
  if (!durTo && firstOut.dep && lastOut.arr) {
    const d = Math.round((new Date(lastOut.arr).getTime() - new Date(firstOut.dep).getTime()) / 60000);
    if (Number.isFinite(d) && d > 0 && d < 5000) durTo = d;
  }
  if (!durTo) durTo = outFlights.reduce((s, x) => s + (x.dur || 0), 0);

  let durBack = Number(t.duration_back || 0);
  if (!durBack && firstBack && lastBack && firstBack.dep && lastBack.arr) {
    const d = Math.round((new Date(lastBack.arr).getTime() - new Date(firstBack.dep).getTime()) / 60000);
    if (Number.isFinite(d) && d > 0 && d < 5000) durBack = d;
  }

  const proposals = (t.proposals || []).map(p => {
    const rawP = Number(
      p.price && typeof p.price === 'object'
        ? (p.price.value != null ? p.price.value : p.price.amount)
        : (p.price != null ? p.price : p.unified_price)
    );
    const price = Math.round(convertPrice(rawP, 'USD', cur, ratesObj));
    const agId = String(p.agent_id == null ? '' : p.agent_id);
    return {
      id: String(p.id || ''),
      price,
      gate: agentName(agId, agents) || 'Travel Partner',
      search_id: searchId
    };
  }).filter(p => p.price > 0);

  if (!proposals.length) return [];

  return proposals.map((pr, idx) => ({
    id: [carrier, firstOut.num, firstOut.dep, pr.id || idx].join('-'),
    airline: carrier,
    airline_name: NAMES[carrier] || carrier || 'Airline',
    flight_number: firstOut.num || '',
    origin: firstOut.orig || origin,
    destination: lastOut.dest || dest,
    origin_airport: firstOut.orig || origin,
    destination_airport: lastOut.dest || dest,
    departure_at: firstOut.dep || '',
    return_at: firstBack ? firstBack.dep : (retDate || ''),
    duration: durTo + durBack,
    duration_to: durTo,
    duration_back: durBack,
    transfers,
    return_transfers: retTransfers,
    layovers,
    price: pr.price,
    currency: cur.toLowerCase(),
    gate: pr.gate,
    search_id: searchId
  }));
}

async function fetchCachedFlights(origin, dest, date, ret, cur, ratesObj) {
  const ep = date.length === 7 ? '/v2/prices/month-matrix' : '/v1/prices/cheap';
  const params = new URLSearchParams({
    origin,
    destination: dest,
    currency: 'USD',
    token: TOKEN
  });
  if (date.length === 7) {
    params.set('month', date + '-01');
  } else {
    params.set('depart_date', date);
    if (ret) params.set('return_date', ret);
  }

  const r = await tp(BASE + ep + '?' + params.toString(), {}, 12000);
  const rawList = [];
  if (r.ok && r.json && r.json.data && typeof r.json.data === 'object') {
    if (Array.isArray(r.json.data)) {
      r.json.data.forEach(item => rawList.push(item));
    } else {
      Object.keys(r.json.data).forEach(k => {
        const bucket = r.json.data[k];
        if (bucket && typeof bucket === 'object') {
          Object.keys(bucket).forEach(subKey => {
            const it = Object.assign({}, bucket[subKey]);
            if (!it.departure_at && /^\d{4}-\d{2}-\d{2}$/.test(k)) it.departure_at = k;
            rawList.push(it);
          });
        }
      });
    }
  }

  return rawList
    .filter(it => it && (Number(it.price) > 0 || Number(it.value) > 0))
    .map(it => normPriceItem(it, origin, dest, ret, cur, ratesObj));
}

async function flights(q, ip) {
  const origin = (q.get('origin') || '').toUpperCase();
  const dest = (q.get('destination') || '').toUpperCase();
  const date = (q.get('date') || q.get('depart_date') || '').trim();
  const ret = (q.get('return') || '').trim();
  const cur = (q.get('currency') || 'usd').toLowerCase();
  const cabin = q.get('cabin') === 'business' ? 'business' : 'economy';
  const adults = Math.min(9, Math.max(1, parseInt(q.get('adults') || '1', 10) || 1));
  const children = Math.min(8, Math.max(0, parseInt(q.get('children') || '0', 10) || 0));
  const infants = Math.min(adults, Math.max(0, parseInt(q.get('infants') || '0', 10) || 0));

  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(dest) || origin === dest || !/^\d{4}-\d{2}(-\d{2})?$/.test(date) || !/^[a-z]{3}$/.test(cur)) {
    return { code: 400, body: { error: 'Invalid flight search request.', data: [] } };
  }
  if (!TOKEN) {
    return { code: 200, body: { error: 'TP_TOKEN is not configured on the server.', currency: cur, data: [] } };
  }

  const ck = ['fl2', origin, dest, date, ret, cur, cabin, adults, children, infants].join('|');
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.t < 600000) return { code: 200, body: hit.v };

  const ratesObj = await getRates();
  let data = [];

  if (date.length === 10 && TOKEN && MARKER) {
    const w = { origin, dest, date, ret, cabin, adults, children, infants, currencyCode: 'USD' };
    const skey = [origin, dest, date, ret, cabin, adults, children, infants].join('|');
    try {
      let c = offerCache.get(skey);
      if (!c || Date.now() - c.t > 480000) {
        let pr = inflight.get(skey);
        if (!pr) {
          pr = runSearch(w, ip).finally(() => inflight.delete(skey));
          inflight.set(skey, pr);
        }
        c = await pr;
        offerCache.set(skey, c);
      }
      const legs = [];
      const liveItems = [];
      for (const tk of (c.tickets || [])) {
        liveItems.push(...normLiveTicket(tk, legs, c.agents, origin, dest, ret, cur, ratesObj, c.search_id));
      }
      data = liveItems;
    } catch (e) {
      if (DEBUG) console.log('live search fallback:', e.message);
    }
  }

  if (!data.length) {
    data = await fetchCachedFlights(origin, dest, date, ret, cur, ratesObj);
  }

  const body = { currency: cur, requested: cur, data };
  cache.set(ck, { t: Date.now(), v: body });
  return { code: 200, body };
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
  for (const tk of (c.tickets || [])) {
    const firstLeg = tk.segs && tk.segs[0] && tk.segs[0][0];
    if (airline && firstLeg && firstLeg.carrier && firstLeg.carrier !== airline) continue;
    if (dep && firstLeg && firstLeg.dep && firstLeg.dep !== dep) continue;

    for (const p of (tk.proposals || [])) {
      const converted = Math.round(convertPrice(p.price, 'USD', cur, R));
      if (converted > 0) {
        matched.push({
          agent: agentName(p.agent_id, c.agents) || 'Travel Partner',
          price: converted,
          search_id: c.search_id,
          id: p.id
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
      offers: matched.slice(0, 15)
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
        'indigo.com',
        'skyscanner.net',
        'kayak.com'
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
    const r = await flights(u.searchParams, ip);
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
```[cite: 2]

এটি আপনার `server.js` ফাইলে বসিয়ে সেভ করে সার্ভার রিস্টার্ট করুন[cite: 2]। যদি আপনি ফ্রন্টএন্ডের (`index.html`) পুরো জাভাস্ক্রিপ্ট কোডটিও আলাদা বা পূর্ণাঙ্গভাবে চান, তাহলে বলুন—আমি সেটাও দিয়ে দিচ্ছি[cite: 1]।