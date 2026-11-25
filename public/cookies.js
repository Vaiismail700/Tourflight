// Tourflight cookie consent. Your choice is stored in one first-party cookie (tf_consent).
// For future scripts, call: tfConsent.on('analytics', function () { /* load analytics here */ });
// Categories are 'analytics' and 'ads'. Nothing non-essential runs until the visitor allows it.
(function () {
  var NAME = 'tf_consent', DAYS = 180;
  function read() {
    var m = document.cookie.match(new RegExp('(?:^|; )' + NAME + '=([^;]*)'));
    if (!m) return null;
    try { var c = JSON.parse(decodeURIComponent(m[1])); return c && c.v === 1 ? c : null; } catch (e) { return null; }
  }
  function write(c) {
    document.cookie = NAME + '=' + encodeURIComponent(JSON.stringify({ v: 1, analytics: !!c.analytics, ads: !!c.ads, t: Date.now() })) +
      '; Max-Age=' + (DAYS * 86400) + '; Path=/; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
  }
  var saved = read(), state = { analytics: !!(saved && saved.analytics), ads: !!(saved && saved.ads) }, waiting = [];
  function fire() {
    waiting = waiting.filter(function (w) { if (state[w[0]]) { try { w[1](); } catch (e) {} return false; } return true; });
    try { document.dispatchEvent(new CustomEvent('tf-consent', { detail: { analytics: state.analytics, ads: state.ads } })); } catch (e) {}
  }
  window.tfConsent = {
    get: function () { return { necessary: true, analytics: state.analytics, ads: state.ads }; },
    on: function (cat, fn) { if (state[cat]) fn(); else waiting.push([cat, fn]); },
    open: function () { show(true); },
    refreshLanguage: function () { translateBanner(document.getElementById('tfck')); }
  };
  function save(a, d) { state = { analytics: !!a, ads: !!d }; write(state); close(); fire(); }
  function close() { var b = document.getElementById('tfck'); if (b && b.parentNode) b.parentNode.removeChild(b); }
  function css() {
    if (document.getElementById('tfck-css')) return;
    var s = document.createElement('style'); s.id = 'tfck-css';
    s.textContent = '#tfck{position:fixed;left:0;right:0;bottom:0;z-index:2000;padding:12px;padding-bottom:calc(12px + env(safe-area-inset-bottom,0px));pointer-events:none}' +
      '#tfck .ckin{pointer-events:auto;max-width:760px;margin:0 auto;background:#fff;color:#0a2a5e;border:1px solid #bccadc;border-radius:16px;box-shadow:0 12px 36px rgba(10,30,60,.3);padding:16px;font:14px/1.5 system-ui,Segoe UI,Roboto,sans-serif}' +
      '#tfck b{font-size:16px}#tfck p{margin:6px 0 10px;color:#33507a}#tfck a{color:#1458c7}' +
      '#tfck .ckb{display:flex;gap:8px;flex-wrap:wrap}#tfck button{font:inherit;font-weight:600;border-radius:10px;padding:10px 14px;cursor:pointer;border:1.5px solid #bccadc;background:#f3f6fb;color:#0a2a5e;flex:1;min-width:120px}' +
      '#tfck button.pri{background:#ff7a00;border-color:#ff7a00;color:#2a1300}#tfck button.nav{background:#0a2a5e;border-color:#0a2a5e;color:#fff}' +
      '#tfck .ckr{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-top:1px solid #e3eaf3}#tfck .ckr small{display:block;color:#5d6f85}' +
      '#tfck .ckr input{width:22px;height:22px;flex:none}#tfck .ckset{display:none;margin-bottom:10px}#tfck.open .ckset{display:block}#tfck.open .ckmain{display:none}';
    document.head.appendChild(s);
  }
  var hindi = [
    'कुकी और आपकी गोपनीयता',
    'हम आपकी पसंद याद रखने के लिए एक कुकी इस्तेमाल करते हैं। विज्ञापन की अनुमति देने पर ही वैकल्पिक अफ़िलिएट स्क्रिप्ट चालू होती है। ',
    'गोपनीयता नीति', ' देखें।',
    'सभी स्वीकार करें', 'ग़ैर-ज़रूरी कुकी अस्वीकार करें', 'सेटिंग बदलें',
    'चुनें कि हम कौन-सी वैकल्पिक कुकी इस्तेमाल कर सकते हैं।',
    'ज़रूरी कुकी', 'आपकी पसंद याद रखती हैं। हमेशा चालू।',
    'विश्लेषण', 'साइट का उपयोग समझने में मदद करता है। अभी इस्तेमाल नहीं होता।',
    'विज्ञापन और अफ़िलिएट', 'विज्ञापन और पार्टनर रेफ़रल मापने में मदद करता है।',
    'पसंद सेव करें', 'ग़ैर-ज़रूरी कुकी अस्वीकार करें'
  ];
  function translateBanner(banner) {
    if (!banner) return;
    var main = banner.querySelector('.ckmain p');
    var nodes = [
      banner.querySelector('.ckin > b'), main.firstChild, main.querySelector('a'), main.lastChild,
      ...banner.querySelectorAll('.ckmain button'), banner.querySelector('.ckset > p'),
      ...banner.querySelectorAll('.ckr b, .ckr small'), ...banner.querySelectorAll('.ckset button')
    ];
    if (!banner.cookieEnglish) banner.cookieEnglish = nodes.map(function(node) { return node.textContent; });
    var isHindi = document.documentElement.lang === 'hi';
    var strings = isHindi ? hindi : banner.cookieEnglish;
    nodes.forEach(function(node, index) { node.textContent = strings[index]; });
    banner.setAttribute('aria-label', isHindi ? 'कुकी सेटिंग्स' : 'Cookie preferences');
    var labels = isHindi ? ['ज़रूरी कुकी, हमेशा चालू', 'विश्लेषण कुकी', 'विज्ञापन और अफ़िलिएट कुकी'] :
      ['Essential cookies, always on', 'Analytics cookies', 'Advertising and affiliate cookies'];
    banner.querySelectorAll('.ckr input').forEach(function(input, index) { input.setAttribute('aria-label', labels[index]); });
  }
  function show(open) {
    close(); css();
    var b = document.createElement('div'); b.id = 'tfck'; b.setAttribute('role', 'dialog'); b.setAttribute('aria-label', 'Cookie preferences');
    if (open) b.className = 'open';
    b.innerHTML = '<div class="ckin"><b>Cookies and your privacy</b>' +
      '<div class="ckmain"><p>We use one small cookie to remember your cookie choice. The optional affiliate script stays off unless you allow advertising. See our <a href="/privacy.html">Privacy Policy</a>.</p>' +
      '<div class="ckb"><button type="button" class="pri" data-a="all">Accept all</button><button type="button" data-a="none">Reject non-essential</button><button type="button" class="nav" data-a="set">Customise</button></div></div>' +
      '<div class="ckset"><p>Choose which optional cookies we may use.</p>' +
      '<div class="ckr"><div><b style="font-size:14px">Essential</b><small>Remembers your cookie choice. Always on.</small></div><input type="checkbox" checked disabled aria-label="Essential cookies, always on"></div>' +
      '<div class="ckr"><div><b style="font-size:14px">Analytics</b><small>Helps us understand how the site is used. Not used yet.</small></div><input type="checkbox" id="tfck-an" aria-label="Analytics cookies"></div>' +
      '<div class="ckr"><div><b style="font-size:14px">Advertising and affiliate</b><small>Helps measure ads and partner referrals.</small></div><input type="checkbox" id="tfck-ad" aria-label="Advertising and affiliate cookies"></div>' +
      '<div class="ckb" style="margin-top:10px"><button type="button" data-a="save" class="pri">Save choices</button><button type="button" data-a="none">Reject non-essential</button></div></div></div>';
    document.body.appendChild(b);
    translateBanner(b);
    var an = b.querySelector('#tfck-an'), ad = b.querySelector('#tfck-ad');
    if (an) an.checked = state.analytics; if (ad) ad.checked = state.ads;
    b.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('button') : null; if (!t) return;
      var a = t.getAttribute('data-a');
      if (a === 'all') save(true, true);
      else if (a === 'none') save(false, false);
      else if (a === 'save') save(an && an.checked, ad && ad.checked);
      else if (a === 'set') b.className = 'open';
    });
  }
  function link() {
    var f = document.querySelector('footer'); if (!f || document.getElementById('tfck-link')) return;
    var as = f.querySelectorAll('a'), last = as.length ? as[as.length - 1] : null;
    var a = document.createElement('a'); a.id = 'tfck-link'; a.href = '#'; a.textContent = typeof t === 'function' ? t('cookie_settings') : 'Cookie settings';
    a.addEventListener('click', function (e) { e.preventDefault(); show(true); });
    if (last && last.parentNode) last.parentNode.insertBefore(a, last.nextSibling); else f.appendChild(a);
  }
  function init() { link(); if (!saved) show(false); fire(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
