#!/usr/bin/env python3
"""Installs ScreenRevo on a Samsung TV in Developer Mode, over Wi-Fi, with Free My TV's SDB client.

    python3 screenrevo/home/install.py 192.168.1.50              # install or update, then open it
    python3 screenrevo/home/install.py 192.168.1.50 --uninstall  # remove it

Build and sign it first: python3 screenrevo/home/build.py --sign <profile>. Then, on the TV, Autorun Last App
(Settings, General, Smart Features; where it is changes by year) makes the TV turn on into ScreenRevo.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import tizen_tools  # noqa: E402

WGT = os.path.join(tizen_tools.ROOT, 'out', 'screenrevo.wgt')
ON_TV = 'Apps, Settings, ScreenRevo, Delete'


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) != 1:
        sys.exit(__doc__)
    if '--uninstall' in sys.argv:
        with open(os.path.join(HERE, 'config.xml'), encoding='utf-8') as f:
            tizen_tools.uninstall(args[0], f.read(), ON_TV)
    else:
        tizen_tools.install(args[0], WGT, ON_TV)


if __name__ == '__main__':
    main()
