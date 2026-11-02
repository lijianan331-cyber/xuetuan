/* Run before third-party SDKs: slow networks cannot trap the launch screen.
   One play per tab session; ?intro=1 is an explicit preview, never copied by sharing. */
(function () {
  'use strict';
  var film = document.getElementById('launch-film'), app = document.getElementById('app');
  var key = 'xuetuan:launch:v1', params = new URLSearchParams(location.search), preview = params.has('splash') || params.get('intro') === '1';
  var seen = false;
  try { seen = sessionStorage.getItem(key) === '1'; } catch (_) {}
  if (!preview && (navigator.webdriver || seen || document.hidden || params.has('code') || params.has('card') || /access_token=|error_description=/.test(location.hash))) { film.remove(); return; }
  try { sessionStorage.setItem(key, '1'); } catch (_) {}
  var scene = film.querySelector('.launch-scene'), canvas = document.getElementById('launch-snowfall'), ctx = canvas.getContext('2d');
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finished = false, started = false, raf = 0, endTimer = 0, loadTimer = 0, safety = 0, startTime = 0;
  var previousFocus = document.activeElement, previousInert = app.inert;
  var skip = document.getElementById('launch-skip');
  var en = (document.documentElement.lang || '').indexOf('en') === 0;
  if (en) skip.textContent = 'Skip';
  function finish(immediate) {
    if (finished) return;
    finished = true; cancelAnimationFrame(raf); clearTimeout(endTimer); clearTimeout(loadTimer); clearTimeout(safety);
    document.removeEventListener('visibilitychange', visibility); document.removeEventListener('keydown', keyboard, true);
    window.removeEventListener('pagehide', pagehide); window.removeEventListener('resize', resize);
    app.inert = previousInert;
    if (document.activeElement === skip) {
      if (previousFocus && previousFocus !== document.body && previousFocus.isConnected) previousFocus.focus({ preventScroll: true }); else skip.blur();
    }
    function dispose() { film.hidden = true; canvas.width = canvas.height = 1; film.remove(); }
    if (immediate) dispose(); else { film.classList.add('leaving'); setTimeout(dispose, reduced ? 170 : 400); }
  }
  function visibility() { if (document.hidden) finish(true); }
  function pagehide() { finish(true); }
  function keyboard(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); finish(false); }
    else if (e.key === 'Tab') { e.preventDefault(); skip.focus({ preventScroll: true }); }
  }
  skip.addEventListener('click', function () { finish(false); });
  document.addEventListener('visibilitychange', visibility); document.addEventListener('keydown', keyboard, true);
  window.addEventListener('pagehide', pagehide);
  film.hidden = false; app.inert = true;
  /* Hard deadline is independent of assets, network, rAF and application boot. */
  safety = setTimeout(function () { finish(true); }, 5600);
  var w = 0, h = 0, dpr = 1, seed = 71;
  function random() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
  function resize() {
    w = film.clientWidth; h = film.clientHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize(); window.addEventListener('resize', resize);
  /* Cached sprites: irregular granular snow, softly lit powder, no per-frame image decoding. */
  var ball = document.createElement('canvas'); ball.width = ball.height = 256;
  var bc = ball.getContext('2d');
  if (bc) {
    var g = bc.createRadialGradient(86, 64, 3, 127, 132, 124);
    g.addColorStop(0, '#fff'); g.addColorStop(.52, '#edf5fc'); g.addColorStop(.84, '#bdcfdf'); g.addColorStop(1, '#607b96');
    bc.fillStyle = g; bc.beginPath();
    for (var a = 0; a <= 160; a++) { var angle = a / 160 * Math.PI * 2, radius = 116 + random() * 5; var bx = 128 + Math.cos(angle) * radius, by = 128 + Math.sin(angle) * radius; if (!a) bc.moveTo(bx, by); else bc.lineTo(bx, by); }
    bc.closePath(); bc.fill(); bc.save(); bc.clip();
    for (var j = 0; j < 4600; j++) {
      var x = random() * 256, y = random() * 256, r = .35 + random() * 2.2;
      bc.fillStyle = random() > .35 ? 'rgba(255,255,255,' + (.12 + random() * .45) + ')' : 'rgba(60,89,122,' + (random() * .17) + ')';
      bc.beginPath(); bc.arc(x, y, r, 0, Math.PI * 2); bc.fill();
    }
    bc.restore();
  }
  var dust = document.createElement('canvas'); dust.width = dust.height = 64;
  var dc = dust.getContext('2d');
  if (dc) { var dg = dc.createRadialGradient(32,32,0,32,32,32); dg.addColorStop(0,'rgba(242,249,255,.8)'); dg.addColorStop(.3,'rgba(216,234,249,.32)'); dg.addColorStop(1,'rgba(216,234,249,0)'); dc.fillStyle = dg; dc.fillRect(0,0,64,64); }
  var flakes = [], burst = [];
  for (var i = 0; i < 105; i++) flakes.push({ x: random(), y: random(), r: .6 + random() * 2.7, v: .12 + random() * .34, drift: random() * 6.28, depth: random() });
  for (var k = 0; k < 95; k++) { var theta = random() * Math.PI * 2, speed = 50 + random() * 245; burst.push({ vx: Math.cos(theta) * speed, vy: Math.sin(theta) * speed - 65, r: 1.2 + random() * 8, life: .65 + random() * 1.2 }); }
  function clamp(n) { return Math.max(0, Math.min(1,n)); }
  function draw(now) {
    if (finished) return;
    var t = (now - startTime) / 1000, impact = .92, dt = t - impact;
    ctx.clearRect(0,0,w,h);
    var cx = w * .5, cy = h * .37;
    if (t < impact) {
      var p = clamp(t / impact), approach = Math.pow(p,2.8), radius = 5 + approach * Math.min(112,w*.27);
      var px = cx + (1-p) * w*.18, py = cy - (1-p) * h*.21;
      /* Short afterimages convey speed; the sphere visibly accelerates toward the viewer. */
      for (var trail = 5; trail > 0; trail--) {
        ctx.globalAlpha = .026 * (6-trail) * p;
        ctx.drawImage(ball,px-radius+trail*8*p,py-radius-trail*13*p,radius*2,radius*2);
      }
      ctx.globalAlpha = 1; ctx.save(); ctx.translate(px,py); ctx.rotate(-p*.8); ctx.drawImage(ball,-radius,-radius,radius*2,radius*2); ctx.restore();
    } else {
      /* A single brief powder flash, then ballistic chunks under gravity; no strobing. */
      if (dt < .25) {
        ctx.fillStyle = 'rgba(233,246,255,' + ((1-dt/.25)*.3) + ')'; ctx.fillRect(0,0,w,h);
      }
      for (var n = 0; n < burst.length; n++) {
        var b = burst[n]; if (dt > b.life + .6) continue;
        var age = dt, xx = cx + b.vx * age, yy = cy + b.vy * age + 150 * age * age;
        ctx.globalAlpha = clamp(1 - (age-.3)/(b.life+.2));
        if (n%4 === 0) { var s = (22+age*76)*(b.r/4); ctx.drawImage(dust,xx-s,yy-s,s*2,s*2); }
        else { ctx.fillStyle = n%3 ? '#eff7ff' : '#bfd8ec'; ctx.beginPath(); ctx.ellipse(xx,yy,b.r*(1+age*.3),b.r*.65,age+b.vx,0,Math.PI*2); ctx.fill(); }
      }
      var snowfall = clamp(dt * 1.5);
      for (var f = 0; f < flakes.length; f++) {
        var fl = flakes[f], fx = fl.x*w + Math.sin(t*.9+fl.drift)*16, fy = ((fl.y + dt*fl.v) % 1.15)*h - h*.08;
        ctx.globalAlpha = (.25 + fl.depth*.6)*snowfall;
        if (fl.depth > .87) ctx.drawImage(dust,fx-fl.r*4,fy-fl.r*4,fl.r*8,fl.r*8);
        else { ctx.fillStyle = '#f2f8ff'; ctx.beginPath(); ctx.arc(fx,fy,fl.r,0,Math.PI*2); ctx.fill(); }
      }
      /* Small, decaying impact recoil is confined to the scene, not the app UI. */
      if (dt < .24) scene.style.translate = Math.sin(dt*86)*(1-dt/.24)*3 + 'px ' + Math.cos(dt*68)*(1-dt/.24)*2 + 'px';
      else scene.style.translate = 'none';
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(draw);
  }
  function start() {
    if (started || finished) return; started = true; clearTimeout(loadTimer);
    film.classList.add('running'); startTime = performance.now();
    if (!reduced && ctx) raf = requestAnimationFrame(draw);
    endTimer = setTimeout(function () { finish(false); }, reduced ? 750 : 4250);
  }
  var images = film.querySelectorAll('[data-launch-src]'), loaded = 0;
  function imageReady() { loaded++; if (loaded === images.length) start(); }
  for (var im = 0; im < images.length; im++) {
    images[im].onload = imageReady; images[im].onerror = imageReady;
    images[im].src = images[im].getAttribute('data-launch-src');
  }
  /* Assets never gate access to the app, even offline or if decoding fails. */
  loadTimer = setTimeout(start, 650);
})();
