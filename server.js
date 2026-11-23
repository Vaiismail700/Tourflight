function search(){
  closeOffers();
  document.querySelectorAll('.sug.on').forEach(function(b){b.classList.remove('on')});
  var reqs=[],mo=$('mo').checked;
  if(type==='multi'){
    for(var i=0;i<nleg;i++){
      var fEl=$('f'+i),tEl=$('t'+i),dEl=$('d'+i);
      reqs.push({f:codeOf(fEl?fEl.value:''),t:codeOf(tEl?tEl.value:''),d:dEl?dEl.value:'',r:''});
    }
  }else{
    reqs.push({f:codeOf($('f0')?$('f0').value:''),t:codeOf($('t0')?$('t0').value:''),d:$('d0')?$('d0').value:'',r:type==='round'&&$('rt')?$('rt').value:''});
  }
  for(var k=0;k<reqs.length;k++){
    var q=reqs[k];
    if(!q.f||!q.t){show('<div class="m">'+esc(t('err_airports'))+'</div>');return}
    if(q.f===q.t){show('<div class="m">'+esc(t('err_same'))+'</div>');return}
    if(!q.d||(type==='round'&&!q.r)){show('<div class="m">'+esc(t('err_dates'))+'</div>');return}
    if(q.r&&q.r<q.d){show('<div class="m">'+esc(t('err_ret_before'))+'</div>');return}
    if(type==='multi'&&k>0&&q.d<reqs[k-1].d0){show('<div class="m">'+esc(t('err_leg_order'))+'</div>');return}
    q.d0=q.d;q.r0=q.r;q.mo=mo;if(mo){q.d=q.d.slice(0,7);q.r=q.r?q.r.slice(0,7):''}
  }
  var selectedCurrency=$('cy').value,selectedCabin=$('cabin').value;
  show('<div class="m">'+esc(t('searching'))+'</div>');$('lay').classList.add('nofl');
  Promise.all(reqs.map(function(q){
    var p=new URLSearchParams({
      origin:q.f,
      destination:q.t,
      date:q.d,
      depart_date:q.d,
      currency:selectedCurrency,
      cabin:selectedCabin,
      adults:pax.a,
      children:pax.c,
      infants:pax.i
    });
    if(q.r)p.set('return',q.r);
    return fetch(apiUrl('/api/flights?'+p)).then(readJsonSafe).then(function(j){
      var rawList=Array.isArray(j.data)?j.data:(Array.isArray(j.flights)?j.flights:[]);
      return Object.assign({},j,{data:rawList.map(function(item){return normFlightItem(item,q,j.currency||selectedCurrency)})});
    }).catch(function(){return{error:t('err_net'),data:[]}});
  })).then(function(js){
    strips={};offerPage=null;data=js.map(function(j,i){return{q:reqs[i],j:j}});
    var al={};cnt={};mn={};
    data.forEach(function(x){(x.j.data||[]).forEach(function(f){if(f.airline){al[f.airline]=f.airline_name||f.airline;cnt[f.airline]=(cnt[f.airline]||0)+1;mn[f.airline]=Math.min(mn[f.airline]||1e18,f.price)}})});
    var cs=null;data.forEach(function(x){if(!cs&&x.j&&x.j.currency)cs=x.j.currency});var sy=symOf(cs||'usd');
    $('al').innerHTML=Object.keys(al).sort(function(a,b){return mn[a]-mn[b]}).map(function(c){return '<div class="ar"><label class="ck"><input type="checkbox" value="'+esc(c)+'" checked>'+logo(c)+'<span class="an">'+esc(al[c])+'</span></label><span class="ap">'+sy+fmtN(mn[c])+'</span><button type="button" class="only" data-c="'+esc(c)+'">'+esc(t('only'))+'</button></div>'}).join('')||'<div class="s">'+esc(t('no_airlines'))+'</div>';
    $('lay').classList.add('has');$('lay').classList.remove('nofl');draw();
  });
}

