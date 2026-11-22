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
const DEBUG = !!process.env.TP_DEBUG;
const PUB = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.js': 'text/javascript',
  '.css': 'text/css'
};

const cache = new Map();
const hits = new Map();
const searches = new Map();
const offerCache = new Map();
const inflight = new Map();
let clicks = 0;

function setBounded(map, key, val, max = 500) {
  if (!map.has(key) && map.size >= max) {
    const firstKey = map.keys().next().value;
    map.delete(firstKey);
  }
  map.set(key, val);
}

function clientIp(req) {
  const x = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return x || req.socket.remoteAddress || '127.0.0.1';
}

function limited(ip) {
  const now = Date.now();
  const a = (hits.get(ip) || []).filter(t => now - t < 60000);
  a.push(now);
  setBounded(hits, ip, a, 2000);
  return a.length > 30;
}

function json(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(obj));
}

const NAMES = {
  "EK":"Emirates","QR":"Qatar Airways","EY":"Etihad Airways",
  "FZ":"flydubai","G9":"Air Arabia","SV":"Saudia",
  "XY":"flynas","F3":"flyadeal","GF":"Gulf Air",
  "WY":"Oman Air","KU":"Kuwait Airways","RJ":"Royal Jordanian",
  "ME":"Middle East Airlines","LY":"El Al","TK":"Turkish Airlines",
  "PC":"Pegasus","SQ":"Singapore Airlines","TR":"Scoot",
  "MH":"Malaysia Airlines","AK":"AirAsia","D7":"AirAsia X",
  "TG":"Thai Airways","FD":"Thai AirAsia","VN":"Vietnam Airlines",
  "VJ":"VietJet Air","PR":"Philippine Airlines","5J":"Cebu Pacific",
  "GA":"Garuda Indonesia","JT":"Lion Air","CX":"Cathay Pacific",
  "CA":"Air China","MU":"China Eastern","CZ":"China Southern",
  "HU":"Hainan Airlines","BR":"EVA Air","CI":"China Airlines",
  "KE":"Korean Air","OZ":"Asiana Airlines","JL":"Japan Airlines",
  "NH":"ANA","AI":"Air India","6E":"IndiGo","SG":"SpiceJet",
  "IX":"Air India Express","BG":"Biman Bangladesh Airlines",
  "BS":"US-Bangla Airlines","VQ":"Novoair",
  "PK":"Pakistan International Airlines","UL":"SriLankan Airlines",
  "RA":"Nepal Airlines","LH":"Lufthansa","LX":"Swiss",
  "OS":"Austrian Airlines","SN":"Brussels Airlines",
  "AF":"Air France","KL":"KLM","BA":"British Airways",
  "VS":"Virgin Atlantic","IB":"Iberia","VY":"Vueling",
  "AZ":"ITA Airways","TP":"TAP Air Portugal","SK":"SAS",
  "AY":"Finnair","FR":"Ryanair","U2":"easyJet","W6":"Wizz Air",
  "DY":"Norwegian","EI":"Aer Lingus","LO":"LOT Polish Airlines",
  "A3":"Aegean Airlines","EW":"Eurowings","DE":"Condor",
  "FI":"Icelandair","SU":"Aeroflot","ET":"Ethiopian Airlines",
  "MS":"EgyptAir","KQ":"Kenya Airways",
  "SA":"South African Airways","AT":"Royal Air Maroc",
  "WB":"RwandAir","MK":"Air Mauritius","DL":"Delta Air Lines",
  "AA":"American Airlines","UA":"United Airlines",
  "WN":"Southwest Airlines","B6":"JetBlue","AS":"Alaska Airlines",
  "AC":"Air Canada","WS":"WestJet","AM":"Aeromexico",
  "LA":"LATAM Airlines","AV":"Avianca","CM":"Copa Airlines",
  "AR":"Aerolineas Argentinas","G3":"GOL","QF":"Qantas",
  "VA":"Virgin Australia","JQ":"Jetstar","NZ":"Air New Zealand",
  "FJ":"Fiji Airways","3U":"Sichuan Airlines",
  "ZH":"Shenzhen Airlines","MF":"Xiamen Airlines"
};

(async () => {
  try {
    const r = await fetch('https://api.travelpayouts.com/data/en/airlines.json');
    if (r.ok) {
      for (const x of await r.json()) {
        if (x && x.code && x.name && !NAMES[x.code]) {
          NAMES[x.code] = x.name;
        }
      }
    }
  } catch (e) {}
})();

const FALLBACK = {
  USD:1, BDT:122, EUR:0.92, GBP:0.79, AED:3.67,
  SAR:3.75, INR:84, MYR:4.4, SGD:1.34, THB:36,
  QAR:3.64, KWD:0.31, BHD:0.376, OMR:0.385,
  PKR:280, LKR:300, NPR:134, IDR:15800, PHP:57,
  VND:25000, JPY:150, CNY:7.2, KRW:1350, HKD:7.8,
  AUD:1.52, CAD:1.37, NZD:1.65, CHF:0.88,
  TRY:34, EGP:49, ZAR:18, NGN:1500, RUB:92,
  BRL:5.5, MXN:19.5
};

