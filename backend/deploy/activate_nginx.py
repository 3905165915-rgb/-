"""Switch the user-approved domain to sdau.fun, with validation and rollback."""
from pathlib import Path
import os
import re
import shutil
import subprocess

new_site = Path('/etc/nginx/sites-available/hulaozhijiao')
enabled = Path('/etc/nginx/sites-enabled/hulaozhijiao')
configured_legacy = Path(os.getenv('LEGACY_SITE_CONFIG', '/etc/nginx/sites-available/99211314.xyz'))
legacy_candidates = [configured_legacy, Path('/etc/nginx/sites-available/99211314.xyz')]
legacy = next((path for path in legacy_candidates if path.exists() and path != new_site), None)
legacy_original = legacy.read_text() if legacy else None
legacy_backup = legacy.with_name(legacy.name + '.pre-hulaozhijiao') if legacy else None
legacy_domains = {'99211314.xyz', 'www.99211314.xyz'}
if legacy and legacy_backup and not legacy_backup.exists():
    shutil.copy2(legacy, legacy_backup)

if legacy_original is not None:
    original = legacy_original
    domains = legacy_domains

def keep_other_hosts(match):
    names = [name for name in match.group(1).split() if name not in domains]
    return 'server_name ' + ' '.join(names or ['_']) + ';'
updated = re.sub(r'server_name\s+([^;]+);', keep_other_hosts, original) if legacy_original is not None else None
previous_new = new_site.read_text() if new_site.exists() else None
was_enabled = enabled.is_symlink()
try:
    if legacy and updated is not None:
        legacy.write_text(updated)
    shutil.copyfile(Path(__file__).with_name('nginx.conf'), new_site)
    if not was_enabled:
        enabled.symlink_to(new_site)
    subprocess.run(['nginx', '-t'], check=True)
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
except Exception:
    if legacy and legacy_original is not None:
        legacy.write_text(legacy_original)
    if not was_enabled and enabled.is_symlink():
        enabled.unlink()
    if previous_new is not None:
        new_site.write_text(previous_new)
    subprocess.run(['nginx', '-t'], check=False)
    raise
print('HTTPS domain switched to sdau.fun.')
if legacy_backup:
    print('Original legacy site configuration backup:', legacy_backup)
else:
    print('No separate legacy site configuration found; existing hulaozhijiao config was replaced with rollback protection.')
