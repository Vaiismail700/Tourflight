// Tourflight server: no dependencies, Node 18+
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const TOKEN = (process.env.TP_TOKEN || '').trim();
const MARKER = (process.env.TP_MARKER || '').trim();
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
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

function clientIp(req) {
  const x = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const raw = x || (req.socket && req.socket.remoteAddress) || '127.0.0.1';
  return raw.replace(/^::ffff:/, '');
}

const RELEASE = 'tourflight-popup-search-2026-11-25';
const MARKET = (process.env.TP_MARKET || '').trim().toLowerCase();
const PRICE_ENDPOINT = 'https://api.travelpayouts.com/aviasales/v3/prices_for_dates';

function validDate(value) {
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(value)) return false;
  const day = value.length === 7 ? value + '-01' : value;
  const timestamp = Date.parse(day + 'T00:00:00Z');
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === day;
}

function readSearch(q, isCalendar) {
  const origin = (q.get('origin') || '').trim().toUpperCase();
  const destination = (q.get('destination') || '').trim().toUpperCase();
  const date = (isCalendar ? (q.get('month') || '').trim().slice(0, 7) :
    (q.get('date') || q.get('depart_date') || '').trim());
  const returnDate = isCalendar ? '' : (q.get('return') || q.get('return_date') || '').trim();
  const currency = (q.get('currency') || 'usd').trim().toLowerCase();

  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination) ||
      origin === destination || !validDate(date) || !/^[a-z]{3}$/.test(currency) ||
      (returnDate && (!validDate(returnDate) ||
        (date.length === 10 && returnDate.length !== 10) ||
        returnDate < date.slice(0, returnDate.length)))) return null;

  return { origin, destination, date, returnDate, currency };
}

