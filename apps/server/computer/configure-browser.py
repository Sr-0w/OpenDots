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
# A persistent Chromium profile caches extension service-worker scripts. Give
# each bundled implementation a deterministic version so image upgrades reload
# the worker while preserving the public key/extension ID and private profile.
code_hash = hashlib.sha256((extension / 'background.js').read_bytes()).hexdigest()
manifest['version'] = f'1.1.{int(code_hash[:4], 16)}.{int(code_hash[4:8], 16)}'
worker = f'background-{code_hash[:16]}.js'
shutil.copy2(extension / 'background.js', extension / worker)
manifest['background']['service_worker'] = worker
(extension / 'manifest.json').write_text(json.dumps(manifest))
digest = hashlib.sha256(base64.b64decode(key)).digest()[:16]
extension_id = ''.join(chr(97 + int(n, 16)) for n in digest.hex())
(root / 'browser-extension-id').write_text(extension_id)
