"""What ScreenRevo's Samsung packages share: signing with Samsung's `tizen package` and installing over SDB.

Both come from Free My TV's tizen/build.py and tizen/install.py, loaded and used as they are, so a fix upstream
reaches ScreenRevo too.
"""
import importlib.util
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def upstream(path):
    """A Free My TV script, loaded by path: ScreenRevo's folders have files with the same names."""
    name = 'fmtv_' + re.sub(r'\W', '_', path[:-3])
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, path))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    sys.modules[name] = module
    return module


def manifest_ids(manifest):
    """(app id, package, version) from a config.xml's text."""
    tag = re.search(r'<tizen:application[^>]*>', manifest).group(0)
    version = re.search(r'<widget [^>]*version="([^"]+)"', manifest)
    return (re.search(r'\bid="([^"]+)"', tag).group(1), re.search(r'\bpackage="([^"]+)"', tag).group(1),
            version.group(1) if version else '')


def sign(wgt, profile):
    """Signs wgt in place with a certificate profile of Samsung's Tizen tools."""
    cli = upstream('tizen/build.py').tizen_cli()
    if not cli:
        sys.exit('Signing needs Samsung\'s Tizen tools (Tizen Studio\'s CLI). Not found: set TIZEN_STUDIO to where '
                 'they are installed.')
    out = tempfile.mkdtemp()
    try:
        run = subprocess.run([cli, 'package', '-t', 'wgt', '-s', profile, '-o', out, '--', wgt],
                             capture_output=True, text=True)
        made = [n for n in os.listdir(out) if n.endswith('.wgt')]
        if run.returncode != 0 or not made:
            sys.exit('`tizen package` didn\'t sign it:\n' + (run.stdout + run.stderr).strip())
        shutil.move(os.path.join(out, made[0]), wgt)
    finally:
        shutil.rmtree(out, ignore_errors=True)
    with zipfile.ZipFile(wgt) as z:
        names = z.namelist()
    if 'author-signature.xml' not in names or 'signature1.xml' not in names:
        sys.exit('The package came back without its signatures.')


def connect(ip, show_caps=False):
    """An SDB connection to a TV in Developer Mode, and its capabilities."""
    fmtv = upstream('tizen/install.py')
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(errors='replace')   # the TV's answers carry bytes a Windows console can't print
    try:
        sdb = fmtv.Sdb(ip)
    except (OSError, ConnectionError) as e:
        sys.exit('Couldn\'t reach the TV on port %d (%s). On the TV: Apps, 1 2 3 4 5, Developer mode on with Host PC '
                 'IP %s, then restart the TV.' % (fmtv.PORT, e, fmtv.this_computer(ip)))
    caps = sdb.capabilities()
    print('Connected: %s, Tizen %s.' % (sdb.banner.split(':')[2] if sdb.banner.count(':') >= 2 else sdb.banner,
                                         caps.get('platform_version', '?')))
    if show_caps:
        print('SDB capabilities: ' + ', '.join('%s=%s' % (k, re.sub(r'[^ -~]', '', v)) for k, v in sorted(caps.items())))
    return sdb, caps


def install(ip, wgt, on_tv, show_caps=False):
    """Pushes a signed wgt to the TV, installs it and opens it."""
    if not os.path.exists(wgt):
        sys.exit('Build and sign it first (%s is missing).' % os.path.relpath(wgt, ROOT))
    with zipfile.ZipFile(wgt) as z:
        if 'author-signature.xml' not in z.namelist():
            sys.exit('%s isn\'t signed, and the TV only installs signed apps: build it with --sign <profile>.'
                     % os.path.basename(wgt))
        app_id, package, _ = manifest_ids(z.read('config.xml').decode('utf-8'))
    sdb, caps = connect(ip, show_caps)
    remote = caps.get('sdk_toolpath', '/home/owner/share/tmp/sdk_tools').rstrip('/') + '/' + os.path.basename(wgt)
    with open(wgt, 'rb') as f:
        data = f.read()
    print('Copying %s to the TV (%d KB) ...' % (os.path.basename(wgt), len(data) // 1024))
    sdb.push(remote, data)
    print('Installing ...')
    out = sdb.shell('0 vd_appinstall %s %s' % (package, remote), r'spend time', 120)
    if not re.search(r'install completed', out):
        hint = ''
        if 'different certificate' in out:
            hint = ('\nThe app on the TV was signed with another certificate. Remove it on the TV (' + on_tv +
                    '), then run this again.')
        sys.exit('The TV didn\'t finish installing. It said:\n' + out.strip() + hint)
    sdb.shell('0 was_execute ' + app_id, r'launched|spend time', 20)
    print('Installed and open on the TV.')


def uninstall(ip, manifest, on_tv):
    """Removes the app named in a config.xml's text from the TV."""
    _, package, _ = manifest_ids(manifest)
    sdb, _ = connect(ip)
    out = sdb.shell('0 vd_appuninstall ' + package, r'spend time', 120).strip()
    if not re.search(r'uninstall completed', out):
        # Some TVs' sdbd refuses this command and answers nothing.
        sys.exit(('The TV said:\n' + out if out else 'The TV didn\'t answer.') + '\nRemove it on the TV instead: ' + on_tv + '.')
    print('Removed.')
