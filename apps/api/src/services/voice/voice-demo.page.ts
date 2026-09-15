/**
 * Sesli sipariş demo sayfası.
 *
 * Ayrı bir .html dosyası yerine TS içinde string olarak tutuluyor: api projesi
 * esbuild ile tek dosyaya bundle ediliyor ve project.json'da `assets: []` —
 * yani ayrı bir html dosyası dist'e KOPYALANMAZDI. Bu haliyle ek deploy adımı
 * gerektirmez.
 *
 * Sayfa OPENAI_API_KEY'i asla görmez; /session ucundan yalnızca kısa ömürlü
 * ephemeral anahtar alır ve onunla doğrudan OpenAI'a WebRTC kurar.
 */
export const VOICE_DEMO_HTML = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>OtOrder AI — Sesli Siparis Demosu</title>
<style>
  :root {
    --bg: #0e1116; --panel: #171b22; --line: #262c36; --fg: #e6e9ef;
    --muted: #98a2b3; --accent: #22c55e; --accent-2: #3b82f6; --danger: #ef4444;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--fg); min-height: 100vh;
    font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 28px 20px 60px; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: -0.01em; }
  .sub { color: var(--muted); font-size: 13px; margin: 0 0 22px; }
  .grid { display: grid; grid-template-columns: 1.25fr 1fr; gap: 18px; }
  @media (max-width: 860px) { .grid { grid-template-columns: 1fr; } }
  .panel {
    background: var(--panel); border: 1px solid var(--line);
    border-radius: 12px; padding: 16px;
  }
  .panel h2 {
    font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--muted); margin: 0 0 12px; font-weight: 600;
  }
  button {
    font: inherit; font-weight: 600; border: 0; border-radius: 9px;
    padding: 11px 18px; cursor: pointer; color: #06210f; background: var(--accent);
  }
  button.ghost { background: #2a313c; color: var(--fg); }
  button:disabled { opacity: 0.45; cursor: not-allowed; }
  .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #556; display: inline-block; }
  .dot.live { background: var(--accent); box-shadow: 0 0 0 4px rgba(34,197,94,.18); }
  .dot.err { background: var(--danger); }
  #status { color: var(--muted); font-size: 13px; }
  #timer { font-variant-numeric: tabular-nums; color: var(--muted); font-size: 13px; }
  #log {
    margin-top: 14px; max-height: 340px; overflow-y: auto;
    font-size: 13px; display: flex; flex-direction: column; gap: 7px;
  }
  .msg { padding: 8px 11px; border-radius: 9px; background: #1e242e; }
  .msg.you { background: #1b2b3f; }
  .msg.ada { background: #16301f; }
  .msg.fn { background: #2b2418; color: #f4d9a0; font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
  .msg.sys { background: transparent; color: var(--muted); font-size: 12px; padding: 2px 0; }
  .msg b { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin-bottom: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td { padding: 5px 0; border-bottom: 1px solid var(--line); }
  td.n { text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; }
  .total { display: flex; justify-content: space-between; margin-top: 10px; font-weight: 700; }
  .empty { color: var(--muted); font-size: 13px; }
  .menu-cat { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .07em; margin: 12px 0 4px; }
  .note {
    margin-top: 18px; padding: 12px 14px; border-radius: 10px;
    border: 1px solid #2c3a2e; background: #121b15;
    color: #a7d7b4; font-size: 12.5px;
  }
  .note code { color: #d7f5e0; }
  #orders { font-size: 12.5px; }
  #orders .o { border-bottom: 1px solid var(--line); padding: 8px 0; }
  #orders .o span { color: var(--muted); }
  /* Mikrofon seviye cubugu — "sesimi aliyor mu" sorusunu gorsel olarak yanitlar */
  .meter { flex:1; min-width:120px; height:8px; background:#1c2530; border-radius:99px; overflow:hidden; }
  .meter i { display:block; height:100%; width:0%; background:linear-gradient(90deg,#2f8f5b,#5ad18c); transition:width .06s linear; }
  .lat { font-size:12px; color:var(--muted); }
  .lat b { color:#5ad18c; }
  select { background:#141b23; color:#e8eef5; border:1px solid var(--line); border-radius:8px; padding:6px 8px; font-size:13px; }
  .msg.live { opacity:.65; font-style:italic; }
</style>
</head>
<body>
<div class="wrap">
  <h1 id="baslik">OtOrder AI — numarasiz sesli siparis demosu</h1>
  <p class="sub" id="altbaslik">
    Mikrofonla konusun. Yanit gercek zamanli sesle gelir; sepet degisiklikleri ve siparis
    OtOrder API'sindeki gercek siparis hattina yazilir. Izole sandbox tenant: <code>ai-sandbox</code>.
  </p>

  <div class="grid">
    <div>
      <div class="panel">
        <h2>Baglanti</h2>
        <div class="row">
          <button id="startBtn">Konusmayi baslat</button>
          <button id="stopBtn" class="ghost" disabled>Bitir</button>
          <span class="dot" id="dot"></span>
          <span id="status">Hazir</span>
          <span id="timer"></span>
        </div>
        <div class="row" style="margin-top:8px">
          <select id="modeSel" title="Konusma sirasi algilamasi">
            <option value="fast">Hizli yanit (sustuktan 0.5 sn sonra)</option>
            <option value="smart">Bolmeyen (cumleyi bitirmeni bekler)</option>
          </select>
          <span class="lat" id="lat"></span>
        </div>
        <div class="row" style="margin-top:8px">
          <span style="font-size:12px;color:var(--muted)">Mikrofon</span>
          <span class="meter"><i id="mic"></i></span>
        </div>
        <div id="log"></div>
      </div>

      <div class="note" id="guvenNotu">
        Guvenlik: bu sayfa OPENAI_API_KEY'i hicbir zaman gormez — sunucu her oturum icin
        kisa omurlu bir ephemeral anahtar uretir. Siparisler yalnizca <code>ai-sandbox</code>
        tenant'ina yazilir; bu tenant'in POS anahtarlari NULL oldugu icin siparis hicbir
        POS'a iletilmez.
      </div>
    </div>

    <div>
      <div class="panel">
        <h2>Sepet</h2>
        <div id="cart"><div class="empty">Sepet bos.</div></div>
      </div>

      <div class="panel" style="margin-top:18px" id="kanitPanel">
        <h2>Sandbox siparisleri (kanit)</h2>
        <div id="orders"><div class="empty">Henuz yok.</div></div>
        <div class="row" style="margin-top:10px">
          <button class="ghost" id="refreshOrders">Yenile</button>
        </div>
      </div>

      <div class="panel" style="margin-top:18px">
        <h2>Menu (oturuma gomulu)</h2>
        <div id="menu"><div class="empty">Oturum baslayinca yuklenir.</div></div>
      </div>
    </div>
  </div>
</div>

<audio id="remoteAudio" autoplay></audio>

<script>
(function () {
  var BASE = location.pathname.replace(/\\/demo\\/?$/, '');
  // ?t=<slug> -> oturum bu kiracinin GERCEK siparis hattina baglanir.
  var TENANT = new URLSearchParams(location.search).get('t') || '';
  var ASISTAN = 'Asistan';   // oturum acilinca sunucunun sectigi rastgele adla degisir

  // Konusma kaydi: kesinlesen satirlar kuyruga alinir, 4 sn'de bir sunucuya
  // yazilir (ses tarayici-OpenAI arasinda aktigi icin sunucu baska turlu goremez).
  var logKuyruk = [];
  function kaydet(role, text) {
    if (text) logKuyruk.push({ role: role, text: text });
  }
  function logGonder() {
    if (!sessionId || logKuyruk.length === 0) return;
    var events = logKuyruk.splice(0, 40);
    fetch(BASE + '/session/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId, events: events })
    }).catch(function () {});
  }
  setInterval(logGonder, 4000);
  var startBtn = document.getElementById('startBtn');
  var stopBtn = document.getElementById('stopBtn');
  var statusEl = document.getElementById('status');
  var timerEl = document.getElementById('timer');
  var dotEl = document.getElementById('dot');
  var logEl = document.getElementById('log');
  var cartEl = document.getElementById('cart');
  var menuEl = document.getElementById('menu');
  var ordersEl = document.getElementById('orders');

  var modeSel = document.getElementById('modeSel');
  var latEl = document.getElementById('lat');
  var micBar = document.getElementById('mic');

  var pc = null, dc = null, micStream = null, sessionId = null;
  var timerHandle = null, deadline = 0;
  var audioCtx = null, analyser = null, meterRaf = 0;
  var liveYou = null, liveAda = null;      // akan (kesinlesmemis) satirlar
  var spokeAt = 0;                          // konusmayi bitirdigin an — gecikme olcumu

  function setStatus(text, kind) {
    statusEl.textContent = text;
    dotEl.className = 'dot' + (kind ? ' ' + kind : '');
  }

  function log(kind, label, text) {
    var d = document.createElement('div');
    d.className = 'msg ' + kind;
    if (label) {
      var b = document.createElement('b');
      b.textContent = label;
      d.appendChild(b);
    }
    d.appendChild(document.createTextNode(text));
    logEl.appendChild(d);
    logEl.scrollTop = logEl.scrollHeight;
  }

  /**
   * Akan (henuz bitmemis) satir. Ayni turda tekrar tekrar guncellenir; tur
   * bitince finalize() ile kalicilastirilir. Konusurken ekranda ANINDA yazi
   * gorunmesini saglar — "sesimi almiyor" hissinin asil sebebi buydu.
   */
  function liveLine(ref, kind, label) {
    if (ref && ref.el && ref.el.parentNode) return ref;
    var d = document.createElement('div');
    d.className = 'msg ' + kind + ' live';
    var b = document.createElement('b');
    b.textContent = label;
    d.appendChild(b);
    var span = document.createElement('span');
    d.appendChild(span);
    logEl.appendChild(d);
    logEl.scrollTop = logEl.scrollHeight;
    return { el: d, span: span, text: '' };
  }

  function liveAppend(ref, delta) {
    if (!ref) return;
    ref.text += delta;
    ref.span.textContent = ref.text;
    logEl.scrollTop = logEl.scrollHeight;
  }

  function liveFinalize(ref, finalText) {
    if (!ref || !ref.el) return null;
    if (finalText) ref.span.textContent = finalText;
    ref.el.className = ref.el.className.replace(' live', '');
    return null;
  }

  /** Mikrofon seviyesi — kullanici sesinin gercekten alindiginin gorsel kaniti. */
  function startMeter(stream) {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = new Ctx();
      var src = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      var buf = new Uint8Array(analyser.frequencyBinCount);
      var draw = function () {
        if (!analyser) return;
        analyser.getByteTimeDomainData(buf);
        var peak = 0;
        for (var i = 0; i < buf.length; i++) {
          var v = Math.abs(buf[i] - 128) / 128;
          if (v > peak) peak = v;
        }
        micBar.style.width = Math.min(100, Math.round(peak * 180)) + '%';
        meterRaf = requestAnimationFrame(draw);
      };
      draw();
    } catch (e) { /* olcer sussa da demo calisir */ }
  }

  function stopMeter() {
    if (meterRaf) cancelAnimationFrame(meterRaf);
    meterRaf = 0;
    analyser = null;
    if (audioCtx) { try { audioCtx.close(); } catch (e) {} audioCtx = null; }
    micBar.style.width = '0%';
  }

  function renderCart(lines, total) {
    if (!lines || !lines.length) {
      cartEl.innerHTML = '<div class="empty">Sepet bos.</div>';
      return;
    }
    var html = '<table>';
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      html += '<tr><td>' + esc(l.adet + ' x ' + l.urun) + '</td><td class="n">' + l.ara_toplam + ' TL</td></tr>';
    }
    html += '</table><div class="total"><span>Toplam</span><span>' + (total || 0) + ' TL</span></div>';
    cartEl.innerHTML = html;
  }

  function renderMenu(items) {
    if (!items || !items.length) return;
    var byCat = {}, order = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!byCat[it.category]) { byCat[it.category] = []; order.push(it.category); }
      byCat[it.category].push(it);
    }
    var html = '';
    for (var c = 0; c < order.length; c++) {
      html += '<div class="menu-cat">' + esc(order[c]) + '</div><table>';
      var list = byCat[order[c]];
      for (var j = 0; j < list.length; j++) {
        html += '<tr><td>' + esc(list[j].name) + '</td><td class="n">' + list[j].price + ' TL</td></tr>';
      }
      html += '</table>';
    }
    menuEl.innerHTML = html;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function loadOrders() {
    fetch(BASE + '/orders').then(function (r) { return r.json(); }).then(function (j) {
      var rows = (j && j.data) || [];
      if (!rows.length) { ordersEl.innerHTML = '<div class="empty">Henuz yok.</div>'; return; }
      var html = '';
      for (var i = 0; i < rows.length; i++) {
        var o = rows[i];
        var names = [];
        for (var k = 0; k < o.items.length; k++) names.push(o.items[k].qty + 'x ' + o.items[k].name);
        html += '<div class="o"><b>#' + esc(o.orderNumber) + '</b> ' + esc(o.status) +
          ' &middot; ' + o.totalPrice + ' TL<br><span>' + esc(names.join(', ')) + '</span><br>' +
          '<span>POS id: ' + (o.externalOrderId ? esc(o.externalOrderId) : 'null (POS\\'a gitmedi)') + '</span></div>';
      }
      ordersEl.innerHTML = html;
    }).catch(function () {});
  }

  function tick() {
    var left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    timerEl.textContent = left > 0 ? '(' + left + ' sn)' : '';
    if (left <= 0) { stop('Oturum suresi doldu.'); }
  }

  async function callTool(name, args) {
    var res = await fetch(BASE + '/tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId, name: name, arguments: args })
    });
    var json = await res.json();
    return (json && json.data) || { ok: false, mesaj: 'Sunucuya ulasilamadi.' };
  }

  function onEvent(ev) {
    var msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    var t = msg.type;

    // --- Konusma sirasi: ne zaman dinliyor, ne zaman yanitliyor ---
    // Bu iki olay olmadan ekran sessiz kaliyordu ve mikrofon calismiyor gibi
    // hissettiriyordu. Artik konusmaya basladigin an durum degisiyor.
    if (t === 'input_audio_buffer.speech_started') {
      setStatus('Sizi dinliyorum...', 'live');
      latEl.textContent = '';
      liveYou = liveLine(liveYou, 'you', 'Siz');
      return;
    }
    if (t === 'input_audio_buffer.speech_stopped') {
      setStatus('Yanit hazirlaniyor...', 'live');
      spokeAt = Date.now();   // gecikme olcumunun baslangici
      return;
    }

    // --- Sizin sesiniz yaziya donerken (akan) ---
    if (t === 'conversation.item.input_audio_transcription.delta' && msg.delta) {
      liveYou = liveLine(liveYou, 'you', 'Siz');
      liveAppend(liveYou, msg.delta);
      return;
    }
    if (t === 'conversation.item.input_audio_transcription.completed') {
      if (liveYou) liveYou = liveFinalize(liveYou, msg.transcript || '');
      else if (msg.transcript) log('you', 'Siz', msg.transcript);
      kaydet('musteri', msg.transcript || '');
      return;
    }

    // --- Ada'nin yaniti akarken ---
    if (t === 'response.output_audio_transcript.delta' || t === 'response.audio_transcript.delta') {
      if (spokeAt) {
        // Sustugun andan Ada'nin ilk kelimesine kadar gecen sure.
        latEl.innerHTML = 'Yanit gecikmesi: <b>' + (Date.now() - spokeAt) + ' ms</b>';
        spokeAt = 0;
      }
      setStatus(ASISTAN + ' konusuyor', 'live');
      liveAda = liveLine(liveAda, 'ada', ASISTAN);
      liveAppend(liveAda, msg.delta || '');
      return;
    }
    if (t === 'response.output_audio_transcript.done' || t === 'response.audio_transcript.done') {
      if (liveAda) liveAda = liveFinalize(liveAda, msg.transcript || '');
      else if (msg.transcript) log('ada', ASISTAN, msg.transcript);
      kaydet('asistan', msg.transcript || '');
      setStatus('Baglandi — konusabilirsiniz', 'live');
      return;
    }

    if (t === 'error') {
      log('sys', '', 'Hata: ' + ((msg.error && msg.error.message) || 'bilinmeyen'));
      return;
    }
    if (t === 'response.function_call_arguments.done') {
      handleFunctionCall(msg);
    }
  }

  async function handleFunctionCall(msg) {
    var args = {};
    try { args = JSON.parse(msg.arguments || '{}'); } catch (e) { args = {}; }
    log('fn', 'Fonksiyon', msg.name + ' ' + JSON.stringify(args));

    var result = await callTool(msg.name, args);
    log('fn', 'Sonuc', JSON.stringify(result));

    if (result.sepet !== undefined) renderCart(result.sepet, result.toplam);
    if (result.siparis_no) { loadOrders(); }

    if (dc && dc.readyState === 'open') {
      dc.send(JSON.stringify({
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id: msg.call_id, output: JSON.stringify(result) }
      }));
      dc.send(JSON.stringify({ type: 'response.create' }));
    }
  }

  async function negotiate(sdp, model, callsUrl, secret) {
    var attempt = async function (url) {
      return fetch(url, {
        method: 'POST',
        body: sdp,
        headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/sdp' }
      });
    };
    var res = await attempt(callsUrl + '?model=' + encodeURIComponent(model));
    if (res.status === 404 || res.status === 405) {
      // Eski (beta) WebRTC ucu
      res = await attempt('https://api.openai.com/v1/realtime?model=' + encodeURIComponent(model));
    }
    if (!res.ok) {
      var body = await res.text().catch(function () { return ''; });
      throw new Error('OpenAI WebRTC reddetti (' + res.status + '): ' + body.slice(0, 300));
    }
    // Location: /v1/realtime/calls/rtc_xxx  -> sunucunun sure dolunca cagriyi
    // kapatabilmesi icin cagri kimligini cikar (CORS'ta acik degilse null).
    var callId = null;
    try {
      var loc = res.headers.get('Location');
      if (loc) {
        var m = String(loc).match(/\\/calls\\/([A-Za-z0-9_-]+)/);
        if (m) callId = m[1];
      }
    } catch (e) { callId = null; }
    var sdpAnswer = await res.text();
    return { sdp: sdpAnswer, callId: callId };
  }

  async function start() {
    startBtn.disabled = true;
    setStatus('Oturum aliniyor...');
    try {
      var res = await fetch(BASE + '/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: modeSel.value, tenant: TENANT })
      });
      var json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error((json && json.error && json.error.message) || 'Oturum acilamadi');
      }
      var data = json.data;
      sessionId = data.sessionId;
      if (data.tenantName) {
        // textContent: tenant adi DB'den gelir, HTML olarak islenmemeli.
        document.getElementById('baslik').textContent = data.tenantName + ' — sesli siparis hatti';
        document.getElementById('altbaslik').textContent =
          'Mikrofonla konusun. Siparisiniz dogrudan ' + data.tenantName + ' mutfagina iletilir.';
        // Sandbox'a ozgu paneller gercek hat modunda yanlis/anlamsiz.
        document.getElementById('guvenNotu').style.display = 'none';
        document.getElementById('kanitPanel').style.display = 'none';
      }
      if (data.assistantName) ASISTAN = data.assistantName;
      renderMenu(data.menu);
      renderCart([], 0);

      setStatus('Mikrofon izni bekleniyor...');
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });

      startMeter(micStream);

      pc = new RTCPeerConnection();
      pc.ontrack = function (e) { document.getElementById('remoteAudio').srcObject = e.streams[0]; };
      pc.addTrack(micStream.getAudioTracks()[0], micStream);
      pc.onconnectionstatechange = function () {
        if (pc && (pc.connectionState === 'failed' || pc.connectionState === 'disconnected')) {
          stop('Baglanti koptu.');
        }
      };

      dc = pc.createDataChannel('oai-events');
      dc.addEventListener('message', onEvent);
      dc.addEventListener('open', function () {
        setStatus('Baglandi — konusabilirsiniz', 'live');
        log('sys', '', 'Oturum acildi. ' + ASISTAN + ' birazdan selam verecek.');
      });

      var offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      setStatus('OpenAI ile el sikisiliyor...');

      var negotiated = await negotiate(offer.sdp, data.model, data.realtimeCallsUrl, data.clientSecret);
      await pc.setRemoteDescription({ type: 'answer', sdp: negotiated.sdp });

      if (negotiated.callId) {
        fetch(BASE + '/session/call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sessionId, callId: negotiated.callId })
        }).catch(function () {});
      }

      stopBtn.disabled = false;
      deadline = data.sessionExpiresAt;
      timerHandle = setInterval(tick, 500);
      tick();
    } catch (err) {
      setStatus('Hata: ' + (err && err.message ? err.message : err), 'err');
      log('sys', '', String(err && err.message ? err.message : err));
      cleanup();
      startBtn.disabled = false;
    }
  }

  function cleanup() {
    if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
    timerEl.textContent = '';
    stopMeter();
    liveYou = liveFinalize(liveYou);
    liveAda = liveFinalize(liveAda);
    spokeAt = 0;
    if (dc) { try { dc.close(); } catch (e) {} dc = null; }
    if (pc) { try { pc.close(); } catch (e) {} pc = null; }
    if (micStream) {
      micStream.getTracks().forEach(function (t) { t.stop(); });
      micStream = null;
    }
  }

  function stop(reason) {
    logGonder(); // kuyruktaki son satirlar oturum kapanmadan yazilsin
    if (sessionId) {
      fetch(BASE + '/session/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionId })
      }).catch(function () {});
    }
    cleanup();
    sessionId = null;
    stopBtn.disabled = true;
    startBtn.disabled = false;
    setStatus(reason || 'Bitti');
    loadOrders();
  }

  startBtn.addEventListener('click', start);
  stopBtn.addEventListener('click', function () { stop('Bitti'); });
  document.getElementById('refreshOrders').addEventListener('click', loadOrders);
  window.addEventListener('beforeunload', function () { if (sessionId) stop(); });

  if (!navigator.mediaDevices || !window.RTCPeerConnection) {
    setStatus('Bu tarayici WebRTC/mikrofon desteklemiyor.', 'err');
    startBtn.disabled = true;
  } else if (!window.isSecureContext) {
    setStatus('Mikrofon icin HTTPS ya da localhost gerekli.', 'err');
    startBtn.disabled = true;
  }

  loadOrders();
})();
</script>
</body>
</html>`;
