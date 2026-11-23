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
        'expedia.com',
        'booking.com',
        'trip.com',
        'agoda.com',
        'priceline.com',
        'orbitz.com',
        'travelocity.com',
        'skyscanner.net',
        'kayak.com',
        'momondo.com',
        'kiwi.com',
        'cheapoair.com',
        'hopper.com',
        'edreams.com',
        'makemytrip.com',
        'cleartrip.com',
        'easemytrip.com',
        'yatra.com',
        'ixigo.com',
        'sastaticket.pk',
        'bookme.pk',
        'sharetrip.net',
        'gozayaan.com',
        'musafir.com',
        'almosafer.com',
        'rehlat.com',
        'cleartrip.ae',
        'dnatatravel.com',
        'tajawal.com',
        'flyin.com',
        'traveloka.com',
        'tiket.com',
        'airasia.com',
        'klook.com',
        'ctrip.com',
        'fliggy.com',
        '12go.asia',
        'lastminute.com',
        'esky.com',
        'gotogate.com',
        'mytrip.com',
        'flightnetwork.com',
        'alternativeairlines.com',
        'cheaptickets.com',
        'flightcentre.com',
        'despegar.com',
        'onetravel.com',
        'biman-airlines.com',
        'usbair.com',
        'airindia.com',
        'goindigo.in',
        'piac.com.pk',
        'nepalairlines.com.np',
        'srilankan.com',
        'emirates.com',
        'etihad.com',
        'flydubai.com',
        'airarabia.com',
        'saudia.com',
        'qatarairways.com',
        'omanair.com',
        'gulfair.com',
        'kuwaitairways.com',
        'flynas.com',
        'malaysiaairlines.com',
        'singaporeair.com',
        'thaiairways.com',
        'garuda-indonesia.com',
        'airchina.com',
        'ceair.com',
        'csair.com',
        'maldivian.aero',
        'britishairways.com',
        'lufthansa.com',
        'airfrance.com',
        'aa.com',
        'united.com',
        'enuygun.com',
        'obilet.com',
        'turna.com',
        'biletall.com',
        'tatilbudur.com',
        'setur.com.tr',
        'jollytur.com',
        'tatilsepeti.com',
        'turkishairlines.com',
        'flypgs.com',
        'ajet.com',
        'sunexpress.com',
        'corendonairlines.com',
        'freebirdairlines.com',
        'wakanow.com',
        'travelstart.co.za',
        'travelstart.com.ng',
        'flightsite.co.za',
        'flightcentre.co.za',
        'tix.africa',
        'travelwings.com',
        'justfly.com',
        'cheapflights.com',
        'almatar.com',
        'travco.com',
        'holidayme.com',
        'wego.com.eg',
        'ethiopianairlines.com',
        'egyptair.com',
        'kenya-airways.com',
        'royalairmaroc.com',
        'flysaa.com',
        'airalgerie.dz',
        'tunisair.com',
        'rwandair.com',
        'flyairsenegal.com',
        'taag.com',
        'airmauritius.com',
        'ugandairlines.com',
        'flysafair.co.za',
        'flyairpeace.com',
        'fastjet.com',
        'aircairo.com',
        'nileair.com',
        'nesmaairlines.com'
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
```[cite: 2]

---

### ২. আপডেটেড `agencyLogo` (`index.html`-এর ভেতরে)

আপনার `index.html`-এ থাকা `agencyLogo` ফাংশনটি নিচের কোড দিয়ে বদলে দিন যাতে এসব সাইট/এয়ারলাইনের লোগো/আইকন ঠিকভাবে দেখায়[cite: 1]:

```javascript
function agencyLogo(name){
var n=String(name||'Travel agency'),key=n.toLowerCase().trim(),domains={
'expedia':'expedia.com','expedia.com':'expedia.com',
'booking.com':'booking.com','booking':'booking.com',
'trip.com':'trip.com','agoda':'agoda.com','agoda.com':'agoda.com',
'priceline':'priceline.com','priceline.com':'priceline.com',
'orbitz':'orbitz.com','orbitz.com':'orbitz.com',
'travelocity':'travelocity.com','travelocity.com':'travelocity.com',
'skyscanner':'skyscanner.net','skyscanner.net':'skyscanner.net',
'kayak':'kayak.com','kayak.com':'kayak.com',
'momondo':'momondo.com','momondo.com':'momondo.com',
'kiwi.com':'kiwi.com','kiwi':'kiwi.com',
'cheapoair':'cheapoair.com','cheapoair.com':'cheapoair.com',
'hopper':'hopper.com','hopper.com':'hopper.com',
'edreams':'edreams.com','edreams.com':'edreams.com',
'makemytrip':'makemytrip.com','makemytrip.com':'makemytrip.com',
'cleartrip':'cleartrip.com','cleartrip.com':'cleartrip.com','cleartrip.ae':'cleartrip.ae',
'easemytrip':'easemytrip.com','easemytrip.com':'easemytrip.com',
'yatra':'yatra.com','yatra.com':'yatra.com',
'ixigo':'ixigo.com','ixigo.com':'ixigo.com',
'sastaticket':'sastaticket.pk','sastaticket.pk':'sastaticket.pk',
'bookme':'bookme.pk','bookme.pk':'bookme.pk',
'sharetrip':'sharetrip.net','sharetrip.net':'sharetrip.net',
'gozayaan':'gozayaan.com','gozayaan.com':'gozayaan.com',
'musafir':'musafir.com','musafir.com':'musafir.com',
'almosafer':'almosafer.com','almosafer.com':'almosafer.com',
'rehlat':'rehlat.com','rehlat.com':'rehlat.com',
'dnata travel':'dnatatravel.com','dnatatravel.com':'dnatatravel.com',
'tajawal':'tajawal.com','tajawal.com':'tajawal.com',
'flyin':'flyin.com','flyin.com':'flyin.com',
'traveloka':'traveloka.com','traveloka.com':'traveloka.com',
'tiket.com':'tiket.com','tiket':'tiket.com',
'airasia':'airasia.com','airasia.com':'airasia.com',
'klook':'klook.com','klook.com':'klook.com',
'ctrip':'ctrip.com','ctrip.com':'ctrip.com',
'fliggy':'fliggy.com','fliggy.com':'fliggy.com',
'12go':'12go.asia','12go.asia':'12go.asia',
'lastminute.com':'lastminute.com','lastminute':'lastminute.com',
'esky':'esky.com','esky.com':'esky.com',
'gotogate':'gotogate.com','gotogate.com':'gotogate.com',
'mytrip':'mytrip.com','mytrip.com':'mytrip.com',
'flightnetwork':'flightnetwork.com','flightnetwork.com':'flightnetwork.com',
'alternative airlines':'alternativeairlines.com','alternativeairlines.com':'alternativeairlines.com',
'cheaptickets':'cheaptickets.com','cheaptickets.com':'cheaptickets.com',
'flight centre':'flightcentre.com','flightcentre.com':'flightcentre.com','flightcentre.co.za':'flightcentre.co.za',
'despegar':'despegar.com','despegar.com':'despegar.com',
'onetravel':'onetravel.com','onetravel.com':'onetravel.com',
'biman bangladesh airlines':'biman-airlines.com','biman-airlines.com':'biman-airlines.com',
'us-bangla airlines':'usbair.com','usbair.com':'usbair.com',
'air india':'airindia.com','airindia.com':'airindia.com',
'indigo':'goindigo.in','goindigo.in':'goindigo.in',
'pakistan international airlines':'piac.com.pk','piac.com.pk':'piac.com.pk',
'nepal airlines':'nepalairlines.com.np','nepalairlines.com.np':'nepalairlines.com.np',
'srilankan airlines':'srilankan.com','srilankan.com':'srilankan.com',
'emirates':'emirates.com','emirates.com':'emirates.com',
'etihad':'etihad.com','etihad.com':'etihad.com',
'flydubai':'flydubai.com','flydubai.com':'flydubai.com',
'air arabia':'airarabia.com','airarabia.com':'airarabia.com',
'saudia':'saudia.com','saudia.com':'saudia.com',
'qatar airways':'qatarairways.com','qatarairways.com':'qatarairways.com',
'oman air':'omanair.com','omanair.com':'omanair.com',
'gulf air':'gulfair.com','gulfair.com':'gulfair.com',
'kuwait airways':'kuwaitairways.com','kuwaitairways.com':'kuwaitairways.com',
'flynas':'flynas.com','flynas.com':'flynas.com',
'malaysia airlines':'malaysiaairlines.com','malaysiaairlines.com':'malaysiaairlines.com',
'singapore airlines':'singaporeair.com','singaporeair.com':'singaporeair.com',
'thai airways':'thaiairways.com','thaiairways.com':'thaiairways.com',
'garuda indonesia':'garuda-indonesia.com','garuda-indonesia.com':'garuda-indonesia.com',
'air china':'airchina.com','airchina.com':'airchina.com',
'china eastern':'ceair.com','ceair.com':'ceair.com',
'china southern':'csair.com','csair.com':'csair.com',
'maldivian':'maldivian.aero','maldivian.aero':'maldivian.aero',
'british airways':'britishairways.com','britishairways.com':'britishairways.com',
'lufthansa':'lufthansa.com','lufthansa.com':'lufthansa.com',
'air france':'airfrance.com','airfrance.com':'airfrance.com',
'american airlines':'aa.com','aa.com':'aa.com',
'united airlines':'united.com','united.com':'united.com',
'enuygun':'enuygun.com','enuygun.com':'enuygun.com',
'obilet':'obilet.com','obilet.com':'obilet.com',
'turna.com':'turna.com','turna':'turna.com',
'biletall':'biletall.com','biletall.com':'biletall.com',
'tatilbudur':'tatilbudur.com','tatilbudur.com':'tatilbudur.com',
'setur':'setur.com.tr','setur.com.tr':'setur.com.tr',
'jolly tur':'jollytur.com','jollytur.com':'jollytur.com',
'tatilsepeti':'tatilsepeti.com','tatilsepeti.com':'tatilsepeti.com',
'turkish airlines':'turkishairlines.com','turkishairlines.com':'turkishairlines.com',
'pegasus airlines':'flypgs.com','flypgs.com':'flypgs.com',
'ajet':'ajet.com','ajet.com':'ajet.com',
'sunexpress':'sunexpress.com','sunexpress.com':'sunexpress.com',
'corendon airlines':'corendonairlines.com','corendonairlines.com':'corendonairlines.com',
'freebird airlines':'freebirdairlines.com','freebirdairlines.com':'freebirdairlines.com',
'wakanow':'wakanow.com','wakanow.com':'wakanow.com',
'travelstart':'travelstart.co.za','travelstart.co.za':'travelstart.co.za','travelstart.com.ng':'travelstart.com.ng',
'flightsite':'flightsite.co.za','flightsite.co.za':'flightsite.co.za',
'tix.africa':'tix.africa','tix africa':'tix.africa',
'travelwings':'travelwings.com','travelwings.com':'travelwings.com',
'justfly':'justfly.com','justfly.com':'justfly.com',
'cheapflights':'cheapflights.com','cheapflights.com':'cheapflights.com',
'almatar':'almatar.com','almatar.com':'almatar.com',
'travco':'travco.com','travco.com':'travco.com',
'holidayme':'holidayme.com','holidayme.com':'holidayme.com',
'wego':'wego.com.eg','wego.com.eg':'wego.com.eg',
'ethiopian airlines':'ethiopianairlines.com','ethiopianairlines.com':'ethiopianairlines.com',
'egyptair':'egyptair.com','egyptair.com':'egyptair.com',
'kenya airways':'kenya-airways.com','kenya-airways.com':'kenya-airways.com',
'royal air maroc':'royalairmaroc.com','royalairmaroc.com':'royalairmaroc.com',
'south african airways':'flysaa.com','flysaa.com':'flysaa.com',
'air algerie':'airalgerie.dz','airalgerie.dz':'airalgerie.dz',
'tunisair':'tunisair.com','tunisair.com':'tunisair.com',
'rwandair':'rwandair.com','rwandair.com':'rwandair.com',
'air senegal':'flyairsenegal.com','flyairsenegal.com':'flyairsenegal.com',
'taag':'taag.com','taag.com':'taag.com',
'air mauritius':'airmauritius.com','airmauritius.com':'airmauritius.com',
'uganda airlines':'ugandairlines.com','ugandairlines.com':'ugandairlines.com',
'flysafair':'flysafair.co.za','flysafair.co.za':'flysafair.co.za',
'air peace':'flyairpeace.com','flyairpeace.com':'flyairpeace.com',
'fastjet':'fastjet.com','fastjet.com':'fastjet.com',
'air cairo':'aircairo.com','aircairo.com':'aircairo.com',
'nile air':'nileair.com','nileair.com':'nileair.com',
'nesma airlines':'nesmaairlines.com','nesmaairlines.com':'nesmaairlines.com'
};
if(!domains[key]&&/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(key))domains[key]=key;var d=domains[key];if(d)return '<img class="aglogo" src="https://www.google.com/s2/favicons?domain='+encodeURIComponent(d)+'&sz=64" alt="" loading="lazy" onerror="this.style.display=\'none\'">';
var initials=n.split(/\s+/).filter(Boolean).slice(0,2).map(function(x){return x.charAt(0).toUpperCase()}).join('')||'A';return '<span class="agmark" aria-hidden="true">'+esc(initials)+'</span>';
}
```[cite: 1]

আপনি কি এই ওয়েবসাইটগুলো **রেজাল্টের নিচের "Compare this trip on other sites" (`cmp`) সেকশনেও** সরাসরি লিংক হিসেবে দেখাতে চান?