function draw(){
  var fc=(document.querySelector('input[name=sf]:checked').value!=='any'?1:0)+(document.querySelectorAll('#al input:not(:checked)').length?1:0)+($('so').value!=='price'?1:0)+(document.querySelectorAll('input[name=tf]:not(:checked)').length?1:0);
  $('fcnt').textContent=fc?t('active_cnt',{n:fc}):'';
  var biz=$('cabin').value==='business',sf=document.querySelector('input[name=sf]:checked').value,so=$('so').value,h='';
  var af=[].slice.call(document.querySelectorAll('#al input:checked')).map(function(i){return i.value});
  var tf=[].slice.call(document.querySelectorAll('input[name=tf]:checked')).map(function(i){return +i.value});
  visibleGroups={};
  data.forEach(function(x,xi){
    var q=x.q,j=x.j;
    h+='<h2>'+esc(nm(q.f))+' → '+esc(nm(q.t))+'</h2><div class="strip" id="st'+xi+'"></div>'+(q.r0?'<div class="strip" id="stb'+xi+'"></div>':'');
    if(j.error){h+='<div class="m">'+esc(j.error)+'</div>';return}
    var sym=symOf(j.currency||$('cy').value);
    if(biz)h+='<div class="m" style="margin-bottom:10px">'+esc(t('biz_note'))+'</div>';
    if(j.requested&&j.currency&&j.currency.toLowerCase()!==j.requested.toLowerCase())h+='<div class="m" style="margin-bottom:10px">'+esc(t('cur_note'))+'</div>';
    var list=(j.data||[]).filter(function(f){return(sf==='any'||String(f.transfers)===sf)&&(af.indexOf(f.airline)>=0)&&tfOk(f,tf)});
    var fallbackNearby=false;
    if(!q.mo&&q.d0){
      var exact=list.filter(function(f){
        var dd=String(f.departure_at||'').slice(0,10);
        if(dd&&dd!==q.d0)return false;
        if(q.r0){var rr=String(f.return_at||'').slice(0,10);if(rr&&rr!==q.r0)return false}
        return true;
      });
      if(exact.length){list=exact;}
      else if(list.length){fallbackNearby=true;}
    }
    var grouped={};
    list.forEach(function(f){var k=flightKey(f);if(!grouped[k])grouped[k]={key:k,q:q,flight:f,offers:[],currency:j.currency};grouped[k].offers.push(f)});
    var groups=Object.keys(grouped).map(function(k){
      var g=grouped[k],byAgency={};
      g.offers.forEach(function(o){var agency=String(o.gate||'Travel agency');if(!byAgency[agency]||Number(o.price)<Number(byAgency[agency].price))byAgency[agency]=o});
      g.offers=Object.keys(byAgency).map(function(a){return byAgency[a]});
      g.best=g.offers.reduce(function(a,b){return !a||Number(b.price)<Number(a.price)?b:a},null);
      return g;
    });
    groups.sort(function(a,b){return so==='price'?Number(a.best.price)-Number(b.best.price):so==='dur'?(a.flight.duration_to||a.flight.duration||0)-(b.flight.duration_to||b.flight.duration||0):String(a.flight.departure_at).localeCompare(String(b.flight.departure_at))});
    if(fallbackNearby)h+='<div class="m" style="margin-bottom:10px">Exact date schedules were limited, showing available flights on this route.</div>';
    if(!groups.length)h+='<div class="m">'+esc(q.mo?t('no_res_flex'):t('no_res_exact'))+'</div>';
    if(q.mo&&groups.length)h+='<div class="s" style="margin-bottom:8px">'+esc(t('flex_on_note'))+'</div>';
    groups.forEach(function(g){
      var f=g.flight,rtrip=!!f.return_at,d=f.duration_to||(rtrip?0:f.duration),db=f.duration_back||0,fm=function(m){return m>0?Math.floor(m/60)+'h '+m%60+'m':''},oc=f.origin_airport||f.origin||q.f,dc=f.destination_airport||f.destination||q.t;
      var key='g'+Object.keys(visibleGroups).length;visibleGroups[key]=g;var airH=logo(f.airline)+'<span>'+esc(f.airline_name||f.airline||t('airline_fb'))+'</span>';
      var lay=f.layovers&&f.layovers.length?f.layovers.map(function(l){return Math.floor(l.minutes/60)+'h '+l.minutes%60+'m in '+(AP[l.airport]?AP[l.airport].n+' ('+l.airport+')':l.airport)}).join(', '):'';
      var layS=f.layovers&&f.layovers.length?f.layovers.map(function(l){return Math.floor(l.minutes/60)+'h '+l.minutes%60+'m \u00b7 '+l.airport}).join(', '):'';
      var tip=f.transfers===0?'':(lay?t('layover_prefix')+lay:t('layover_fb')),tipB=(typeof f.return_transfers==='number'&&f.return_transfers>0)?t('layover_fb'):'';
      h+='<div class="c fcard" data-open-offers="'+esc(key)+'" tabindex="0" role="button" aria-label="'+esc(t('of_view_aria'))+'"><div class="fm"><div class="al">'+logo(f.airline)+'<b>'+esc(f.airline_name||f.airline||t('airline_fb'))+'</b><span class="s">'+esc(f.flight_number?f.airline+' '+f.flight_number:'')+'</span></div>'
      +legHtml(rtrip?t('outbound'):'',String(f.departure_at||'').slice(0,10),f.departure_at,arrInfo(f,q),oc,dc,fm(d),f.transfers,tip,rtrip?airH:'',layS)
      +(rtrip?legHtml(t('return_leg'),String(f.return_at).slice(0,10),f.return_at,arrBack(f,q),dc,oc,fm(db),f.return_transfers||0,tipB,airH,''):'')
      +'<div><span class="tag">'+esc(f.transfers===0?t('direct'):t('stop_1'))+'</span><span class="tag">'+esc(rtrip?t('round_trip'):t('one_way'))+'</span><span class="tag">'+esc(t('tap_offers'))+'</span></div></div>'
      +'<div class="pc"><div><div class="pr">'+sym+fmtN(g.best.price)+'</div><div class="s">'+esc(t('best_price',{ag:agName(g.best)}))+'</div></div><button type="button" class="bk" data-open-offers="'+esc(key)+'">'+esc(t('view_offers'))+'</button></div></div>';
    });
    h+='<div class="cmp"><b>'+esc(t('cmp_title'))+'</b><div class="s">'+esc(t('cmp_sub'))+'</div>'+cmp(q).map(function(l){return '<a href="'+esc(l[1])+'" target="_blank" rel="noopener noreferrer">'+l[0]+'</a>'}).join('')+'</div>';
  });
  show(h);data.forEach(function(x,xi){fillStrip(xi);fillStrip(xi,true)});
}
```[cite: 1]

### এখন কী করবেন?
* আপনার পুরনো/আসল `index.html`-এ শুধু এই `search()` ও `draw()` অংশটুকু আপডেট করে সেভ করুন (সাজেশন ড্রপডাউনের `showSug` ও `pick` অংশ ছোঁবেন না)[cite: 1]।
* সার্ভার রিস্টার্ট করে পেজ রিফ্রেশ করুন, তারপর `Dhaka` থেকে `Dubai` সিলেক্ট করে তারিখ দিয়ে **Search flights** চাপুন[cite: 1, 2]।

আপডেট করার পর এখন কী ফ্লাইট লিস্ট ও সময় দেখাচ্ছে?