const RATES_URL =
  process.env.RATES_URL ||
  'https://open.er-api.com/v6/latest/USD';

let RATES = { t: 0, live: false, r: FALLBACK };

async function getRates() {
  if (Date.now() - RATES.t < 43200000) return RATES;
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(RATES_URL, { signal: ctl.signal });
    clearTimeout(to);
    const j = await r.json();
    if (j && j.rates && j.rates.BDT) {
      RATES = { t: Date.now(), live: true, r: Object.assign({}, FALLBACK, j.rates) };
      return RATES;
    }
  } catch (e) {}
  RATES = { t: Date.now() - 43200000 + 600000, live: false, r: RATES.r };
  return RATES;
}
async function flights(q) {
  const origin = (q.get('origin') || '').toUpperCase();
  const dest = (q.get('destination') || '').toUpperCase();
  const dep = q.get('date') || '';
  const ret = q.get('return') || '';
  const cur = (q.get('currency') || 'usd').toLowerCase();
  const dateOk = d => /^\d{4}-\d{2}(-\d{2})?$/.test(d);

  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(dest) || origin === dest) {
    return { code: 400, body: { error: 'Enter two different airports.' } };
  }
  if (!dateOk(dep) || (ret && !dateOk(ret))) {
    return { code: 400, body: { error: 'Enter a valid date.' } };
  }
  if (!/^[a-z]{3}$/.test(cur)) {
    return { code: 400, body: { error: 'Invalid currency.' } };
  }
  if (ret && dep.length === 10 && ret.length === 10 && ret < dep) {
    return { code: 400, body: { error: 'The return date must be on or after the departure date.' } };
  }
  if (!TOKEN) {
    return { code: 500, body: { error: 'Server is not configured yet (missing token).' } };
  }

  const p = new URLSearchParams({
    origin,
    destination: dest,
    departure_at: dep,
    sorting: 'price',
    direct: 'false',
    currency: 'usd',
    cy: 'usd',
    limit: '50',
    page: '1',
    unique: 'false',
    one_way: ret ? 'false' : 'true'
  });
  if (ret) p.set('return_at', ret);

  const key = p.toString();
  let v = cache.get(key);

  if (!v || Date.now() - v.t > 600000) {
    try {
      const r = await fetch(BASE + '/aviasales/v3/prices_for_dates?' + key, {
        headers: { 'X-Access-Token': TOKEN }
      });
      if (!r.ok) {
        return { code: 502, body: { error: 'Price provider returned an error (' + r.status + ').' } };
      }
      const j = await r.json();
      v = {
        t: Date.now(),
        currency: String(j.currency || 'usd').toLowerCase(),
        data: Array.isArray(j.data) ? j.data : []
      };
      setBounded(cache, key, v, 500);
    } catch (e) {
      return { code: 502, body: { error: 'Could not reach the price provider.' } };
    }
  }

  const R = await getRates();
  const fromRate = v.currency === 'usd' ? 1 : R.r[v.currency.toUpperCase()];
  const toRate = R.r[cur.toUpperCase()];
  if (!fromRate || !toRate) {
    return {
      code: 400,
      body: {
        error: 'The selected currency is not supported. Please choose another currency.',
        requested: cur
      }
    };
  }

  const mul = toRate / fromRate;
  const monthOrDateMatches = (value, requested) => {
    if (!requested) return true;
    const actual = String(value || '').slice(0, 10);
    return requested.length === 7 ? actual.slice(0, 7) === requested : actual === requested;
  };

  const out = v.data.filter(f => {
    if (typeof f.transfers === 'number' && f.transfers > 1) return false;
    if (!monthOrDateMatches(f.departure_at, dep)) return false;
    if (
      ret &&
      (!monthOrDateMatches(f.return_at, ret) ||
        String(f.return_at || '').slice(0, 10) < String(f.departure_at || '').slice(0, 10))
    ) {
      return false;
    }
    return true;
  }).map(f => Object.assign({}, f, {
    price: Math.round(Number(f.price) * mul),
    airline_name: NAMES[f.airline] || f.airline || ''
  }));

  return {
    code: 200,
    body: {
      currency: cur,
      requested: cur,
      converted: v.currency !== cur,
      rates: R.live ? 'live' : 'approximate',
      data: out
    }
  };
}

