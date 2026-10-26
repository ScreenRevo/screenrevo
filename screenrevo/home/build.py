#!/usr/bin/env python3
"""Builds ScreenRevo for Samsung TVs (Tizen): out/screenrevo.wgt, Free My TV's web home screen plus ScreenRevo's part.

    python3 screenrevo/home/build.py                   # → out/screenrevo.wgt, not signed yet
    python3 screenrevo/home/build.py --sign PROFILE    # signed with a certificate profile of Samsung's Tizen tools
    python3 screenrevo/home/build.py --preview         # also leaves the files in out/screenrevo/ for a browser
    python3 screenrevo/home/build.py --config other.properties

Free My TV's files come from tools/webapp.py as they are; screenrevo.js and screenrevo.css go in after home.js and
home.css, written into index.html here, so nothing in web/ changes. Settings: config.properties when there is one
(or --config), else as Free My TV's --generic: the TV's time zone picks the city, and there's no TMDB key.
"""
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import tizen_tools  # noqa: E402

ROOT = tizen_tools.ROOT
WGT = os.path.join(ROOT, 'out', 'screenrevo.wgt')
PREVIEW = os.path.join(ROOT, 'out', 'screenrevo')
OURS = ('screenrevo.js', 'screenrevo.css')


def with_ours(index):
    """Free My TV's index.html with ScreenRevo's stylesheet after home.css and its script after home.js."""
    page = index.decode('utf-8')
    for anchor, add in (('<link rel="stylesheet" href="home.css">', '\n<link rel="stylesheet" href="screenrevo.css">'),
                        ('<script src="home.js"></script>', '\n<script src="screenrevo.js"></script>')):
        if page.count(anchor) != 1:
            sys.exit('web/index.html changed: "%s" isn\'t there once. Update screenrevo/home/build.py.' % anchor)
        page = page.replace(anchor, anchor + add)
    return page.replace('<title>Free My TV</title>', '<title>ScreenRevo</title>').encode('utf-8')


def main():
    args = sys.argv[1:]
    profile = args[args.index('--sign') + 1] if '--sign' in args and args.index('--sign') + 1 < len(args) else None
    webapp = tizen_tools.upstream('tools/webapp.py')
    if '--config' in args or os.path.exists(os.path.join(ROOT, 'config.properties')):
        config = webapp.config_from_args(args)
    else:
        config = webapp.config_from_args(['--generic'])

    app = webapp.files(config, 'screenrevo/home/build.py')
    app['index.html'] = with_ours(app['index.html'])
    for name in OURS + ('config.xml',):
        with open(os.path.join(HERE, name), 'rb') as f:
            app[name] = f.read()
    with open(os.path.join(ROOT, 'tizen', 'icon.png'), 'rb') as f:
        app['icon.png'] = f.read()

    os.makedirs(os.path.dirname(WGT), exist_ok=True)
    with zipfile.ZipFile(WGT, 'w', zipfile.ZIP_DEFLATED) as z:
        for path in sorted(app):
            z.writestr(path, app[path])
    if profile:
        tizen_tools.sign(WGT, profile)

    if '--preview' in args:
        webapp.preview(app, PREVIEW)
        print('Preview: serve out/screenrevo (python -m http.server) and open it in a browser.')
    app_id, _, version = tizen_tools.manifest_ids(app['config.xml'].decode('utf-8'))
    print('Built out/%s (%s %s, %d KB, %s)' % (os.path.basename(WGT), app_id, version, os.path.getsize(WGT) // 1024,
                                              'signed with "%s"' % profile if profile else 'not signed'))


if __name__ == '__main__':
    main()
