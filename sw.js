/* CheerFlow のサービスワーカー。
   「ホーム画面に追加」したアプリとして起動できるようにするためのもの。
   アプリ本体はネット優先で取得し（更新がすぐ反映されるように）、圏外のときだけ前回取得した版を使う。
   Firebase・YouTube・フォントなど外部への通信には関与しない。 */
var CACHE = 'cheerflow-shell-v1';
var SHELL = ['./', 'cheerflow.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(SHELL); }).then(function(){ return self.skipWaiting(); }));
});

self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k!==CACHE; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});

self.addEventListener('fetch', function(e){
  var req = e.request;
  if(req.method!=='GET') return;
  var url = new URL(req.url);
  if(url.origin!==self.location.origin || url.pathname.indexOf('/__/')===0) return;
  e.respondWith(fetch(req).then(function(res){
    if(res && res.ok){
      var copy = res.clone();
      caches.open(CACHE).then(function(c){ c.put(req, copy); });
    }
    return res;
  }).catch(function(){
    return caches.match(req, { ignoreSearch:true }).then(function(hit){ return hit || caches.match('cheerflow.html'); });
  }));
});