async function calendar(q) {
  const origin = (q.get('origin') || '').toUpperCase();
  const dest = (q.get('destination') || '').toUpperCase();
  const month = q.get('month') || '';
  const cur = (q.get('currency') || 'usd').toLowerCase();

  if (
    !/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(dest) ||
    origin === dest || !/^\d{4}-\d{2}$/.test(month) || !/^[a-z]{3}$/.test(cur)
  ) {
    return { code: 400, body: { error: 'Invalid request.' } };
  }

  const R = await getRates();
  const toRate = R.r[cur.toUpperCase()];
  if (!toRate) {
    return { code: 400, body: { error: 'The selected currency is not supported.', requested: cur } };
  }

  if (!TOKEN) {
    return { code: 200, body: { currency: cur, prices: {} } };
  }

  const p = new URLSearchParams({
    origin,
    destination: dest,
    depart_date: month,
    calendar_type: 'departure_date',
    currency: 'usd'
  });

  const key = 'cal|' + p.toString();
  let v = cache.get(key);

  if (!v || Date.now() - v.t > 1800000) {
    try {
      const r = await fetch(BASE + '/v1/prices/calendar?' + p.toString(), {
        headers: { 'X-Access-Token': TOKEN }
      });
      if (!r.ok) {
        return { code: 200, body: { currency: cur, prices: {} } };
      }
      const j = await r.json();
      const prices = {};
      const d = j && j.data;
      if (d && typeof d === 'object') {
        for (const k of Object.keys(d)) {
          const e = d[k];
          const day = String(
            /^\d{4}-\d{2}-\d{2}/.test(k) ? k : (e && (e.departure_at || e.depart_date)) || ''
          ).slice(0, 10);
          const pr = typeof e === 'number' ? e : (e && (e.price || e.value));
          if (/^\d{4}-\d{2}-\d{2}$/.test(day) && pr > 0) {
            prices[day] = pr;
          }
        }
      }
      v = { t: Date.now(), prices };
      setBounded(cache, key, v, 500);
    } catch (e) {
      return { code: 200, body: { currency: cur, prices: {} } };
    }
  }

  const prices = {};
  for (const k of Object.keys(v.prices)) {
    prices[k] = Math.round(v.prices[k] * toRate);
  }

  return {
    code: 200,
    body: {
      currency: cur,
      prices,
      converted: toRate !== 1,
      rates: R.live ? 'live' : 'approximate'
    }
  };
}
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
  })).filter(p => p.id && p.price > 0);
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
  setBounded(searches, search_id, { base, t: Date.now() }, 500);

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
      for (const t of (j.tickets || [])) {
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
      setBounded(offerCache, key, c, 500);
    } catch (e) {
      if (DEBUG) console.log('offers error', e.message);
      return { code: 200, body: { live: false, reason: 'unavailable', offers: [] } };
    }
  }

  let matches = c.tickets.filter(t => {
    const out = t.segs[0] && t.segs[0][0];
    if (!out || (airline && out.carrier !== airline)) return false;
    if (dep && out.dep !== dep) return false;
    if (!dep && out.dep.slice(0, 10) !== date) return false;
    if (ret) {
      const back = t.segs[1] && t.segs[1][0];
      if (!back || back.dep.slice(0, 10) !== ret) return false;
    } else if (t.segs.length > 1) {
      return false;
    }
    return true;
  });

  if (!matches.length && airline) {
    matches = c.tickets.filter(t => {
      const out = t.segs[0] && t.segs[0][0];
      return out && out.carrier === airline && out.dep.slice(0, 10) === date;
    });
  }

  const best = new Map();
  for (const t of matches) {
    for (const p of t.proposals) {
      const name = agentName(p.agent_id, c.agents);
      if (!name) continue;
      const k = name.toLowerCase();
      if (!best.has(k) || p.price < best.get(k).usd) {
        best.set(k, { id: p.id, agent: name, usd: p.price });
      }
    }
  }

  const list = Array.from(best.values())
    .sort((a, b) => a.usd - b.usd)
    .slice(0, 10)
    .map(o => ({
      agent: o.agent,
      price: Math.round(o.usd * toRate),
      link: '/go?s=' + encodeURIComponent(c.search_id) +
            '&p=' + encodeURIComponent(o.id) +
            '&ag=' + encodeURIComponent(o.agent)
    }));

  return {
    code: 200,
    body: {
      live: true,
      reason: list.length ? '' : 'no_match',
      currency: cur,
      rates: R.live ? 'live' : 'approximate',
      offers: list
    }
  };
}
async function goAgency(req, res, url) {
  const sid = (url.searchParams.get('s') || '').replace(/[^A-Za-z0-9_-]/g, '');
  const pid = (url.searchParams.get('p') || '').replace(/[^A-Za-z0-9_.:-]/g, '');
  const ag = (url.searchParams.get('ag') || '').slice(0, 80);
  const meta = searches.get(sid);
  const fail = msg => {
    res.writeHead(410, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(msg || 'This booking link has expired. Please search again.');
  };

  if (!sid || !pid || !meta || !TOKEN || !MARKER) return fail();

  try {
    const r = await tp(
      meta.base + '/searches/' + encodeURIComponent(sid) + '/clicks/' + encodeURIComponent(pid),
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
