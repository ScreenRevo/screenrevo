#!/usr/bin/env python3
"""Installs the ScreenRevo probe on a Samsung TV in Developer Mode, over Wi-Fi, with Free My TV's SDB client.

    python3 screenrevo/probe/install.py 192.168.1.50              # install or update, then open it
    python3 screenrevo/probe/install.py 192.168.1.50 --uninstall  # remove it

Build and sign it first: python3 screenrevo/probe/build.py --tv 192.168.1.50 --sign <profile>. Once, on the TV:
open Apps, type 1 2 3 4 5 on the remote, turn Developer mode on with this computer's IP as Host PC IP, and restart
the TV. Uses tizen/install.py's SDB client as it is (port 26101), so nothing from Samsung is needed to install.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import tizen_tools  # noqa: E402

WGT = os.path.join(tizen_tools.ROOT, 'out', 'screenrevo-probe.wgt')
ON_TV = 'Apps, Settings, ScreenRevo Probe, Delete'


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) != 1:
        sys.exit(__doc__)
    if '--uninstall' in sys.argv:
        with open(os.path.join(HERE, 'config.xml'), encoding='utf-8') as f:
            tizen_tools.uninstall(args[0], f.read(), ON_TV)
    else:
        # What the TV's sdbd says it allows is worth keeping with the probe's results.
        tizen_tools.install(args[0], WGT, ON_TV, show_caps=True)


if __name__ == '__main__':
    main()
