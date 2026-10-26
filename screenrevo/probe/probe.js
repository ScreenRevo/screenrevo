/**
 * ScreenRevo probe: what a Developer Mode web app can do on this Samsung TV.
 *
 * Runs each test once, shows the results on screen (big enough for a photo) and sends them to collect.py on the
 * computer when the build named one. Keys, voice commands and the app going to the background are logged as they come.
 * Off the TV (a browser preview) the TV's tests are skipped and the rest still runs.
 * Plain ES5, like web/: Tizen's Chromium is older than a desktop's.
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  var CONFIG = window.PROBE_CONFIG || {};
  var tizen = window.tizen;
  var webapis = window.webapis;

  var TESTS = [
    ['platform', 'Sistema e modelo'],
    ['keys', 'Teclas do controle'],
    ['home', 'Botão Home'],
    ['apps', 'Apps instalados'],
    ['hdmi', 'Entradas HDMI'],
    ['hdmiPreview', 'Prévia HDMI no app'],
    ['voice', 'Voz dentro do app'],
    ['perf', 'Fluidez da página'],
    ['video', 'Vídeo com filtro']
  ];
  var BADGES = {ok: 'OK', partial: 'PARCIAL', fail: 'FALHOU', skip: 'PULADO', run: 'TESTANDO', wait: 'AGUARDA'};

  var report = {probe: VERSION, built: CONFIG.built || '', startedAt: new Date().toISOString(), tests: {}, events: []};
  var keyNames = {37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown', 13: 'Enter', 10009: 'Back'};
  var lastKey = null;
  var focus = 0;
  var hdmiShown = false;

  function $(id) { return document.getElementById(id); }
  function message(e) { return e ? (e.name ? e.name + ': ' : '') + (e.message || String(e)) : 'erro'; }
  function result(status, summary, data) { return {status: status, summary: summary, data: data || {}}; }
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** done(r) once: the first of the test's own answer and a timeout. */
  function guard(done, ms) {
    var called = false;
    var timer = setTimeout(function () { finish(result('fail', 'Sem resposta em ' + ms / 1000 + ' s')); }, ms);
    function finish(r) {
      if (called) return;
      called = true;
      clearTimeout(timer);
      done(r);
    }
    return finish;
  }

  /** A systeminfo property: got(value) or got(null, error). */
  function property(name, got) {
    try {
      tizen.systeminfo.getPropertyValue(name, function (v) { got(v); }, function (e) { got(null, e); });
    } catch (e) {
      got(null, e);
    }
  }

  function sourceName(s) { return s ? s.type + (s.number ? ' ' + s.number : '') : ''; }

  // MARK: - Screen

  function render() {
    var rows = '';
    for (var i = 0; i < TESTS.length; i++) {
      var r = report.tests[TESTS[i][0]] || result('wait', '…');
      rows += '<tr class="' + r.status + '"><td class="name">' + TESTS[i][1] + '</td><td class="badge"><span>' +
        BADGES[r.status] + '</span></td><td class="summary">' + escapeHtml(r.summary) + '</td></tr>';
    }
    $('tests').innerHTML = rows;
  }

  function subtitle(collector) {
    $('sub').innerHTML = 'v' + VERSION + (CONFIG.built ? ' · build ' + escapeHtml(CONFIG.built) : '') + '<br>' +
      (CONFIG.collector ? 'PC: ' + escapeHtml(CONFIG.collector) + ' · ' + collector : 'Sem PC configurado: resultados só na tela');
  }

  var toastTimer = null;
  function toast(text) {
    var t = $('toast');
    t.textContent = text;
    t.className = 'show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ''; }, 3500);
  }

  function note(id, r) {
    report.tests[id] = r;
    render();
    sendSoon();
  }

  // MARK: - Events and the collector

  var pending = [];

  function logEvent(type, detail) {
    var e = {t: new Date().toISOString(), type: type, detail: detail};
    report.events.push(e);
    if (report.events.length > 500) report.events.shift();
    pending.push(e);
    var line = document.createElement('div');
    line.textContent = e.t.substr(11, 8) + '  ' + type + '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail));
    var box = $('events');
    box.insertBefore(line, box.firstChild);
    while (box.childNodes.length > 14) box.removeChild(box.lastChild);
  }

  function post(path, body, done) {
    if (!CONFIG.collector) { if (done) done(false); return; }
    try {
      var x = new XMLHttpRequest();
      x.open('POST', CONFIG.collector + path, true);
      x.setRequestHeader('Content-Type', 'text/plain');   // a simple request: no CORS preflight
      x.timeout = 8000;
      x.onreadystatechange = function () {
        if (x.readyState === 4 && done) done(x.status >= 200 && x.status < 300);
      };
      x.send(JSON.stringify(body));
    } catch (e) {
      if (done) done(false);
    }
  }

  function sendReport() {
    report.sentAt = new Date().toISOString();
    subtitle('enviando…');
    post('/results', report, function (ok) {
      subtitle(ok ? 'resultados enviados ' + report.sentAt.substr(11, 8) : 'o PC não respondeu');
    });
  }

  var sendTimer = null;
  function sendSoon() {
    clearTimeout(sendTimer);
    sendTimer = setTimeout(sendReport, 2000);
  }

  setInterval(function () {
    if (pending.length) post('/event', {events: pending.splice(0, pending.length)});
  }, 1500);

  // MARK: - Remote and buttons

  var ACTIONS = [
    ['Repetir testes', function () { runAll(); }],
    ['Prévia HDMI', function () { toggleHdmi(); }],
    ['Teste de vídeo', function () { runOne('video'); }],
    ['Enviar ao PC', function () { sendReport(); }],
    ['Sair', function () { quit(); }]
  ];

  function renderActions() {
    var html = '';
    for (var i = 0; i < ACTIONS.length; i++) {
      html += '<span class="btn' + (i === focus ? ' focus' : '') + '">' + ACTIONS[i][0] + '</span>';
    }
    $('actions').innerHTML = html;
  }

  function setFocus(i) {
    focus = (i + ACTIONS.length) % ACTIONS.length;
    renderActions();
  }

  function activate() { ACTIONS[focus][1](); }

  function quit() {
    try {
      tizen.application.getCurrentApplication().exit();
    } catch (e) {
      toast('Fora da TV não há como sair');
    }
  }

  document.addEventListener('keydown', function (e) {
    var code = e.keyCode;
    lastKey = {code: code, name: keyNames[code] || e.key || '', at: Date.now()};
    logEvent('tecla', code + ' ' + lastKey.name);
    if (lastKey.name === 'Home' || lastKey.name === 'MediaHome') {
      note('home', result('ok', 'O app recebeu o Home (' + code + ')'));
    }
    if (code === 37 || code === 38) setFocus(focus - 1);
    else if (code === 39 || code === 40) setFocus(focus + 1);
    else if (code === 13) activate();
    else if (code === 10009) toast('Voltar recebido (10009). Para sair, use o botão Sair.');
    else return;
    e.preventDefault();
  });

  document.addEventListener('visibilitychange', function () {
    logEvent('app', document.hidden ? 'escondido' : 'visível');
    if (!document.hidden) return;
    // Home goes to Samsung's home screen without the app seeing a key: the system keeps it.
    var keyFirst = lastKey && Date.now() - lastKey.at < 1500;
    var r = report.tests.home;
    if (!r || r.status !== 'ok') {
      note('home', keyFirst ?
        result('partial', 'App foi para trás logo depois da tecla ' + lastKey.code + ' ' + lastKey.name) :
        result('fail', 'App foi para trás sem receber tecla: o sistema fica com o Home'));
    }
  });

  // MARK: - Tests

  var RUN = {};

  RUN.platform = function (done) {
    var d = {
      userAgent: navigator.userAgent,
      screen: screen.width + 'x' + screen.height,
      viewport: window.innerWidth + 'x' + window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      cores: navigator.hardwareConcurrency || null,
      deviceMemoryGB: navigator.deviceMemory || null,
      webAssembly: typeof window.WebAssembly === 'object',
      tizentvwasm: typeof window.tizentvwasm !== 'undefined'
    };
    if (!tizen) { done(result('skip', 'Fora da TV: só os dados do navegador', d)); return; }
    try { d.platformVersion = tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version'); } catch (e) { d.platformVersionError = message(e); }
    try { d.modelName = tizen.systeminfo.getCapability('http://tizen.org/system/model_name'); } catch (e) {}
    try { d.totalMemoryMB = Math.round(tizen.systeminfo.getTotalMemory() / 1048576); } catch (e) {}
    try { d.availableMemoryMB = Math.round(tizen.systeminfo.getAvailableMemory() / 1048576); } catch (e) {}
    var p = webapis && webapis.productinfo;
    if (p) {
      // No getDuid: the DUID identifies this TV and stays out of the report.
      ['getVersion', 'getFirmware', 'getModel', 'getRealModel', 'getModelCode', 'getSmartTVServerVersion',
        'isUdPanelSupported', 'is8KPanelSupported'].forEach(function (m) {
        try { d[m] = p[m](); } catch (e) { d[m] = 'erro: ' + message(e); }
      });
    } else {
      d.productinfo = 'indisponível';
    }
    property('BUILD', function (v, err) {
      if (v) { d.buildVersion = v.buildVersion; d.buildModel = v.model; } else d.buildError = message(err);
      property('CPU', function (cpu) {
        if (cpu) d.cpuLoad = cpu.load;
        done(result('ok', 'Tizen ' + (d.platformVersion || '?') + ' · ' + (d.buildModel || d.getRealModel || d.modelName || '?') +
          ' · ' + (d.buildVersion || d.getFirmware || '?') + (d.totalMemoryMB ? ' · ' + d.totalMemoryMB + ' MB' : ''), d));
      });
    });
  };

  RUN.keys = function (done) {
    if (!tizen || !tizen.tvinputdevice) { done(result('skip', 'tvinputdevice indisponível')); return; }
    var supported = [], registered = [], refused = [];
    try { supported = tizen.tvinputdevice.getSupportedKeys(); } catch (e) { done(result('fail', 'getSupportedKeys: ' + message(e))); return; }
    for (var i = 0; i < supported.length; i++) {
      var k = supported[i];
      keyNames[k.code] = k.name;
      try { tizen.tvinputdevice.registerKey(k.name); registered.push(k.name); } catch (e) { refused.push(k.name + ': ' + message(e)); }
    }
    var names = supported.map(function (k) { return k.name + '=' + k.code; });
    var home = supported.filter(function (k) { return /home/i.test(k.name); }).map(function (k) { return k.name; });
    var d = {supported: names, registered: registered, refused: refused, homeInList: home};
    try { d.getKeyHome = tizen.tvinputdevice.getKey('Home'); } catch (e) { d.getKeyHome = 'erro: ' + message(e); }
    if (!report.tests.home) {
      report.tests.home = result('wait', 'Aperte Home e volte para este app' + (home.length ? ' (' + home.join(', ') + ' na lista)' : ''));
    }
    done(result(registered.length ? 'ok' : 'fail', registered.length + ' de ' + supported.length + ' teclas extras capturadas' +
      (home.length ? '; Home na lista' : '; Home fora da lista'), d));
  };

  RUN.apps = function (done) {
    if (!tizen) { done(result('skip', 'Fora da TV')); return; }
    var d = {};
    try { d.self = tizen.application.getCurrentApplication().appInfo.id; } catch (e) { d.selfError = message(e); }
    try {
      tizen.application.getAppsInfo(function (list) {
        var visible = list.filter(function (a) { return a.show !== false; });
        d.count = list.length;
        d.visible = visible.map(function (a) { return a.id + ' | ' + (a.name || ''); }).sort();
        done(result('ok', list.length + ' apps (' + visible.length + ' visíveis) · ID deste: ' + (d.self || '?'), d));
      }, function (e) { done(result('fail', 'getAppsInfo: ' + message(e), d)); });
    } catch (e) {
      done(result('fail', 'getAppsInfo: ' + message(e), d));
    }
  };

  RUN.hdmi = function (done) {
    if (!tizen) { done(result('skip', 'Fora da TV')); return; }
    var d = {};
    property('VIDEOSOURCE', function (v, err) {
      if (v) {
        d.connected = (v.connected || []).map(sourceName);
        d.disconnected = (v.disconnected || []).map(sourceName);
      } else {
        d.videoSourceError = message(err);
      }
      if (!tizen.tvwindow) { done(result('fail', 'tvwindow indisponível', d)); return; }
      try { d.current = sourceName(tizen.tvwindow.getSource('MAIN')); } catch (e) { d.currentError = message(e); }
      try {
        tizen.tvwindow.getAvailableWindows(function (w) {
          d.windows = w;
          finish();
        }, function (e) { d.windowsError = message(e); finish(); });
      } catch (e) {
        d.windowsError = message(e);
        finish();
      }
    });
    function finish() {
      if (!report.tests.hdmiPreview) report.tests.hdmiPreview = result('wait', 'Aperte OK em "Prévia HDMI"');
      done(result(d.connected ? 'ok' : 'partial', 'Conectadas: ' + ((d.connected || []).join(', ') || 'nenhuma') +
        (d.current ? ' · na tela: ' + d.current : ''), d));
    }
  };

  function toggleHdmi() {
    if (!tizen || !tizen.tvwindow) { toast('Sem tvwindow fora da TV'); return; }
    if (hdmiShown) {
      try { tizen.tvwindow.hide(function () {}, function (e) { logEvent('hdmi', 'hide: ' + message(e)); }, 'MAIN'); } catch (e) {}
      hdmiShown = false;
      document.documentElement.className = document.body.className = '';
      logEvent('hdmi', 'prévia fechada');
      return;
    }
    property('VIDEOSOURCE', function (v) {
      var list = (v && v.connected) || [], source = null;
      for (var i = 0; i < list.length && !source; i++) if (list[i].type === 'HDMI') source = list[i];
      if (!source) { note('hdmiPreview', result('fail', 'Nenhuma HDMI conectada')); return; }
      function show() {
        try {
          tizen.tvwindow.show(function () {
            hdmiShown = true;
            document.documentElement.className = document.body.className = 'hole';
            note('hdmiPreview', result('ok', sourceName(source) + ' aparece dentro do app? Confira no canto'));
            logEvent('hdmi', 'prévia de ' + sourceName(source));
          }, function (e) {
            note('hdmiPreview', result('fail', 'show: ' + message(e)));
          }, ['960px', '0px', '960px', '540px'], 'MAIN');
        } catch (e) {
          note('hdmiPreview', result('fail', 'show: ' + message(e)));
        }
      }
      try {
        tizen.tvwindow.setSource(source, show, function (e) { note('hdmiPreview', result('fail', 'setSource: ' + message(e))); }, 'MAIN');
      } catch (e) {
        note('hdmiPreview', result('fail', 'setSource: ' + message(e)));
      }
    });
  }

  // Voice: every callback the assistant can call. Any of them arriving proves it talks to the app.
  var VOICE_LOGGED = ['onplay', 'onpause', 'onfastforward', 'onrewind', 'onrestart', 'onchangeappstate',
    'onchangeprevioustrack', 'onchangenexttrack', 'onskipbackward', 'onskipforward', 'onsetplayposition',
    'onchangesubtitlemode', 'onchangeshufflemode', 'onchangescreenfitmode', 'onzoom', 'onrotate', 'onchange360mode',
    'onchangerepeatmode', 'ontitleselection', 'onadditiontolist', 'onremovalfromlist', 'onplaylist', 'onbrowselist',
    'onskipad'];

  function heard(name, arg) {
    logEvent('voz', name + (arg === undefined ? '' : ' ' + arg));
    note('voice', result('ok', 'O assistente falou com o app: ' + name + (arg === undefined ? '' : ' ' + arg)));
  }

  function voiceCallbacks() {
    var c = {
      onupdatestate: function () { heard('onupdatestate'); return 'List'; },
      onnavigation: function (nav) {
        heard('onnavigation', nav);
        if (nav === 'NAV_UP' || nav === 'NAV_LEFT' || nav === 'NAV_PREVIOUS') setFocus(focus - 1);
        else if (nav === 'NAV_DOWN' || nav === 'NAV_RIGHT' || nav === 'NAV_NEXT') setFocus(focus + 1);
        return true;
      },
      onselection: function (n) {
        heard('onselection', n);
        if (n === 0) activate();
        else if (n === -1) setFocus(ACTIONS.length - 1);
        else if (n > 0 && n <= ACTIONS.length) setFocus(n - 1);
        return true;
      }
    };
    VOICE_LOGGED.forEach(function (name) {
      c[name] = function (arg) { heard(name, arg); return true; };
    });
    return c;
  }

  RUN.voice = function (done) {
    var v = webapis && webapis.voiceinteraction;
    if (!v) { done(result(tizen ? 'fail' : 'skip', 'webapis.voiceinteraction indisponível')); return; }
    var d = {};
    try { d.version = v.getVersion(); } catch (e) { d.versionError = message(e); }
    try {
      v.setCallback(voiceCallbacks());
      v.listen();
      d.listening = true;
    } catch (e) {
      d.listenError = message(e);
    }
    if (d.listening) done(result('partial', 'Ouvindo: segure o microfone e diga "para baixo" ou "selecionar"', d));
    else done(result('fail', 'Recusada: ' + d.listenError, d));
  };

  RUN.perf = function (done) {
    var d = {};
    try {
      var t = performance.timing;
      if (t && t.navigationStart) d.untilProbeMs = Date.now() - t.navigationStart;
    } catch (e) {}
    try { if (performance.memory) d.jsHeapMB = Math.round(performance.memory.usedJSHeapSize / 1048576); } catch (e) {}
    var frames = 0, slow = 0, start = 0, last = 0;
    function tick(now) {
      if (!start) { start = last = now; window.requestAnimationFrame(tick); return; }
      frames++;
      if (now - last > 34) slow++;
      last = now;
      if (now - start < 3000) { window.requestAnimationFrame(tick); return; }
      d.idleFps = Math.round(frames * 1000 / (now - start));
      d.slowFrames = slow;
      done(result(d.idleFps >= 55 ? 'ok' : 'partial', d.idleFps + ' fps parado · ' + slow + ' quadros lentos em 3 s', d));
    }
    window.requestAnimationFrame(tick);
  };

  // Video: a test clip without DRM, its frames uploaded to WebGL and sharpened (left half as it is, right half
  // sharpened). Tells whether a filter on our own video is possible here, and how fast.
  var VERT = 'attribute vec2 p; varying vec2 uv;' +
    'void main() { uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }';
  // A contrast-adaptive sharpen in the spirit of AMD's CAS: less where the neighborhood already has contrast.
  var FRAG = 'precision mediump float; uniform sampler2D tex; uniform vec2 px; varying vec2 uv;' +
    'void main() {' +
    ' vec3 c = texture2D(tex, uv).rgb;' +
    ' vec3 n = texture2D(tex, uv - vec2(0.0, px.y)).rgb;' +
    ' vec3 s = texture2D(tex, uv + vec2(0.0, px.y)).rgb;' +
    ' vec3 e = texture2D(tex, uv + vec2(px.x, 0.0)).rgb;' +
    ' vec3 w = texture2D(tex, uv - vec2(px.x, 0.0)).rgb;' +
    ' vec3 mn = min(c, min(min(n, s), min(e, w)));' +
    ' vec3 mx = max(c, max(max(n, s), max(e, w)));' +
    ' vec3 k = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, vec3(0.0001)), 0.0, 1.0)) * 0.2;' +
    ' vec3 r = (c - k * (n + s + e + w)) / (1.0 - 4.0 * k);' +
    ' if (uv.x < 0.5) r = c;' +
    ' if (abs(uv.x - 0.5) < 0.0008) r = vec3(1.0);' +
    ' gl_FragColor = vec4(clamp(r, 0.0, 1.0), 1.0);' +
    '}';

  function shader(gl, type, source) {
    var s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
    return s;
  }

  var gl = null, glVersion = 0, glProgram = null, glTexture = null;

  function setupGl() {
    if (gl) return;
    var canvas = $('gl');
    try { gl = canvas.getContext('webgl2'); if (gl) glVersion = 2; } catch (e) {}
    if (!gl) {
      try { gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl'); if (gl) glVersion = 1; } catch (e) {}
    }
    if (!gl) return;
    glProgram = gl.createProgram();
    gl.attachShader(glProgram, shader(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(glProgram, shader(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(glProgram);
    if (!gl.getProgramParameter(glProgram, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(glProgram) || 'link');
    gl.useProgram(glProgram);
    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var p = gl.getAttribLocation(glProgram, 'p');
    gl.enableVertexAttribArray(p);
    gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
    glTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, glTexture);
    // Not a power of two: WebGL 1 needs clamping and no mipmaps.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(gl.getUniformLocation(glProgram, 'tex'), 0);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  RUN.video = function (done) {
    var d = {clip: CONFIG.video || ''};
    try { setupGl(); } catch (e) { done(result('fail', 'Shader: ' + message(e))); return; }
    if (!gl) { done(result('fail', 'Sem WebGL')); return; }
    d.webgl = glVersion;
    try {
      var info = gl.getExtension('WEBGL_debug_renderer_info');
      d.renderer = gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
      d.vendor = gl.getParameter(info ? info.UNMASKED_VENDOR_WEBGL : gl.VENDOR);
      d.glVersion = gl.getParameter(gl.VERSION);
      d.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    } catch (e) {}
    if (!CONFIG.video) { done(result('skip', 'WebGL ' + glVersion + ' ok · build sem vídeo de teste', d)); return; }

    var video = $('video');
    var finished = false;
    function end(r) {
      if (finished) return;
      finished = true;
      try { video.pause(); } catch (e) {}
      done(r);
    }
    video.onerror = function () {
      end(result('fail', 'O vídeo de teste não tocou (erro ' + (video.error ? video.error.code : '?') + ')', d));
    };
    video.onplaying = function () {
      video.onplaying = null;
      measure();
    };
    if (video.getAttribute('src') !== CONFIG.video) video.src = CONFIG.video;
    try { video.currentTime = 0; } catch (e) {}
    var played = video.play();
    if (played && played.catch) played.catch(function (e) { end(result('fail', 'play: ' + message(e), d)); });

    function measure() {
      d.videoSize = video.videoWidth + 'x' + video.videoHeight;
      gl.uniform2f(gl.getUniformLocation(glProgram, 'px'), 1 / (video.videoWidth || 1920), 1 / (video.videoHeight || 1080));
      var phase = 'upload', frames = 0, start = 0;
      function frame(now) {
        if (finished) return;
        if (!start) start = now;
        if (phase === 'upload') {
          try {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
          } catch (e) {
            end(result('fail', 'texImage2D: ' + message(e), d));
            return;
          }
        }
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        frames++;
        if (phase === 'upload' && frames === 30) d.pixels = sample();
        if (phase === 'upload' && now - start >= 5000) {
          d.fpsUploadAndFilter = Math.round(frames * 1000 / (now - start));
          phase = 'filter';
          frames = 0;
          start = now;
        } else if (phase === 'filter' && now - start >= 3000) {
          d.fpsFilterOnly = Math.round(frames * 1000 / (now - start));
          verdict();
          return;
        }
        window.requestAnimationFrame(frame);
      }
      window.requestAnimationFrame(frame);
    }

    /** A 16×16 block from the middle of the frame: black means the frames never reached WebGL. */
    function sample() {
      var size = 16, px = new Uint8Array(size * size * 4);
      gl.readPixels(960 - size / 2, 540 - size / 2, size, size, gl.RGBA, gl.UNSIGNED_BYTE, px);
      var sum = 0, min = 255, max = 0;
      for (var i = 0; i < px.length; i += 4) {
        var y = (px[i] + px[i + 1] + px[i + 2]) / 3;
        sum += y;
        if (y < min) min = y;
        if (y > max) max = y;
      }
      return {mean: Math.round(sum / (size * size)), min: Math.round(min), max: Math.round(max)};
    }

    function verdict() {
      var p = d.pixels || {mean: 0, max: 0};
      var reached = p.max > 8;
      var fps = d.fpsUploadAndFilter;
      var text = (reached ? 'Quadros chegam ao WebGL' : 'Quadros chegam pretos (vídeo vai direto ao hardware)') +
        ' · ' + fps + ' fps com filtro em ' + d.videoSize + ' · GPU: ' + (d.renderer || '?');
      end(result(!reached ? 'fail' : fps >= 28 ? 'ok' : 'partial', text, d));
    }
  };

  // MARK: - Running

  var ORDER = ['platform', 'keys', 'apps', 'hdmi', 'voice', 'perf', 'video'];
  var running = false;   // one run at a time: a second one would race the first for the video and the frame loop

  function runOne(id, then) {
    var alone = !then;
    if (alone && running) { toast('Espere os testes terminarem'); return; }
    if (alone) running = true;
    report.tests[id] = result('run', 'Testando…');
    render();
    var finish = guard(function (r) {
      report.tests[id] = r;
      render();
      logEvent('teste', id + ': ' + r.status);
      if (alone) { running = false; sendSoon(); } else then();
    }, id === 'video' ? 40000 : 12000);
    try {
      RUN[id](finish);
    } catch (e) {
      finish(result('fail', 'Erro: ' + message(e)));
    }
  }

  function runAll() {
    if (running) { toast('Espere os testes terminarem'); return; }
    running = true;
    var i = 0;
    (function next() {
      if (i >= ORDER.length) {
        running = false;
        report.finishedAt = new Date().toISOString();
        sendReport();
        return;
      }
      runOne(ORDER[i++], next);
    })();
  }

  subtitle(CONFIG.collector ? 'aguardando' : '');
  renderActions();
  render();
  runAll();
})();