function stopCount(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

function normalizePrice(item, query) {
  const departure = String(item.departure_at || '');
  const returned = String(item.return_at || '');
  const departureDay = departure.slice(0, 10);
  const returnDay = returned.slice(0, 10);
  const price = Number(item.price);
  if (!validDate(departureDay) || !departureDay.startsWith(query.date) ||
      (query.returnDate ? (!validDate(returnDay) || returnDay < departureDay ||
        !returnDay.startsWith(query.returnDate)) : Boolean(returned)) ||
      (item.expires_at && Date.parse(item.expires_at) <= Date.now()) ||
      !Number.isFinite(price) || price <= 0) return null;

  const airline = String(item.airline || '').toUpperCase();
  const flightNumber = item.flight_number || '';
  const link = /^\/search\/(?!\/)[^\\\s]+$/.test(item.link || '') ? item.link : '';
  return {
    id: [airline, flightNumber, query.origin, query.destination, departure, returned, price].join('-'),
    airline,
    airline_name: NAMES[airline] || airline || 'Airline',
    flight_number: flightNumber,
    origin: item.origin || query.origin,
    destination: item.destination || query.destination,
    origin_airport: item.origin_airport || query.origin,
    destination_airport: item.destination_airport || query.destination,
    departure_at: departure,
    return_at: returned,
    duration: Number(item.duration || 0),
    duration_to: Number(item.duration_to || 0),
    duration_back: Number(item.duration_back || 0),
    transfers: stopCount(item.transfers),
    return_transfers: stopCount(item.return_transfers),
    outbound_segments: operatingSegments(item.outbound_segments),
    return_segments: operatingSegments(item.return_segments),
    currency: query.currency,
    price,
    gate: 'Aviasales',
    link,
    source: 'aviasales_data',
    indicative: true
  };
}

function operatingSegments(segments) {
  if (!Array.isArray(segments)) return undefined;
  return segments.map(segment => ({
    operating_carrier: typeof segment?.operating_carrier === 'string'
      ? segment.operating_carrier.trim().toUpperCase() : ''
  }));
}

async function priceSearch(q, isCalendar = false, timeout = 12000) {
  const query = readSearch(q, isCalendar);
  const empty = isCalendar ? { prices: {} } : { data: [] };
  const base = { ...empty, source: 'aviasales_data', indicative: true };
  const fail = (code, status, error, upstreamStatus) => ({
    code,
    body: { ...base, currency: query?.currency, status, error, ...(upstreamStatus && { upstreamStatus }) }
  });

  if (!query) return fail(400, 'invalid_query', 'Invalid route, date or currency.');
  if (!TOKEN) return fail(503, 'not_configured', 'Flight price service is not configured.');
  if (MARKET && !/^[a-z]{2}$/.test(MARKET)) {
    return fail(503, 'not_configured', 'Flight price market is misconfigured.');
  }

  const { origin, destination, date, returnDate, currency } = query;
  const requestUrl = new URL(PRICE_ENDPOINT);
  requestUrl.search = new URLSearchParams({
    origin, destination, departure_at: date, one_way: String(!returnDate),
    currency, sorting: 'price', direct: 'false', unique: 'false', limit: '1000', page: '1'
  });
  if (returnDate) requestUrl.searchParams.set('return_at', returnDate);
  if (MARKET) requestUrl.searchParams.set('market', MARKET);
  const key = (isCalendar ? 'calendar|' : 'flights|') + requestUrl.href;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return { code: 200, body: hit.body };

  let reply;
  let payload;
  try {
    reply = await fetch(requestUrl, {
      headers: { 'X-Access-Token': TOKEN, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(timeout)
    });
    if (reply.ok) payload = await reply.json();
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return fail(504, 'upstream_timeout', 'Flight price service timed out.');
    }
    return fail(502, reply ? 'upstream_payload' : 'upstream_network',
      'Flight price service could not return valid data.', reply?.status);
  }

  if (!reply.ok) {
    const status = reply.status === 401 || reply.status === 403 ? 'upstream_auth' :
      reply.status === 429 ? 'upstream_rate_limit' : 'upstream_http';
    console.warn('Aviasales Data API', status, reply.status);
    return fail(reply.status === 429 ? 503 : 502, status,
      'Flight price service is temporarily unavailable.', reply.status);
  }

  if (payload?.success !== true || !Array.isArray(payload.data)) {
    return fail(502, 'upstream_payload', 'Flight price service returned an unexpected response.', reply.status);
  }

  const upstreamCurrency = payload.currency || payload.data.find(item => item?.currency)?.currency;
  if (upstreamCurrency && String(upstreamCurrency).toLowerCase() !== currency) {
    return fail(502, 'upstream_currency', 'Flight price service returned a different currency.', reply.status);
  }

  let data = payload.data.filter(Boolean).map(item => normalizePrice(item, query))
    .filter(Boolean).sort((a, b) => a.price - b.price);
  // The provider can have fares in a month query even when the date query is empty.
  // Reuse only fares that satisfy the original dates.
  let recoveredFromMonth = 0;
  if (!isCalendar && date.length === 10 && data.length < 2) {
    const monthQuery = new URLSearchParams(q);
    monthQuery.set('date', date.slice(0, 7));
    if (returnDate) monthQuery.set('return', returnDate.slice(0, 7));
    const month = await priceSearch(monthQuery, false, 2500);
    if (month.code === 200) {
      const exact = month.body.data.filter(flight =>
        flight.departure_at.slice(0, 10) === date &&
        (!returnDate || flight.return_at.slice(0, 10) === returnDate));
      const fares = new Map(data.map(flight => [flight.id, flight]));
      for (const flight of exact) {
        if (!fares.has(flight.id)) {
          fares.set(flight.id, flight);
          recoveredFromMonth++;
        }
      }
      data = Array.from(fares.values()).sort((a, b) => a.price - b.price);
    }
  }

  const prices = {};
  if (isCalendar) {
    for (const flight of data) {
      const day = flight.departure_at.slice(0, 10);
      prices[day] = Math.min(prices[day] ?? Infinity, flight.price);
    }
  }

  const body = {
    ...base, currency, requested: currency, status: data.length ? 'ok' : 'no_cached_prices',
    diagnostics: { received: payload.data.length, returned: data.length, recoveredFromMonth },
    ...(isCalendar ? { prices } : { data })
  };
  if (data.length) {
    if (cache.size >= 250) cache.delete(cache.keys().next().value);
    cache.set(key, { body, expires: Date.now() + 120000 });
  }
  return { code: 200, body };
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
    } else {
      target = new URL(raw);
      if (target.protocol !== 'https:') throw new Error('HTTPS required');
      if (target.username || target.password) throw new Error('Credentials not allowed');
      const host = target.hostname.toLowerCase();
      const allowedHosts = [
        'aviasales.com', 'expedia.com', 'booking.com', 'trip.com', 'agoda.com',
        'priceline.com', 'orbitz.com', 'travelocity.com', 'skyscanner.net', 'kayak.com',
        'momondo.com', 'kiwi.com', 'cheapoair.com', 'hopper.com', 'edreams.com',
        'makemytrip.com', 'cleartrip.com', 'easemytrip.com', 'yatra.com', 'ixigo.com',
        'sastaticket.pk', 'bookme.pk', 'sharetrip.net', 'gozayaan.com', 'musafir.com',
        'almosafer.com', 'rehlat.com', 'cleartrip.ae', 'dnatatravel.com', 'tajawal.com',
        'flyin.com', 'traveloka.com', 'tiket.com', 'airasia.com', 'klook.com',
        'ctrip.com', 'fliggy.com', '12go.asia', 'lastminute.com', 'esky.com',
        'gotogate.com', 'mytrip.com', 'flightnetwork.com', 'alternativeairlines.com',
        'cheaptickets.com', 'flightcentre.com', 'despegar.com', 'onetravel.com',
        'biman-airlines.com', 'usbair.com', 'airindia.com', 'goindigo.in',
        'piac.com.pk', 'nepalairlines.com.np', 'srilankan.com', 'emirates.com',
        'etihad.com', 'flydubai.com', 'airarabia.com', 'saudia.com',
        'qatarairways.com', 'omanair.com', 'gulfair.com', 'kuwaitairways.com',
        'flynas.com', 'malaysiaairlines.com', 'singaporeair.com', 'thaiairways.com',
        'garuda-indonesia.com', 'airchina.com', 'ceair.com', 'csair.com',
        'maldivian.aero', 'britishairways.com', 'lufthansa.com', 'airfrance.com',
        'aa.com', 'united.com', 'enuygun.com', 'obilet.com', 'turna.com',
        'biletall.com', 'tatilbudur.com', 'setur.com.tr', 'jollytur.com',
        'tatilsepeti.com', 'turkishairlines.com', 'flypgs.com', 'ajet.com',
        'sunexpress.com', 'corendonairlines.com', 'freebirdairlines.com',
        'wakanow.com', 'travelstart.co.za', 'travelstart.com.ng', 'flightsite.co.za',
        'flightcentre.co.za', 'tix.africa', 'travelwings.com', 'justfly.com',
        'cheapflights.com', 'almatar.com', 'travco.com', 'holidayme.com',
        'wego.com.eg', 'ethiopianairlines.com', 'egyptair.com', 'kenya-airways.com',
        'royalairmaroc.com', 'flysaa.com', 'airalgerie.dz', 'tunisair.com',
        'rwandair.com', 'flyairsenegal.com', 'taag.com', 'airmauritius.com',
        'ugandairlines.com', 'flysafair.co.za', 'flyairpeace.com', 'fastjet.com',
        'aircairo.com', 'nileair.com', 'nesmaairlines.com'
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
      markerSet: Boolean(MARKER),
      liveOffers: false,
      mode: 'data',
      release: RELEASE
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
    const r = await priceSearch(u.searchParams, true);
    return json(res, r.code, r.body);
  }

  if (u.pathname === '/api/flights') {
    if (limited(ip)) {
      return json(res, 429, { error: 'Too many requests. Please wait a minute.' });
    }
    const r = await priceSearch(u.searchParams);
    return json(res, r.code, r.body);
  }

  if (u.pathname === '/search-provider' && req.method === 'GET') {
    const query = readSearch(u.searchParams, false);
    if (!query || query.date.length !== 10) {
      return json(res, 400, { error: 'Select a valid route and travel dates.' });
    }
    const { origin, destination, date, returnDate, currency } = query;
    const passenger = (key, fallback) => {
      const value = u.searchParams.get(key) || fallback;
      return /^[0-9]$/.test(value) ? value : fallback;
    };
    const adults = passenger('adults', '1') === '0' ? '1' : passenger('adults', '1');
    const children = passenger('children', '0');
    const infants = String(Math.min(Number(adults), Number(passenger('infants', '0'))));
    const cabin = u.searchParams.get('cabin') === 'business' ? 'c' : '';
    const compact = day => day.slice(8, 10) + day.slice(5, 7);
    const party = adults + (infants !== '0' ? children + infants : children !== '0' ? children : '');
    const params = origin + compact(date) + destination +
      (returnDate ? compact(returnDate) : '') + cabin + party;
    const target = new URL('https://www.aviasales.com/');
    target.searchParams.set('params', params);
    target.searchParams.set('currency', currency.toUpperCase());
    if (MARKER) target.searchParams.set('marker', MARKER);
    res.writeHead(302, { Location: target.href, 'Cache-Control': 'no-store' });
    return res.end();
  }

  if (u.pathname === '/api/offers') {
    if (limited(ip + '|off')) {
      return json(res, 429, { error: 'Too many requests. Please wait a minute.' });
    }
    return json(res, 200, { live: false, reason: 'data_api_only', offers: [] });
  }

  if (u.pathname === '/go') {
    return json(res, 410, { error: 'Live booking link unavailable. Search again for an Aviasales link.' });
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
}).listen(PORT, '0.0.0.0', () => {
  console.log('Tourflight running on port ' + PORT);
});
