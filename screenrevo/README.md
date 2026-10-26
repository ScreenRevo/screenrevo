# ScreenRevo

This fork keeps [Free My TV](https://github.com/simbasjungles/free-my-tv) as it is and puts ScreenRevo's own code in
this folder, so updates from upstream merge without conflicts. ScreenRevo is an all-in-one home screen for Samsung TVs
(Tizen) that keeps what the TV already does well: SmartThings, Alexa and the remote's microphone.

## `home/`: the home screen

Free My TV's web home screen (`web/`, as it is) packed as its own Samsung app, `ScreenRevo.Home`, with
`screenrevo.js` and `screenrevo.css` on top. `build.py` writes them into `index.html` after `home.js` and
`home.css`, so nothing in `web/` changes. What they add:

- **Live inputs:** in the drawer, an input that keeps the focus for a moment fills the screen with its live picture
  behind the home screen (Samsung's TV window, `tizen.tvwindow`). OK opens it as before, already on that source.
- **The Source key** opens the drawer on the input on screen, and each press goes to the next connected one.
- It registers only that key: never the volume, which stops working while an app holds it.

```bash
python3 screenrevo/home/build.py --sign <profile>   # out/screenrevo.wgt; --preview for a browser
python3 screenrevo/home/install.py <TV IP>
```

On the TV, *Autorun Last App* (Settings, General, Smart Features on 2021 sets) makes it turn on into ScreenRevo,
and moving ScreenRevo to the first place in Smart Hub's bar makes it Home, then OK: Home itself stays Samsung's.

## `dns/`: what the TV looks up, and what to block

`dnslog.py` is a small DNS server for the computer: point the TV's DNS at it for a test, and every lookup the TV
makes prints and goes to `logs/dns-<date>.jsonl`. With `--log-only` it only watches; without, it answers 0.0.0.0
for `samsung-blocklist.txt` (ads, viewing-data ACR, crash dumps, promos) and never blocks `never-block.txt`
(updates, the Samsung account, the clock, TV Plus, mirroring). Once a list proves itself on the TV, it belongs on the
router or a DNS service (Pi-hole, AdGuard Home, NextDNS), where it works with the computer off.

```bash
python3 screenrevo/dns/dnslog.py --log-only --upstream <router IP>
```

## `probe/`: what this TV lets an app do

A small Tizen web app, installed through Developer Mode, that checks on the real TV what ScreenRevo can build on:
the system and model, which remote keys an app can capture (and whether Home is one of them), the installed apps,
the HDMI inputs and a preview of one inside the app, voice commands inside the app (Samsung's VoiceInteraction API,
Tizen 6.0+), how smooth the page runs, and whether a filter can run on video without DRM (a test clip uploaded to
WebGL and sharpened). Results show on the TV and go to the computer.

```bash
python3 screenrevo/probe/collect.py --out logs                    # 1. receive the results (leave it running)
python3 screenrevo/probe/build.py --tv <TV IP> --sign <profile>   # 2. build and sign (Samsung's Tizen CLI)
python3 screenrevo/probe/install.py <TV IP>                       # 3. install and open it on the TV
```

On Windows, `python` instead of `python3`. Signing needs Samsung's `tizen` command and a certificate profile, made
once as in Free My TV's CLAUDE.md (2016–2022 TVs take a Tizen certificate; 2023 and newer need a Samsung one).
`build.py --preview` leaves the files in `out/screenrevo-probe/` to try it in a desktop browser, where the TV's tests
are skipped. The report leaves out the TV's DUID, MAC and IP.
