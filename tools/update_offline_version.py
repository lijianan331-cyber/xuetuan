"""Bump the atomic offline release after changing any cached app file."""
from pathlib import Path
import hashlib
import re

ROOT = Path(__file__).resolve().parents[1]

def expected_version():
    sw = (ROOT / 'sw.js').read_text(encoding='utf8')
    normalized = re.sub(r"const VERSION = 'xuetuan-shell-[^']+';", "const VERSION = 'xuetuan-shell-@BUILD@';", sw)
    paths = re.findall(r"'([^']+)'", sw.split('const SHELL = [', 1)[1].split('].map', 1)[0])
    h = hashlib.sha256(normalized.encode())
    for name in sorted(set(p for p in paths if p != './' and not p.startswith('https://'))):
        p = ROOT / name
        data = p.read_bytes()
        if p.suffix in ('.html', '.js', '.css', '.webmanifest'):
            data = data.replace(b'\r\n', b'\n')
        h.update(name.encode() + b'\0' + data)
    return 'xuetuan-shell-' + h.hexdigest()[:16]

if __name__ == '__main__':
    path = ROOT / 'sw.js'
    path.write_text(re.sub(r"const VERSION = 'xuetuan-shell-[^']+';", "const VERSION = '" + expected_version() + "';", path.read_text(encoding='utf8')), encoding='utf8')
    print(expected_version())
