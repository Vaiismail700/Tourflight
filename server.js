const NAMES = {
  "EK": "Emirates", "QR": "Qatar Airways", "EY": "Etihad Airways",
  "FZ": "flydubai", "G9": "Air Arabia", "SV": "Saudia",
  "XY": "flynas", "F3": "flyadeal", "GF": "Gulf Air",
  "WY": "Oman Air", "KU": "Kuwait Airways", "RJ": "Royal Jordanian",
  "ME": "Middle East Airlines", "MS": "EgyptAir", "TK": "Turkish Airlines",
  "PC": "Pegasus Airlines", "BG": "Biman Bangladesh Airlines", "BS": "US-Bangla Airlines",
  "2A": "Air Astra", "VQ": "Novoair", "AI": "Air India",
  "6E": "IndiGo", "UK": "Vistara", "SG": "SpiceJet",
  "AK": "AirAsia", "D7": "AirAsia X", "MH": "Malaysia Airlines",
  "OD": "Batik Air Malaysia", "SQ": "Singapore Airlines", "TR": "Scoot",
  "TG": "Thai Airways", "FD": "Thai AirAsia", "PG": "Bangkok Airways",
  "CX": "Cathay Pacific", "JL": "Japan Airlines", "NH": "ANA",
  "KE": "Korean Air", "OZ": "Asiana Airlines", "CI": "China Airlines",
  "BR": "EVA Air", "CA": "Air China", "MU": "China Eastern",
  "CZ": "China Southern", "BA": "British Airways", "LH": "Lufthansa",
  "AF": "Air France", "KL": "KLM", "LX": "SWISS",
  "OS": "Austrian", "AY": "Finnair", "IB": "Iberia",
  "TP": "TAP Air Portugal", "AA": "American Airlines", "UA": "United Airlines",
  "DL": "Delta Air Lines", "AC": "Air Canada"
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

const RATES_URL = process.env.RATES_URL || 'https://open.er-api.com/v6/latest/USD';
let ratesCache = { t: 0, r: Object.assign({}, FALLBACK) };

async function getRates() {
  if (Date.now() - ratesCache.t < 3600000) {
    return ratesCache;
  }
  try {
    const res = await fetch(RATES_URL);
    if (res.ok) {
      const data = await res.json();
      const apiRates = data && (data.rates || data.conversion_rates);
      if (apiRates && typeof apiRates === 'object') {
        const merged = Object.assign({}, FALLBACK);
        for (const k of Object.keys(merged)) {
          const val = Number(apiRates[k]);
          if (Number.isFinite(val) && val > 0) {
            merged[k] = val;
          }
        }
        ratesCache = { t: Date.now(), r: merged };
        return ratesCache;
      }
    }
  } catch (e) {
    if (DEBUG) console.log('Rates fetch failed:', e.message);
  }
  ratesCache = { t: Date.now(), r: Object.assign({}, FALLBACK) };
  return ratesCache;
}
