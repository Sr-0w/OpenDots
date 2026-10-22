#!/usr/bin/python3
"""Prepare a keyed, unpacked MIT extension without a store/account/download."""
import base64
import hashlib
import json
from pathlib import Path
import re
import shutil

root = Path('/usr/local/share/opendots')
source = root / 'vendor/open-browser-use'
key = re.search(r'const betaExtensionPublicKey = "([^"]+)"', (source / 'cmd/open-browser-use/main.go').read_text()).group(1)
extension = root / 'browser-extension'
shutil.copytree(source / 'apps/chrome-extension', extension, dirs_exist_ok=True)
manifest = json.loads((extension / 'manifest.json').read_text())
manifest['key'] = key
(extension / 'manifest.json').write_text(json.dumps(manifest))
digest = hashlib.sha256(base64.b64decode(key)).digest()[:16]
extension_id = ''.join(chr(97 + int(n, 16)) for n in digest.hex())
(root / 'browser-extension-id').write_text(extension_id)
