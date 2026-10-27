/**
 * ScreenRevo on top of Free My TV's home screen (web/), without changing it:
 *  - Live inputs: the drawer's card row gets a card of its own on the left, and the weather and prices cards move to
 *    its right, scaled down together to share the row. An input that keeps the focus for a moment shows its live
 *    picture in that card. Samsung's TV window lies under the page, so the page's background gets a hole there. OK
 *    opens the input as before, already on that source.
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
  // The drawer's card row in the home screen's 1920x1080 (home.css .panel; renderPanels in home.js lays it out from
  // 80 to 1840). The live card (16:9) and Free My TV's cards, scaled by SCALE, fill it at the same height.
  var ROW = {left: 80, right: 1840, top: 708, height: 300, gap: 16};
  var SCALE = (ROW.right - ROW.left - ROW.gap) / (ROW.right - ROW.left + ROW.height * 16 / 9);   // about 0.76
  var CARD = {height: Math.round(ROW.height * SCALE), width: Math.round(ROW.height * SCALE * 16 / 9),
    radius: Math.round(30 * SCALE)};   // the scaled cards' corners (home.css .panel: 30px)
  CARD.top = ROW.top + Math.round((ROW.height - CARD.height) / 2);
  var ARC = 6;         // segments in each rounded corner of the sky's hole
  var TEXT = {
    en: ['Live preview', 'Rest the focus on an input'],
    pt: ['Prévia ao vivo', 'Pare o foco numa entrada']
  };

  var html = document.documentElement;
  var inputs = [];     // TV.inputs(), in the drawer's order (its first keys)
  var wanted = null;   // id of the input under the focus
  var shown = null;    // id of the input on screen
  var timer = null;

  function noop() {}

  function loadInputs() {
    TV.inputs(function (list) { inputs = list || []; });
  }

  function isOff(key) { return (' ' + key.className + ' ').indexOf(' off ') >= 0; }

  /** The input under the focus in the open drawer, if it's one with a device on. */
  function focusedInput() {
    var st = app.state;
    if (st.zone !== 'drawer' || st.drawer >= inputs.length) return null;
    var key = document.querySelectorAll('#drawer .key')[st.drawer];
    return key && !isOff(key) ? inputs[st.drawer] : null;
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
    card.style.borderRadius = CARD.radius + 'px';
    var text = TEXT[(html.lang || 'en').slice(0, 2)] || TEXT.en;
    var icon = div('sym', card);
    icon.style.webkitMaskImage = icon.style.maskImage = 'url(symbols/live_tv.png)';
    div('title', card, text[0]);
    div('hint', card, text[1]);
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

  function px(n) { return Math.round(n * 10) / 10 + 'px'; }

  /**
   * The sky without the live card: the polygon goes round the screen, up into the card and round it clockwise, its
   * corners rounded as the card's (Chromium 76 has no clip-path: path()), and back out. The TV window under it is a
   * rectangle: the sky hides its corners.
   */
  function hole() {
    var x = ROW.left, y = CARD.top, x2 = x + CARD.width, y2 = y + CARD.height, r = CARD.radius;
    var centers = [[x + r, y2 - r], [x + r, y + r], [x2 - r, y + r], [x2 - r, y2 - r]];   // from the bottom left
    var pts = ['0 0', '0 1080px', px(x + r) + ' 1080px'];
    for (var c = 0; c < 4; c++) {
      for (var s = 0; s <= ARC; s++) {
        var a = Math.PI / 2 * (c + 1 + s / ARC);
        pts.push(px(centers[c][0] + r * Math.cos(a)) + ' ' + px(centers[c][1] + r * Math.sin(a)));
      }
    }
    pts.push(px(x + r) + ' ' + px(y2), px(x + r) + ' 1080px', '1920px 1080px', '1920px 0');
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
    var input = focusedInput(), id = input ? input.id : null;
    if (id === wanted) return;
    wanted = id;
    hideLive();
    if (input) timer = setTimeout(function () { showLive(input); }, REST);
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

  // renderDrawer and renderPanels add and remove the drawer's children: lay the row out again after each.
  var drawer = document.getElementById('drawer');
  if (drawer && window.MutationObserver) new MutationObserver(layout).observe(drawer, {childList: true});
  layout();

  try { tizen.tvinputdevice.registerKey('Source'); } catch (e) {}
  loadInputs();

  window.ScreenRevo = {version: '0.1.3', check: check, sourceKey: sourceKey, layout: layout, place: place,
    unplace: unplace, state: function () { return {inputs: inputs, wanted: wanted, shown: shown}; }};
})();
