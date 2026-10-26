# ScreenRevo

This fork keeps [Free My TV](https://github.com/simbasjungles/free-my-tv) as it is and puts ScreenRevo's own code in
this folder, so updates from upstream merge without conflicts. ScreenRevo is an all-in-one home screen for Samsung TVs
(Tizen) that keeps what the TV already does well: SmartThings, Alexa and the remote's microphone.

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
