"""Switch the user-approved domain from the old site, with validation and rollback."""
from pathlib import Path
import re
import shutil
import subprocess

old = Path('/etc/nginx/sites-available/99211314.xyz')
backup = old.with_name(old.name + '.pre-hulaozhijiao')
if not backup.exists():
    shutil.copy2(old, backup)
original = old.read_text()
domains = {'99211314.xyz', 'www.99211314.xyz'}
def keep_other_hosts(match):
    names = [name for name in match.group(1).split() if name not in domains]
    return 'server_name ' + ' '.join(names or ['_']) + ';'
updated = re.sub(r'server_name\s+([^;]+);', keep_other_hosts, original)
new_site = Path('/etc/nginx/sites-available/hulaozhijiao')
enabled = Path('/etc/nginx/sites-enabled/hulaozhijiao')
previous_new = new_site.read_text() if new_site.exists() else None
was_enabled = enabled.is_symlink()
try:
    old.write_text(updated)
    shutil.copyfile(Path(__file__).with_name('nginx.conf'), new_site)
    if not was_enabled:
        enabled.symlink_to(new_site)
    subprocess.run(['nginx', '-t'], check=True)
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
except Exception:
    old.write_text(original)
    if not was_enabled and enabled.is_symlink():
        enabled.unlink()
    if previous_new is not None:
        new_site.write_text(previous_new)
    subprocess.run(['nginx', '-t'], check=False)
    raise
print('HTTPS domain switched. Original site configuration backup:', backup)
