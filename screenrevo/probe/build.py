#!/usr/bin/env python3
"""Builds the ScreenRevo probe for Samsung TVs (Tizen): out/screenrevo-probe.wgt.

    python3 screenrevo/probe/build.py --tv 192.168.1.50                  # results go to this computer (collect.py)
    python3 screenrevo/probe/build.py --tv 192.168.1.50 --sign PROFILE   # signed, so install.py can install it
    python3 screenrevo/probe/build.py --preview                          # also out/screenrevo-probe/ for a browser

--collector URL sets where the probe sends its results (default: this computer on the TV's network, port 8765).
--no-video leaves out the test clip, which ffmpeg makes (without ffmpeg the video test is skipped).
Signing goes through Free My TV's tizen/build.py: Samsung's `tizen package` with a certificate profile.
"""
import datetime
import json
import os
import shutil
import socket
import subprocess
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import tizen_tools  # noqa: E402

ROOT = tizen_tools.ROOT
OUT = os.path.join(ROOT, 'out')
WGT = os.path.join(OUT, 'screenrevo-probe.wgt')
PREVIEW = os.path.join(OUT, 'screenrevo-probe')
CLIP = os.path.join(OUT, 'screenrevo-probe-cache', 'sample.mp4')
PORT = 8765
FILES = ('config.xml', 'index.html', 'probe.css', 'probe.js')


def this_computer(tv=None):
    """This computer's address on the TV's network (connecting a UDP socket sends nothing)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect((tv, 26101) if tv else ('8.8.8.8', 53))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


def clip():
    """A 6-second 1080p test pattern without DRM, so the video test can read its frames."""
    if os.path.exists(CLIP):
        return CLIP
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        print('No ffmpeg: built without the test clip (the video test only checks WebGL).')
        return None
    os.makedirs(os.path.dirname(CLIP), exist_ok=True)
    run = subprocess.run([ffmpeg, '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30',
                          '-t', '6', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-profile:v', 'high',
                          '-level', '4.1', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', CLIP],
                         capture_output=True, text=True)
    if run.returncode != 0:
        print('ffmpeg didn\'t make the test clip: ' + run.stderr.strip())
        return None
    return CLIP


def main():
    args = sys.argv[1:]

    def value(flag):
        i = args.index(flag) + 1 if flag in args else 0
        return args[i] if 0 < i < len(args) else None

    preview, tv, profile = '--preview' in args, value('--tv'), value('--sign')
    collector = value('--collector')
    if collector is None:
        host = 'localhost' if preview and not tv else this_computer(tv)
        collector = 'http://%s:%d' % (host, PORT) if host else ''
    video = None if '--no-video' in args else clip()

    app = {}
    for name in FILES:
        with open(os.path.join(HERE, name), 'rb') as f:
            app[name] = f.read()
    with open(os.path.join(ROOT, 'tizen', 'icon.png'), 'rb') as f:
        app['icon.png'] = f.read()
    if video:
        with open(video, 'rb') as f:
            app['sample.mp4'] = f.read()
    config = {'collector': collector.rstrip('/'), 'video': 'sample.mp4' if video else '',
              'built': datetime.datetime.now().strftime('%Y-%m-%d %H:%M')}
    app['config.js'] = ('window.PROBE_CONFIG = %s;\n' % json.dumps(config)).encode('utf-8')

    os.makedirs(OUT, exist_ok=True)
    with zipfile.ZipFile(WGT, 'w', zipfile.ZIP_DEFLATED) as z:
        for path in sorted(app):
            z.writestr(path, app[path], compress_type=zipfile.ZIP_STORED if path.endswith('.mp4') else None)
    if profile:
        tizen_tools.sign(WGT, profile)

    if preview:
        shutil.rmtree(PREVIEW, ignore_errors=True)
        os.makedirs(PREVIEW)
        for path, data in app.items():
            with open(os.path.join(PREVIEW, path), 'wb') as f:
                f.write(data)
        print('Preview: serve out/screenrevo-probe (python -m http.server) and open it in a browser.')

    app_id, _, version = tizen_tools.manifest_ids(app['config.xml'].decode('utf-8'))
    print('Built out/%s (%s %s, %d KB, %s)' % (os.path.basename(WGT), app_id, version, os.path.getsize(WGT) // 1024,
                                              'signed with "%s"' % profile if profile else 'not signed'))
    print('Results go to ' + config['collector'] if config['collector'] else 'No collector: results only on screen.')


if __name__ == '__main__':
    main()
