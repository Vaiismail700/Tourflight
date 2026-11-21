
// Tourflight server: no dependencies, Node 18+
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TP_TOKEN || '';
const BASE = process.env.TP_BASE || 'https://api.travelpayouts.com';
const PUB = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.js': 'text/javascript',
  '.css': 'text/css'
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

// Load additional airline names
(async () => {
  try {
    const r = await fetch('https://api.travelpayouts.com/data/en/airlines.json');
    if (r.ok) {
      for (const x of await r.json()) {
        if (x.code && x.name && !NAMES[x.code]) {
          NAMES[x.code] = x.name;
        }
      }
    }
  } catch (e) {}
})();

// Currency exchange rates
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

let RATES = {
  t: 0,
  live: false,
  r: FALLBACK
};

async function getRates() {
  if (Date.now() - RATES.t < 43200000) return RATES;

  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 5000);

    const r = await fetch(RATES_URL, { signal: ctl.signal });
    clearTimeout(to);

    const j = await r.json();

    if (j && j.rates && j.rates.BDT) {
      RATES = {
        t: Date.now(),
        live: true,
        r: Object.assign({}, FALLBACK, j.rates)
      };
      return RATES;
    }
  } catch (e) {}

  RATES = {
    t: Date.now() - 43200000 + 600000,
    live: false,
    r: RATES.r
  };

  return RATES;
}

// Flight search
async function flights(q) {
  const origin = (q.get('origin') || '').toUpperCase();
  const dest = (q.get('destination') || '').toUpperCase();
  const dep = q.get('date') || '';
  const ret = q.get('return') || '';
  const cur = (q.get('currency') || 'usd').toLowerCase();

  const dateOk = d => /^\d{4}-\d{2}(-\d{2})?$/.test(d);

  if (
    !/^[A-Z]{3}$/.test(origin) ||
    !/^[A-Z]{3}$/.test(dest) ||
    origin === dest
  ) {
    return {
      code:400,
      body:{ error:'Enter two different airports.' }
    };
  }

  if (!dateOk(dep) || (ret && !dateOk(ret))) {
    return {
      code:400,
      body:{ error:'Enter a valid date.' }
    };
  }

  if (!/^[a-z]{3}$/.test(cur)) {
    return {
      code:400,
      body:{ error:'Invalid currency.' }
    };
  }

  if (!TOKEN) {
    return {
      code:500,
      body:{ error:'Server is not configured yet (missing token).' }
    };
  }

  const p = new URLSearchParams({
    origin,
    destination:dest,
    departure_at:dep,
    sorting:'price',
    direct:'false',
    currency:'usd',
    cy:'usd',
    limit:'50',
    page:'1',
    unique:'false',
    one_way:ret ? 'false' : 'true'
  });

  if (ret) p.set('return_at', ret);

  const key = p.toString();
  let v = cache.get(key);

  if (!v || Date.now() - v.t > 600000) {
    try {
      const r = await fetch(
        BASE + '/aviasales/v3/prices_for_dates?' + key,
        {
          headers:{ 'X-Access-Token':TOKEN }
        }
      );

      if (!r.ok) {
        return {
          code:502,
          body:{
            error:'Price provider returned an error (' + r.status + ').'
          }
        };
      }

      const j = await r.json();

      v = {
        t:Date.now(),
        currency:String(j.currency || 'usd').toLowerCase(),
        data:Array.isArray(j.data) ? j.data : []
      };

      cache.set(key, v);

    } catch (e) {
      return {
        code:502,
        body:{ error:'Could not reach the price provider.' }
      };
    }
  }

  const R = await getRates();
  const fromRate =
    v.currency === 'usd' ? 1 : R.r[v.currency.toUpperCase()];
  const toRate = R.r[cur.toUpperCase()];

  if (!fromRate || !toRate) {
    return {
      code:400,
      body:{
        error:'The selected currency is not supported. Please choose another currency.',
        requested:cur
      }
    };
  }

  const mul = toRate / fromRate;

  const monthOrDateMatches = (value, requested) => {
    if (!requested) return true;

    const actual = String(value || '').slice(0, 10);

    return requested.length === 7
      ? actual.slice(0, 7) === requested
      : actual === requested;
  };

  const out = v.data.filter(f => {
    if (typeof f.transfers === 'number' && f.transfers > 1) {
      return false;
    }

    if (!monthOrDateMatches(f.departure_at, dep)) {
      return false;
    }

    if (
      ret &&
      (
        !monthOrDateMatches(f.return_at, ret) ||
        String(f.return_at || '').slice(0, 10) <
        String(f.departure_at || '').slice(0, 10)
      )
    ) {
      return false;
    }

    return true;

  }).map(f => Object.assign({}, f, {
    price:Math.round(Number(f.price) * mul),
    airline_name:NAMES[f.airline] || f.airline || ''
  }));

  return {
    code:200,
    body:{
      currency:cur,
      requested:cur,
      converted:v.currency !== cur,
      rates:R.live ? 'live' : 'approximate',
      data:out
    }
  };
}

