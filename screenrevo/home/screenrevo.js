/**
 * ScreenRevo on top of Free My TV's home screen (web/), without changing it:
 *  - Live inputs: the drawer's card row gets a card of its own on the left, and the weather and prices cards move to
 *    its right, scaled down together to share the row. An input that keeps the focus for a moment shows its live
 *    picture in that card. Samsung's TV window lies under the page, so the page's background gets a hole there. OK
 *    opens the input as before, already on that source. A device turned on or off shows on its key at once, and the
 *    card says when the input under the focus has nothing on.
 *  - The remote's Source key opens the drawer on the input on screen; each press goes to the next connected one.
 * It reads Free My TV's state through window.FreeMyTV and the TV through window.TV, and registers only the Source
 * key: never the volume, which would stop working while the home screen is open.
 * Plain ES5, like web/: Tizen's Chromium is older than a desktop's.
 */
(function () {
  'use strict';

  var app = window.FreeMyTV;
  var tizen = window.tizen;
  if (!app || !window.TV) return;

  var SOURCE_KEY = 10072;
  var REST = 450;      // ms the focus rests on an input before the TV switches to it: passing over doesn't
  var SETTLE = 1200;   // ms after a switch before showing it: on a QN85A the first show came out black without it
  // ms between looks at the connected inputs. Not systeminfo's change listener on VIDEOSOURCE: with it, the page died
  // on a QN85A as soon as the TV window showed.
  var POLL = 3000;
  // The drawer's card row in the home screen's 1920x1080 (home.css .panel; renderPanels in home.js lays it out from
  // 80 to 1840). The live card (16:9) and Free My TV's cards, scaled by SCALE, fill it at the same height.
  var ROW = {left: 80, right: 1840, top: 708, height: 300, gap: 16};
  var SCALE = (ROW.right - ROW.left - ROW.gap) / (ROW.right - ROW.left + ROW.height * 16 / 9);   // about 0.76
  var CARD = {height: Math.round(ROW.height * SCALE), width: Math.round(ROW.height * SCALE * 16 / 9)};
  CARD.top = ROW.top + Math.round((ROW.height - CARD.height) / 2);
  var TEXT = {
    en: ['Live preview', 'Rest the focus on an input', 'Nothing is on at this input'],
    pt: ['Prévia ao vivo', 'Pare o foco numa entrada', 'Nenhum aparelho ligado nesta entrada']
  };

  var html = document.documentElement;
  var inputs = [];     // TV.inputs(), in the drawer's order (its first keys)
  var wanted = null;   // id of the input under the focus
  var shown = null;    // id of the input on screen
  var timer = null;
  var sources = null;  // the connected sources ("HDMI1 TV1"), as the drawer's keys last showed them

  function noop() {}

  function loadInputs() {
    TV.inputs(function (list) { inputs = list || []; });
  }

  function isOff(key) { return (' ' + key.className + ' ').indexOf(' off ') >= 0; }

  /** The drawer's key under the focus, if it's an input's. */
  function inputKey() {
    var st = app.state;
    if (st.zone !== 'drawer' || st.drawer >= inputs.length) return null;
    return document.querySelectorAll('#drawer .key')[st.drawer] || null;
  }

  /** The input under the focus in the open drawer, if it's one with a device on. */
  function focusedInput() {
    var key = inputKey();
    return key && !isOff(key) ? inputs[app.state.drawer] : null;
  }

  function text() { return TEXT[(html.lang || 'en').slice(0, 2)] || TEXT.en; }

  /** The live card's line: what to do, or that the input under the focus has nothing on. */
  function hint(off) {
    var e = document.querySelector('#sr-live-card .hint');
    if (e) e.textContent = text()[off ? 2 : 1];
  }

  function setLive(on) {
    var c = html.className.replace(/(^| )sr-live( |$)/g, ' ').replace(/^ +| +$/g, '');
    html.className = on ? (c ? c + ' ' : '') + 'sr-live' : c;
  }

  function div(cls, parent, text) {
    var e = document.createElement('div');
    e.className = cls;
    if (text) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  /** The live card: "Live preview" while no input shows, the picture's frame while one does. */
  function makeCard() {
    var card = div('glass');
    card.id = 'sr-live-card';
    card.style.left = ROW.left + 'px';
    card.style.top = CARD.top + 'px';
    card.style.width = CARD.width + 'px';
    card.style.height = CARD.height + 'px';
    var icon = div('sym', card);
    icon.style.webkitMaskImage = icon.style.maskImage = 'url(symbols/live_tv.png)';
    div('title', card, text()[0]);
    div('hint', card, text()[1]);
    return card;
  }

  /**
   * After each renderDrawer and renderPanels (they empty the drawer, or make its cards again): the live card on the
   * left, and Free My TV's cards moved right and scaled from where it put them.
   */
  function layout() {
    var drawer = document.getElementById('drawer');
    if (!drawer) return;
    if (!document.getElementById('sr-live-card')) drawer.appendChild(makeCard());
    var panels = drawer.querySelectorAll('.panel');
    for (var i = 0; i < panels.length; i++) {
      var p = panels[i];
      if (p.getAttribute('data-sr')) continue;
      p.setAttribute('data-sr', '1');
      var left = parseFloat(p.style.left) || ROW.left;
      p.style.left = Math.round(ROW.left + CARD.width + ROW.gap + (left - ROW.left) * SCALE) + 'px';
      p.style.top = CARD.top + 'px';
      p.style.webkitTransformOrigin = p.style.transformOrigin = '0 0';
      p.style.webkitTransform = p.style.transform = 'scale(' + SCALE.toFixed(4) + ')';
    }
  }

  /**
   * The sky without the live card: the polygon goes round the screen, up into the middle of the card's bottom edge,
   * round the card and back out. Square corners, as the TV window under it: rounded ones let the window's corners show
   * through the sky's edge.
   */
  function hole() {
    var x = ROW.left, y = CARD.top, x2 = x + CARD.width, y2 = y + CARD.height, m = x + Math.round(CARD.width / 2);
    var pts = [[0, 0], [0, 1080], [m, 1080], [m, y2], [x, y2], [x, y], [x2, y], [x2, y2], [m, y2], [m, 1080],
      [1920, 1080], [1920, 0]];
    for (var i = 0; i < pts.length; i++) pts[i] = pts[i][0] + 'px ' + pts[i][1] + 'px';
    return 'polygon(' + pts.join(', ') + ')';
  }

  /** Cuts the live card's hole in the sky; the window's rectangle on screen. */
  function place() {
    var x = ROW.left, y = CARD.top;
    var sky = document.getElementById('sky');
    if (sky) sky.style.webkitClipPath = sky.style.clipPath = hole();
    // On screen, through the stage's scale (fit() in home.js). From the stage, not the card: the drawer may still be
    // sliding in.
    var s = document.getElementById('stage').getBoundingClientRect(), k = s.width / 1920;
    return [Math.round(s.left + x * k) + 'px', Math.round(s.top + y * k) + 'px',
      Math.round(CARD.width * k) + 'px', Math.round(CARD.height * k) + 'px'];
  }

  function unplace() {
    var sky = document.getElementById('sky');
    if (sky) sky.style.webkitClipPath = sky.style.clipPath = '';
  }

  function hideLive() {
    clearTimeout(timer);
    if (!shown) return;
    shown = null;
    setLive(false);
    unplace();
    try { tizen.tvwindow.hide(noop, noop, 'MAIN'); } catch (e) {}
  }

  /** The TV's source object for an input id ("source:HDMI:4"), from VIDEOSOURCE; done(null) if it's not there. */
  function sourceFor(id, done) {
    var parts = id.split(':');
    try {
      tizen.systeminfo.getPropertyValue('VIDEOSOURCE', function (v) {
        var list = (v && v.connected) || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i].type === parts[1] && list[i].number === +parts[2]) { done(list[i]); return; }
        }
        done(null);
      }, function () { done(null); });
    } catch (e) {
      done(null);
    }
  }

  function showLive(input) {
    if (!tizen || !tizen.tvwindow) return;
    sourceFor(input.id, function (source) {
      if (!source || wanted !== input.id) return;   // gone, or the focus moved on meanwhile
      var current = null;
      try { current = tizen.tvwindow.getSource('MAIN'); } catch (e) {}
      var same = current && current.type === source.type && current.number === source.number;
      function reveal() {
        if (wanted !== input.id) return;
        var rect = place();
        try {
          tizen.tvwindow.show(function () {
            if (wanted !== input.id) { unplace(); try { tizen.tvwindow.hide(noop, noop, 'MAIN'); } catch (e) {} return; }
            shown = input.id;
            setLive(true);
          }, unplace, rect, 'MAIN');
        } catch (e) {
          unplace();
        }
      }
      if (same) { reveal(); return; }
      try {
        tizen.tvwindow.setSource(source, function () { timer = setTimeout(reveal, SETTLE); }, noop, 'MAIN');
      } catch (e) {}
    });
  }

  /** After each key: follows the focus in and out of the inputs. */
  function check() {
    var key = inputKey(), input = focusedInput(), id = input ? input.id : null;
    hint(key && isOff(key));
    if (id === wanted) return;
    wanted = id;
    hideLive();
    if (input) timer = setTimeout(function () { showLive(input); }, REST);
  }

  /**
   * A device on an input turned on or off. Free My TV reads the inputs again only when it comes back to the front, so
   * the same event makes it do so now: its drawer's keys light up or go off, and check() follows once it's redrawn.
   */
  function refreshInputs() {
    TV.inputs(function (list) {
      inputs = list || [];
      var e = document.createEvent('Event');
      e.initEvent('visibilitychange', false, false);
      document.dispatchEvent(e);
    });
  }

  /** Looks at the connected sources, and refreshes the inputs when they changed since the last look. */
  function watchSources() {
    if (document.hidden) return;
    try {
      tizen.systeminfo.getPropertyValue('VIDEOSOURCE', function (v) {
        var list = (v && v.connected) || [], now = [];
        for (var i = 0; i < list.length; i++) now.push(list[i].type + list[i].number);
        now = now.sort().join(' ');
        if (sources !== null && now !== sources) refreshInputs();
        sources = now;
      }, noop);
    } catch (e) {}
  }

  /** Moves the drawer's focus to key i, one step at a time, as the arrows do. */
  function focusKey(i) {
    var st = app.state;
    for (var guard = 0; st.drawer !== i && guard < 20; guard++) app.move(st.drawer < i ? 1 : -1, 0);
  }

  function connectedFrom(start) {
    for (var k = 0; k < inputs.length; k++) {
      var i = (start + k) % inputs.length;
      if (inputs[i].connected) return i;
    }
    return -1;
  }

  /** Where Source lands first: the input on screen, else the first HDMI with a device on, else the first input. */
  function firstInput() {
    var current = null;
    try { current = tizen.tvwindow.getSource('MAIN'); } catch (e) {}
    for (var i = 0; i < inputs.length; i++) {
      if (current && inputs[i].connected && inputs[i].id === 'source:' + current.type + ':' + current.number) return i;
    }
    for (var j = 0; j < inputs.length; j++) if (inputs[j].connected && inputs[j].id.indexOf('source:HDMI') === 0) return j;
    return connectedFrom(0);
  }

  function sourceKey() {
    var st = app.state;
    if (!inputs.length) return;
    if (st.zone === 'drawer') {
      if (st.drawer < inputs.length) {
        var next = connectedFrom(st.drawer + 1);
        if (next >= 0) focusKey(next);
      } else {
        focusKey(Math.max(0, firstInput()));
      }
      return;
    }
    // A sheet, the top row or the cards: back to the shelf first, as Back would (never Back on the shelf itself:
    // there it leaves the app).
    for (var guard = 0; st.zone !== 'shelf' && guard < 4; guard++) app.back();
    if (st.zone !== 'shelf') return;
    app.move(0, 1);   // ↓ on the shelf opens the drawer
    if (st.zone === 'drawer') focusKey(Math.max(0, firstInput()));
  }

  document.addEventListener('keydown', function (e) {
    if (e.keyCode === SOURCE_KEY) {
      e.preventDefault();
      sourceKey();
    }
    setTimeout(check, 0);   // after Free My TV's own handler has moved the focus
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { wanted = null; hideLive(); return; }
    loadInputs();
  });

  // renderDrawer and renderPanels add and remove the drawer's children: lay the row out again after each, and follow
  // the focus on the keys made again (one may have lit up or gone off).
  var drawer = document.getElementById('drawer');
  if (drawer && window.MutationObserver) {
    new MutationObserver(function () { layout(); setTimeout(check, 0); }).observe(drawer, {childList: true});
  }
  layout();

  try { tizen.tvinputdevice.registerKey('Source'); } catch (e) {}
  loadInputs();
  watchSources();
  setInterval(watchSources, POLL);

  window.ScreenRevo = {version: '0.1.5', check: check, sourceKey: sourceKey, layout: layout, place: place,
    unplace: unplace, refresh: refreshInputs,
    state: function () { return {inputs: inputs, wanted: wanted, shown: shown, sources: sources}; }};
})();
