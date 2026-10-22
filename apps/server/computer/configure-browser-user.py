#!/usr/bin/python3
from pathlib import Path
# Stable extension identity, local native messaging and a private bot socket.
import json
native_dir = Path.home() / '.config/chromium/NativeMessagingHosts'
native_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
(native_dir / 'com.ifuryst.open_browser_use.extension.json').write_text(json.dumps({
    'name': 'com.ifuryst.open_browser_use.extension', 'description': 'OpenDots private browser',
    'path': '/usr/local/share/opendots/browser-host.sh', 'type': 'stdio',
    'allowed_origins': ['chrome-extension://' + Path('/usr/local/share/opendots/browser-extension-id').read_text().strip() + '/'],
}))