// Calendar prices
async function calendar(q) {
  const origin = (q.get('origin') || '').toUpperCase();
  const dest = (q.get('destination') || '').toUpperCase();
  const month = q.get('month') || '';
  const cur = (q.get('currency') || 'usd').toLowerCase();

  if (
    !/^[A-Z]{3}$/.test(origin) ||
    !/^[A-Z]{3}$/.test(dest) ||
    origin === dest ||
    !/^\d{4}-\d{2}$/.test(month) ||
    !/^[a-z]{3}$/.test(cur)
  ) {
    return {
      code:400,
      body:{ error:'Invalid request.' }
    };
  }

  const R = await getRates();
  const toRate = R.r[cur.toUpperCase()];

  if (!toRate) {
    return {
      code:400,
      body:{
        error:'The selected currency is not supported.',
        requested:cur
      }
    };
  }

  const target = cur;
  const mul = toRate;

  if (!TOKEN) {
    return {
      code:200,
      body:{ currency:target, prices:{} }
    };
  }

  const p = new URLSearchParams({
    origin,
    destination:dest,
    depart_date:month,
    calendar_type:'departure_date',
    currency:'usd'
  });

  const key = 'cal|' + p.toString();
  let v = cache.get(key);

  if (!v || Date.now() - v.t > 1800000) {
    try {
      const r = await fetch(
        BASE + '/v1/prices/calendar?' + p.toString(),
        {
          headers:{ 'X-Access-Token':TOKEN }
        }
      );

      if (!r.ok) {
        return {
          code:200,
          body:{ currency:target, prices:{} }
        };
      }

      const j = await r.json();
      const prices = {};
      const d = j && j.data;

      if (d && typeof d === 'object') {
        for (const k of Object.keys(d)) {
          const e = d[k];

          const day = String(
            /^\d{4}-\d{2}-\d{2}/.test(k)
              ? k
              : (e && (e.departure_at || e.depart_date)) || ''
          ).slice(0, 10);

          const pr =
            typeof e === 'number'
              ? e
              : (e && (e.price || e.value));

          if (/^\d{4}-\d{2}-\d{2}$/.test(day) && pr > 0) {
            prices[day] = pr;
          }
        }
      }

      v = {
        t:Date.now(),
        prices
      };

      cache.set(key, v);

    } catch (e) {
      return {
        code:200,
        body:{ currency:target, prices:{} }
      };
    }
  }

  const prices = {};

  for (const k of Object.keys(v.prices)) {
    prices[k] = Math.round(v.prices[k] * mul);
  }

  return {
    code:200,
    body:{
      currency:target,
      prices,
      converted:mul !== 1,
      rates:R.live ? 'live' : 'approximate'
    }
  };
}

// Booking redirect: preserve the actual provider URL
function bookingRedirect(req, res, url) {
  const raw = url.searchParams.get('link') || '';

  let target;

  try {
    if (raw.startsWith('/')) {
      if (
        raw.startsWith('//') ||
        !/^\/[A-Za-z0-9\/?=&_.%\-]*$/.test(raw)
      ) {
        throw new Error('Invalid relative URL');
      }

      target = new URL(raw, 'https://www.aviasales.com');

    } else {
      target = new URL(raw);

      if (target.protocol !== 'https:') {
        throw new Error('HTTPS required');
      }

      if (target.username || target.password) {
        throw new Error('Credentials not allowed');
      }

      const host = target.hostname.toLowerCase();

      const allowedHosts = [
        'aviasales.com',
        'trip.com',
        'wingie.com',
        'goindigo.in',
        'indigo.com'
      ];

      const allowed = allowedHosts.some(domain =>
        host === domain || host.endsWith('.' + domain)
      );

      if (!allowed) {
        throw new Error('Provider domain not allowed');
      }
    }

    if (target.protocol !== 'https:') {
      throw new Error('HTTPS required');
    }

  } catch (e) {
    res.writeHead(400, {
      'Content-Type':'text/plain; charset=utf-8'
    });
    return res.end('Invalid booking link');
  }

  clicks++;

  console.log(JSON.stringify({
    click:clicks,
    at:new Date().toISOString(),
    host:target.hostname
  }));

  res.writeHead(302, {
    Location:target.toString(),
    'Cache-Control':'no-store'
  });

  return res.end();
}

// Main server
http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Referrer-Policy',
    'strict-origin-when-cross-origin'
  );

  let u;

  try {
    u = new URL(req.url, 'http://localhost');
  } catch (e) {
    res.writeHead(400);
    return res.end('Bad request');
  }

  const ip =
    req.headers['x-forwarded-for'] ||
    req.socket.remoteAddress ||
    '';

  if (u.pathname === '/health') {
    return json(res, 200, {
      ok:true,
      tokenSet:!!TOKEN
    });
  }

  if (u.pathname === '/adclick') {
    console.log(JSON.stringify({
      adclick:(u.searchParams.get('id') || '')
        .replace(/[^A-Za-z0-9_-]/g, '')
        .slice(0, 40),
      at:new Date().toISOString()
    }));

    res.writeHead(204);
    return res.end();
  }

  if (u.pathname === '/api/calendar') {
    if (limited(ip + '|cal')) {
      return json(res, 429, {
        error:'Too many requests. Please wait a minute.'
      });
    }

    const r = await calendar(u.searchParams);
    return json(res, r.code, r.body);
  }

  if (u.pathname === '/api/flights') {
    if (limited(ip)) {
      return json(res, 429, {
        error:'Too many requests. Please wait a minute.'
      });
    }

    const r = await flights(u.searchParams);
    return json(res, r.code, r.body);
  }

  if (u.pathname === '/out') {
    return bookingRedirect(req, res, u);
  }

  let f;

  try {
    f = path.resolve(
      PUB,
      '.' + decodeURIComponent(
        u.pathname === '/' ? '/index.html' : u.pathname
      )
    );
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
      'Content-Type':
        MIME[path.extname(f)] || 'application/octet-stream'
    });

    res.end(d);
  });

}).listen(PORT, () => {
  console.log('Tourflight running on port ' + PORT);
});
