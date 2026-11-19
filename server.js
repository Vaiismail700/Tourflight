// Tourflight server: no dependencies, Node 18+. The Travelpayouts token stays on the server only.
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TP_TOKEN || '';
const BASE = process.env.TP_BASE || 'https://api.travelpayouts.com';
const PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.js': 'text/javascript', '.css': 'text/css' };
const cache = new Map(), hits = new Map();
let clicks = 0;

function limited(ip) {
  const now = Date.now(), a = (hits.get(ip) || []).filter(t => now - t < 60000);
  a.push(now); hits.set(ip, a);
  return a.length > 30; // max 30 requests per minute per visitor
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
const NAMES = {"EK": "Emirates", "QR": "Qatar Airways", "EY": "Etihad Airways", "FZ": "flydubai", "G9": "Air Arabia", "SV": "Saudia", "XY": "flynas", "F3": "flyadeal", "GF": "Gulf Air", "WY": "Oman Air", "KU": "Kuwait Airways", "RJ": "Royal Jordanian", "ME": "Middle East Airlines", "LY": "El Al", "TK": "Turkish Airlines", "PC": "Pegasus", "SQ": "Singapore Airlines", "TR": "Scoot", "MH": "Malaysia Airlines", "AK": "AirAsia", "D7": "AirAsia X", "TG": "Thai Airways", "FD": "Thai AirAsia", "VN": "Vietnam Airlines", "VJ": "VietJet Air", "PR": "Philippine Airlines", "5J": "Cebu Pacific", "GA": "Garuda Indonesia", "JT": "Lion Air", "CX": "Cathay Pacific", "CA": "Air China", "MU": "China Eastern", "CZ": "China Southern", "HU": "Hainan Airlines", "BR": "EVA Air", "CI": "China Airlines", "KE": "Korean Air", "OZ": "Asiana Airlines", "JL": "Japan Airlines", "NH": "ANA", "AI": "Air India", "6E": "IndiGo", "SG": "SpiceJet", "IX": "Air India Express", "BG": "Biman Bangladesh Airlines", "BS": "US-Bangla Airlines", "VQ": "Novoair", "PK": "Pakistan International Airlines", "UL": "SriLankan Airlines", "RA": "Nepal Airlines", "LH": "Lufthansa", "LX": "Swiss", "OS": "Austrian Airlines", "SN": "Brussels Airlines", "AF": "Air France", "KL": "KLM", "BA": "British Airways", "VS": "Virgin Atlantic", "IB": "Iberia", "VY": "Vueling", "AZ": "ITA Airways", "TP": "TAP Air Portugal", "SK": "SAS", "AY": "Finnair", "FR": "Ryanair", "U2": "easyJet", "W6": "Wizz Air", "DY": "Norwegian", "EI": "Aer Lingus", "LO": "LOT Polish Airlines", "A3": "Aegean Airlines", "EW": "Eurowings", "DE": "Condor", "FI": "Icelandair", "SU": "Aeroflot", "ET": "Ethiopian Airlines", "MS": "EgyptAir", "KQ": "Kenya Airways", "SA": "South African Airways", "AT": "Royal Air Maroc", "WB": "RwandAir", "MK": "Air Mauritius", "DL": "Delta Air Lines", "AA": "American Airlines", "UA": "United Airlines", "WN": "Southwest Airlines", "B6": "JetBlue", "AS": "Alaska Airlines", "AC": "Air Canada", "WS": "WestJet", "AM": "Aeromexico", "LA": "LATAM Airlines", "AV": "Avianca", "CM": "Copa Airlines", "AR": "Aerolineas Argentinas", "G3": "GOL", "QF": "Qantas", "VA": "Virgin Australia", "JQ": "Jetstar", "NZ": "Air New Zealand", "FJ": "Fiji Airways", "3U": "Sichuan Airlines", "ZH": "Shenzhen Airlines", "MF": "Xiamen Airlines"};
// Try to add more airline names from Travelpayouts' public list (falls back silently).
(async () => { try { const r = await fetch('https://api.travelpayouts.com/data/en/airlines.json'); if (r.ok) { for (const x of await r.json()) { if (x.code && x.name && !NAMES[x.code]) NAMES[x.code] = x.name; } } } catch (e) {} })();

async function flights(q) {
  const origin = (q.get('origin') || '').toUpperCase(), dest = (q.get('destination') || '').toUpperCase();
  const dep = q.get('date') || '', ret = q.get('return') || '';
  const cur = (q.get('currency') || 'usd').toLowerCase();
  const dateOk = d => /^\d{4}-\d{2}(-\d{2})?$/.test(d);
  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(dest) || origin === dest) return { code: 400, body: { error: 'Enter two different airports.' } };
  if (!dateOk(dep) || (ret && !dateOk(ret))) return { code: 400, body: { error: 'Enter a valid date.' } };
  if (!/^[a-z]{3}$/.test(cur)) return { code: 400, body: { error: 'Invalid currency.' } };
  if (!TOKEN) return { code: 500, body: { error: 'Server is not configured yet (missing token).' } };
  const p = new URLSearchParams({ origin, destination: dest, departure_at: dep, sorting: 'price', direct: 'false', currency: cur, limit: '50', page: '1', unique: 'false', one_way: ret ? 'false' : 'true' });
  if (ret) p.set('return_at', ret);
  const key = p.toString();
  let v = cache.get(key);
  if (!v || Date.now() - v.t > 600000) {
    try {
      const r = await fetch(BASE + '/aviasales/v3/prices_for_dates?' + key, { headers: { 'X-Access-Token': TOKEN } });
      if (!r.ok) return { code: 502, body: { error: 'Price provider returned an error (' + r.status + ').' } };
      const j = await r.json();
      v = { t: Date.now(), currency: String(j.currency || cur).toLowerCase(), data: Array.isArray(j.data) ? j.data : [] };
      cache.set(key, v);
    } catch (e) {
      return { code: 502, body: { error: 'Could not reach the price provider.' } };
    }
  }
  // Only direct and 1-stop itineraries are shown.
  const out = v.data.filter(f => typeof f.transfers !== 'number' || f.transfers <= 1)
    .map(f => Object.assign({}, f, { airline_name: NAMES[f.airline] || f.airline || '' }));
  return { code: 200, body: { currency: v.currency, requested: cur, data: out } };
}
http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  const u = new URL(req.url, 'http://x'), ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  if (u.pathname === '/health') return json(res, 200, { ok: true, tokenSet: !!TOKEN });
  if (u.pathname === '/api/flights') {
    if (limited(ip)) return json(res, 429, { error: 'Too many requests. Please wait a minute.' });
    const r = await flights(u.searchParams);
    return json(res, r.code, r.body);
  }
  if (u.pathname === '/out') { // every Book Now click goes through here, so clicks can be counted
    const l = u.searchParams.get('link') || '';
    if (!/^\/[A-Za-z0-9\/?=&_.%\-]*$/.test(l) || l.startsWith('//')) { res.writeHead(400); return res.end('Bad link'); }
    clicks++;
    console.log(JSON.stringify({ click: clicks, at: new Date().toISOString(), link: l }));
    res.writeHead(302, { Location: 'https://www.aviasales.com' + l });
    return res.end();
  }
  let f = path.normalize(path.join(PUB, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname)));
  if (!f.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(d);
  });
}).listen(PORT, () => console.log('Tourflight running on port ' + PORT));
