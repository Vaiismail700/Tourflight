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
  "ME": "Middle East Airlines", "LY": "El Al", "TK": "Turkish Airlines",
  "PC": "Pegasus", "SQ": "Singapore Airlines", "TR": "Scoot",
  "MH": "Malaysia Airlines", "AK": "AirAsia", "D7": "AirAsia X",
  "TG": "Thai Airways", "FD": "Thai AirAsia", "VN": "Vietnam Airlines",
  "VJ": "VietJet Air", "PR": "Philippine Airlines", "5J": "Cebu Pacific",
  "GA": "Garuda Indonesia", "JT": "Lion Air", "CX": "Cathay Pacific",
  "CA": "Air China", "MU": "China Eastern", "CZ": "China Southern",
  "HU": "Hainan Airlines", "BR": "EVA Air", "CI": "China Airlines",
  "KE": "Korean Air", "OZ": "Asiana Airlines", "JL": "Japan Airlines",
  "NH": "ANA", "AI": "Air India", "6E": "IndiGo", "SG": "SpiceJet",
  "IX": "Air India Express", "BG": "Biman Bangladesh Airlines",
  "BS": "US-Bangla Airlines", "VQ": "Novoair",
  "PK": "Pakistan International Airlines", "UL": "SriLankan Airlines",
  "RA": "Nepal Airlines", "LH": "Lufthansa", "LX": "Swiss",
  "OS": "Austrian Airlines", "SN": "Brussels Airlines",
  "AF": "Air France", "KL": "KLM", "BA": "British Airways",
  "VS": "Virgin Atlantic", "IB": "Iberia", "VY": "Vueling",
  "AZ": "ITA Airways", "TP": "TAP Air Portugal", "SK": "SAS",
  "AY": "Finnair", "FR": "Ryanair", "U2": "easyJet", "W6": "Wizz Air",
  "DY": "Norwegian", "EI": "Aer Lingus", "LO": "LOT Polish Airlines",
  "A3": "Aegean Airlines", "EW": "Eurowings", "DE": "Condor",
  "FI": "Icelandair", "SU": "Aeroflot", "ET": "Ethiopian Airlines",
  "MS": "EgyptAir", "KQ": "Kenya Airways",
  "SA": "South African Airways", "AT": "Royal Air Maroc",
  "WB": "RwandAir", "MK": "Air Mauritius", "DL": "Delta Air Lines",
  "AA": "American Airlines", "UA": "United Airlines",
  "WN": "Southwest Airlines", "B6": "JetBlue", "AS": "Alaska Airlines",
  "AC": "Air Canada", "WS": "WestJet", "AM": "Aeromexico",
  "LA": "LATAM Airlines", "AV": "Avianca", "CM": "Copa Airlines",
  "AR": "Aerolineas Argentinas", "G3": "GOL", "QF": "Qantas",
  "VA": "Virgin Australia", "JQ": "Jetstar", "NZ": "Air New Zealand",
  "FJ": "Fiji Airways", "3U": "Sichuan Airlines",
  "ZH": "Shenzhen Airlines", "MF": "Xiamen Airlines"
};(async () => {
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
  USD: 1, BDT: 123, EUR: 0.92, GBP: 0.79, AED: 3.67,
  SAR: 3.75, INR: 84, MYR: 4.4, SGD: 1.34, THB: 36,
  QAR: 3.64, KWD: 0.31, BHD: 0.376, OMR: 0.385,
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
      trip_class: w.cabin === 'business' ? 'C
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
