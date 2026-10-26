#!/usr/bin/env python3
"""Installs the ScreenRevo probe on a Samsung TV in Developer Mode, over Wi-Fi, with Free My TV's SDB client.

    python3 screenrevo/probe/install.py 192.168.1.50              # install or update, then open it
    python3 screenrevo/probe/install.py 192.168.1.50 --uninstall  # remove it

Build and sign it first: python3 screenrevo/probe/build.py --tv 192.168.1.50 --sign <profile>. Once, on the TV:
open Apps, type 1 2 3 4 5 on the remote, turn Developer mode on with this computer's IP as Host PC IP, and restart
the TV. Uses tizen/install.py's SDB client as it is (port 26101), so nothing from Samsung is needed to install.
"""
import importlib.util
import os
import re
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
WGT = os.path.join(ROOT, 'out', 'screenrevo-probe.wgt')
ON_TV = 'Apps, Settings, ScreenRevo Probe, Delete'


def upstream():
    """Free My TV's tizen/install.py, loaded by path: this file has the same name."""
    spec = importlib.util.spec_from_file_location('fmtv_tizen_install', os.path.join(ROOT, 'tizen', 'install.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) != 1:
        sys.exit(__doc__)
    ip = args[0]
    uninstall = '--uninstall' in sys.argv
    fmtv = upstream()
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(errors='replace')   # the TV's answers carry bytes a Windows console can't print

    if uninstall:
        with open(os.path.join(HERE, 'config.xml'), encoding='utf-8') as f:
            manifest = f.read()
    else:
        if not os.path.exists(WGT):
            sys.exit('Build and sign it first: python3 screenrevo/probe/build.py --tv %s --sign <profile>' % ip)
        with zipfile.ZipFile(WGT) as z:
            if 'author-signature.xml' not in z.namelist():
                sys.exit('out/screenrevo-probe.wgt isn\'t signed, and the TV only installs signed apps: '
                         'python3 screenrevo/probe/build.py --tv %s --sign <profile>' % ip)
            manifest = z.read('config.xml').decode('utf-8')
    tag = re.search(r'<tizen:application[^>]*>', manifest).group(0)
    app_id = re.search(r'\bid="([^"]+)"', tag).group(1)
    package = re.search(r'\bpackage="([^"]+)"', tag).group(1)

    try:
        sdb = fmtv.Sdb(ip)
    except (OSError, ConnectionError) as e:
        sys.exit('Couldn\'t reach the TV on port %d (%s). On the TV: Apps, 1 2 3 4 5, Developer mode on with Host PC '
                 'IP %s, then restart the TV.' % (fmtv.PORT, e, fmtv.this_computer(ip)))
    caps = sdb.capabilities()
    print('Connected: %s, Tizen %s.' % (sdb.banner.split(':')[2] if sdb.banner.count(':') >= 2 else sdb.banner,
                                         caps.get('platform_version', '?')))
    # What the TV's sdbd says it allows: worth keeping with the probe's results.
    print('SDB capabilities: ' + ', '.join('%s=%s' % (k, re.sub(r'[^ -~]', '', v)) for k, v in sorted(caps.items())))

    if uninstall:
        out = sdb.shell('0 vd_appuninstall ' + package, r'spend time', 120).strip()
        if not re.search(r'uninstall completed', out):
            sys.exit(('The TV said:\n' + out if out else 'The TV didn\'t answer.') + '\nRemove it on the TV instead: ' + ON_TV + '.')
        print('Removed.')
        return

    remote = caps.get('sdk_toolpath', '/home/owner/share/tmp/sdk_tools').rstrip('/') + '/screenrevo-probe.wgt'
    with open(WGT, 'rb') as f:
        data = f.read()
    print('Copying the probe to the TV (%d KB) ...' % (len(data) // 1024))
    sdb.push(remote, data)
    print('Installing ...')
    out = sdb.shell('0 vd_appinstall %s %s' % (package, remote), r'spend time', 120)
    if not re.search(r'install completed', out):
        hint = ''
        if 'different certificate' in out:
            hint = ('\nThe probe on the TV was signed with another certificate. Remove it on the TV (' + ON_TV +
                    '), then run this again.')
        sys.exit('The TV didn\'t finish installing. It said:\n' + out.strip() + hint)
    sdb.shell('0 was_execute ' + app_id, r'launched|spend time', 20)
    print('Installed and open on the TV.')


if __name__ == '__main__':
    main()
