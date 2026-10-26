/**
 * ScreenRevo on top of Free My TV's home screen (web/), without changing it:
 *  - Live inputs: in the drawer, an input that keeps the focus for a moment fills the screen with its live picture,
 *    behind the home screen (Samsung's TV window lies under the page, so the page's backgrounds step aside). OK opens
 *    it as before, already on that source.
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

  function hideLive() {
    clearTimeout(timer);
    if (!shown) return;
    shown = null;
    setLive(false);
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
        try {
          tizen.tvwindow.show(function () {
            if (wanted !== input.id) { try { tizen.tvwindow.hide(noop, noop, 'MAIN'); } catch (e) {} return; }
            shown = input.id;
            setLive(true);
          }, noop, ['0px', '0px', '1920px', '1080px'], 'MAIN');
        } catch (e) {}
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

  var shade = document.createElement('div');
  shade.id = 'sr-shade';
  shade.className = 'layer';
  var sky = document.getElementById('sky');
  if (sky && sky.parentNode) sky.parentNode.insertBefore(shade, sky.nextSibling);

  try { tizen.tvinputdevice.registerKey('Source'); } catch (e) {}
  loadInputs();

  window.ScreenRevo = {version: '0.1.0', check: check, sourceKey: sourceKey, state: function () {
    return {inputs: inputs, wanted: wanted, shown: shown};
  }};
})();
