#!/usr/bin/python3
"""Private per-bot semantic UI adapter for pinned MIT OCU and OBU engines.

One bounded JSON request over stdin; no network listener, arbitrary evaluation,
clipboard editing or simulated submission. Snapshot refs expire and are checked
against live element identity before use. Run only as the bot's Linux UID.
"""
import importlib.util
import json
import math
import subprocess
import os
from pathlib import Path
import secrets
import socket
import struct
import sys
import time
import threading

ROOT = Path('/usr/local/share/opendots')
RUNTIME = Path(os.environ['XDG_RUNTIME_DIR'])
STOP_REQUESTED = threading.Event()
CLICK_PAIR = threading.Lock()


def move_pointer(x, y):
    # Use the same real XTest pointer as coordinate actions/noVNC. The bridge's
    # existing stdin watcher owns cancellation; do not read stdin a second time.
    if not all(math.isfinite(v) for v in (x, y)) or not (0 <= x < 1280 and 0 <= y < 800):
        raise RuntimeError('Target outside desktop: inspect/scroll before acting')
    spec = importlib.util.spec_from_file_location('motion', ROOT / 'cursor-motion.py')
    motion = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(motion)
    px, py = min(1279, round(x)), min(799, round(y))
    motion.move(px, py, cancelled=STOP_REQUESTED)
    if STOP_REQUESTED.is_set():
        raise RuntimeError('Action cancelled')
    return {'x': px, 'y': py}


def store(kind, data):
    token = secrets.token_hex(12)
    data.update(token=token, created=time.time())
    path = RUNTIME / (kind + '-snapshot.json')
    path.write_text(json.dumps(data))
    path.chmod(0o600)
    return token


def load(kind, token):
    path = RUNTIME / (kind + '-snapshot.json')
    if not path.exists():
        raise RuntimeError('Stale snapshot: inspect again before acting')
    data = json.loads(path.read_text())
    if data['token'] != token or not 0 <= time.time() - data['created'] < 120:
        raise RuntimeError('Stale snapshot: inspect again before acting')
    return data


def native(request):
    os.environ['DBUS_SESSION_BUS_ADDRESS'] = (RUNTIME / 'session-bus').read_text()
    spec = importlib.util.spec_from_file_location('ocu', ROOT / 'vendor/open-computer-use/apps/OpenComputerUseLinux/runtime.py')
    ocu = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ocu)
    ocu.require_desktop_session()
    ocu.Atspi.init()
    action = request['action']
    if action == 'apps':
        apps = []
        for app in ocu.iter_apps():
            pid = ocu.node_pid(app)
            try:
                if pid > 0 and os.stat('/proc/' + str(pid)).st_uid == os.getuid():
                    apps.append({'name': ocu.node_name(app), 'pid': pid})
            except FileNotFoundError:
                pass  # Applications can close during an observation.
        return {'apps': apps[:80]}
    if action == 'inspect':
        app = ocu.resolve_app(request['app'])
        if os.stat('/proc/' + str(ocu.node_pid(app))).st_uid != os.getuid():
            raise RuntimeError('Application outside bot session')
        snapshot = ocu.build_snapshot(str(ocu.node_pid(app)), text_limit=160, max_tree_nodes=300, max_tree_depth=32, include_screenshot=False)
        # Never emit upstream focused/selected text or raw values (passwords).
        elements = snapshot['elements']
        for element in elements:
            element.pop('value', None)
            node = ocu.resolve_path(app, element['runtimeId'])
            element['states'] = {name: ocu.state_contains(node, state) for name, state in [('focused', ocu.Atspi.StateType.FOCUSED), ('enabled', ocu.Atspi.StateType.ENABLED), ('showing', ocu.Atspi.StateType.SHOWING)]} if node else {}
        token = store('native', {'pid': ocu.node_pid(app), 'elements': elements})
        return {'snapshot': token, 'app': snapshot['app'], 'window': snapshot['windowTitle'], 'elements': [{'ref': str(e['index']), 'role': e['controlType'], 'name': e['name'], 'actions': e['actions'], 'bounds': e['frame'], 'states': e['states']} for e in elements], 'truncated': len(elements) >= 300}
    if action not in ('click', 'focus'):
        raise RuntimeError('Unsupported native action')
    data = load('native', request['snapshot'])
    app = ocu.resolve_app(str(data['pid']))
    if os.stat('/proc/' + str(data['pid'])).st_uid != os.getuid():
        raise RuntimeError('Application outside bot session')
    record = next((e for e in data['elements'] if str(e['index']) == request['ref']), None)
    if record is None:
        raise RuntimeError('Unknown element ref')
    # Do not use upstream fuzzy fallback: a stale path must not click a neighbour.
    node = ocu.resolve_path(app, record['runtimeId'])
    if node is None or ocu.node_name(node) != record['name'] or ocu.node_role(node) != record['controlType'] or ocu.accessible_id(node) != record['automationId']:
        raise RuntimeError('Element changed: inspect again')
    # Bring the inspected native window forward before displaying its target.
    # AT-SPI actions can otherwise succeed behind another application's window.
    _, native_window = ocu.main_window(app)
    title = ocu.node_name(native_window)
    windows = subprocess.check_output(['xdotool', 'search', '--onlyvisible', '--pid', str(data['pid'])], text=True, timeout=3).splitlines()
    for window_id in windows:
        if subprocess.check_output(['xdotool', 'getwindowname', window_id], text=True, timeout=3).strip() == title:
            subprocess.run(['xdotool', 'windowactivate', '--sync', window_id], check=True, timeout=3)
            break
    else:
        raise RuntimeError('Accessible application window is not visible')
    bounds = ocu.extents(node)  # Live SCREEN extents, never snapshot-relative frames.
    if bounds is None or not ocu.state_contains(node, ocu.Atspi.StateType.SHOWING):
        raise RuntimeError('Target has no visible screen bounds: inspect again')
    pointer = move_pointer(bounds['x'] + bounds['width']/2, bounds['y'] + bounds['height']/2)
    # Hover can change a menu or replace controls. Revalidate before dispatch.
    if ocu.node_name(node) != record['name'] or ocu.node_role(node) != record['controlType'] or ocu.accessible_id(node) != record['automationId']:
        raise RuntimeError('Element changed during pointer movement: inspect again')
    if action == 'focus':
        component = node.get_component_iface()
        if component is None or not ocu.Atspi.Component.grab_focus(component):
            raise RuntimeError('Element could not acquire focus')
    elif not ocu.do_action_by_index(node, ocu.preferred_action_index(node)):
        raise RuntimeError('Element has no accessible click action; use a fresh screenshot')
    (RUNTIME / 'native-snapshot.json').unlink(missing_ok=True)
    return {'executed': True, 'target': {'role': record['controlType'], 'name': record['name']}, 'pointer': pointer, 'note': 'Real X11 pointer moved to live accessible target. Semantic action dispatched; inspect again to verify its effect.'}


def receive(sock, count):
    parts = bytearray()
    while len(parts) < count:
        part = sock.recv(count-len(parts))
        if not part:
            raise RuntimeError('Browser connection closed')
        parts.extend(part)
    return parts


def browser_rpc(method, params=None):
    record = json.loads((RUNTIME / 'obu/active.json').read_text())
    path = Path(record['socketPath'])
    if path.parent != RUNTIME / 'obu' or path.stat().st_uid != os.getuid():
        raise RuntimeError('Browser socket outside bot session')
    with socket.socket(socket.AF_UNIX) as sock:
        sock.settimeout(8)
        sock.connect(str(path))
        payload = json.dumps({'jsonrpc': '2.0', 'id': 'opendots', 'method': method, 'params': dict(params or {}, session_id='opendots', turn_id='opendots')}).encode()
        sock.sendall(struct.pack('=I', len(payload)) + payload)
        while True:
            size = struct.unpack('=I', receive(sock, 4))[0]
            if size > 4_000_000:
                raise RuntimeError('Browser response exceeds limit')
            response = json.loads(receive(sock, size))
            if response.get('id') != 'opendots':
                continue
            if 'error' in response:
                raise RuntimeError(response['error'].get('message', 'Browser error'))
            return response.get('result', {})


def cdp(tab, method, params=None):
    return browser_rpc('executeCdp', {'target': {'tabId': tab}, 'method': method, 'commandParams': params or {}})


def hit_test(tab, x, y):
    # getContentQuads/Input events use viewport CSS pixels, whereas this CDP
    # hit-test uses document CSS pixels. Scrolled pages need their page offset.
    viewport = cdp(tab, 'Page.getLayoutMetrics')['cssLayoutViewport']
    return cdp(tab, 'DOM.getNodeForLocation', {'x': round(x + viewport['pageX']), 'y': round(y + viewport['pageY'])})


def identity(node):
    return (node.get('role', {}).get('value'), node.get('name', {}).get('value'))


def browser(request):
    action = request['action']
    if action == 'tabs':
        return {'tabs': browser_rpc('getUserTabs')[:80]}
    if action == 'open':
        from urllib.parse import urlsplit
        if urlsplit(request['url']).scheme not in ('http', 'https', 'about'):
            raise RuntimeError('Only http(s) and about URLs are supported')
        # A visible Chromium window can precede extension/native-host readiness.
        deadline = time.monotonic() + 6
        while True:
            try:
                browser_rpc('getInfo')
                break
            except (FileNotFoundError, ConnectionError, TimeoutError):
                if time.monotonic() >= deadline:
                    raise RuntimeError('Browser extension is not ready; inspect the browser session log')
                time.sleep(.1)
        tab = browser_rpc('createTab')['id']
        browser_rpc('attach', {'tabId': tab})
        cdp(tab, 'Page.navigate', {'url': request['url']})
        cdp(tab, 'Page.bringToFront')
        return {'tabId': tab, 'note': 'Navigation requested; inspect after the page loads.'}
    if action == 'inspect':
        tab = request['tabId']
        browser_rpc('claimUserTab', {'tabId': tab})
        browser_rpc('attach', {'tabId': tab})
        tree = cdp(tab, 'Accessibility.getFullAXTree')['nodes']
        frame = cdp(tab, 'Page.getFrameTree')['frameTree']['frame']
        nodes = [n for n in tree if not n.get('ignored')][:400]
        # AX values are intentionally excluded, including password field values.
        token = store('browser', {'tab': tab, 'loader': frame['loaderId'], 'nodes': nodes})
        return {'snapshot': token, 'tabId': tab, 'url': frame['url'], 'elements': [{'ref': str(i), 'role': identity(n)[0], 'name': str(identity(n)[1] or '')[:300], 'properties': [p for p in n.get('properties', []) if p['name'] in ('focused', 'disabled', 'checked', 'expanded', 'required', 'readonly')]} for i, n in enumerate(nodes)], 'truncated': len(nodes) >= 400}
    if action not in ('click', 'focus'):
        raise RuntimeError('Unsupported browser action')
    data = load('browser', request['snapshot'])
    tab = data['tab']
    if cdp(tab, 'Page.getFrameTree')['frameTree']['frame']['loaderId'] != data['loader']:
        raise RuntimeError('Page navigated: inspect again')
    index = int(request['ref'])
    if not 0 <= index < len(data['nodes']):
        raise RuntimeError('Unknown element ref')
    node = data['nodes'][index]
    backend = node.get('backendDOMNodeId')
    if not backend:
        raise RuntimeError('This accessible node has no DOM target')
    live = cdp(tab, 'Accessibility.getPartialAXTree', {'backendNodeId': backend, 'fetchRelatives': False})['nodes']
    if not live or identity(live[0]) != identity(node):
        raise RuntimeError('Element changed: inspect again')
    cdp(tab, 'Page.bringToFront')
    cdp(tab, 'DOM.scrollIntoViewIfNeeded', {'backendNodeId': backend})
    quads = cdp(tab, 'DOM.getContentQuads', {'backendNodeId': backend}).get('quads', [])
    if not quads:
        raise RuntimeError('Element is not visible')
    q = quads[0]
    x, y = sum(q[::2])/4, sum(q[1::2])/4
    # Hit-test avoids clicking an overlay covering the inspected target.
    hit = hit_test(tab, x, y)
    if hit.get('backendNodeId') != backend:
        target_object = cdp(tab, 'DOM.resolveNode', {'backendNodeId': backend})['object']['objectId']
        hit_object = cdp(tab, 'DOM.resolveNode', {'backendNodeId': hit['backendNodeId']})['object']['objectId']
        try:
            contains = cdp(tab, 'Runtime.callFunctionOn', {'objectId': target_object, 'functionDeclaration': 'function(node) { return this.contains(node); }', 'arguments': [{'objectId': hit_object}], 'returnByValue': True})
            if contains.get('result', {}).get('value') is not True:
                raise RuntimeError('Target is covered; inspect again before clicking')
        finally:
            for obj in (target_object, hit_object):
                cdp(tab, 'Runtime.releaseObject', {'objectId': obj})
    # Read window metrics in an isolated world, not page-overridden globals.
    frame_id = cdp(tab, 'Page.getFrameTree')['frameTree']['frame']['id']
    world = cdp(tab, 'Page.createIsolatedWorld', {'frameId': frame_id, 'worldName': 'opendots-pointer'})['executionContextId']
    metrics = cdp(tab, 'Runtime.evaluate', {'contextId': world, 'expression': '({width:outerWidth,height:outerHeight,innerWidth:innerWidth,innerHeight:innerHeight,dpr:devicePixelRatio})', 'returnByValue': True})['result']['value']
    # X11 supplies the actual active client rectangle. No fixed toolbar height,
    # screenshot scaling or model-supplied coordinates enter this conversion.
    window = subprocess.check_output(['xdotool', 'getactivewindow'], text=True).strip()
    wm_class = subprocess.check_output(['xprop', '-id', window, 'WM_CLASS'], text=True)
    if 'chromium' not in wm_class.lower():
        raise RuntimeError('Browser did not acquire the active X11 window')
    geometry = dict(line.split('=', 1) for line in subprocess.check_output(['xdotool', 'getwindowgeometry', '--shell', window], text=True).splitlines() if '=' in line)
    scale = metrics['dpr']
    side = max(0, (int(geometry['WIDTH'])-metrics['innerWidth']*scale)/2)
    top = int(geometry['HEIGHT'])-metrics['innerHeight']*scale-side
    pointer = move_pointer(int(geometry['X']) + side+x*scale, int(geometry['Y']) + top+y*scale)
    # Hover can open overlays or navigate. Hit-test again before the action.
    if cdp(tab, 'Page.getFrameTree')['frameTree']['frame']['loaderId'] != data['loader']:
        raise RuntimeError('Page navigated during pointer movement: inspect again')
    after_hover = cdp(tab, 'Accessibility.getPartialAXTree', {'backendNodeId': backend, 'fetchRelatives': False})['nodes']
    if not after_hover or identity(after_hover[0]) != identity(node):
        raise RuntimeError('Element changed during pointer movement: inspect again')
    if hit_test(tab, x, y).get('backendNodeId') != hit.get('backendNodeId'):
        raise RuntimeError('Target changed during pointer movement: inspect again')
    if action == 'focus':
        cdp(tab, 'DOM.focus', {'backendNodeId': backend})
    else:
        # Cancellation must never leave CDP's virtual mouse button held down.
        # A press already dispatched is completed with its release before exit.
        with CLICK_PAIR:
            if STOP_REQUESTED.is_set():
                raise RuntimeError('Action cancelled')
            try:
                cdp(tab, 'Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': x, 'y': y, 'button': 'left', 'clickCount': 1})
            finally:
                cdp(tab, 'Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': x, 'y': y, 'button': 'left', 'clickCount': 1})
    (RUNTIME / 'browser-snapshot.json').unlink(missing_ok=True)
    return {'executed': True, 'target': {'role': identity(node)[0], 'name': identity(node)[1]}, 'pointer': pointer, 'note': 'Real X11 pointer moved to live DOM target. Semantic action dispatched; inspect again to verify.'}


if __name__ == '__main__':
    try:
        request = json.loads(sys.stdin.readline(32_000))
        # The host keeps stdin open as a liveness channel until completion.
        def watch_stop():
            if sys.stdin.read(1) == '':
                STOP_REQUESTED.set()
                with CLICK_PAIR:
                    os._exit(130)
        threading.Thread(target=watch_stop, daemon=True).start()
        result = native(request) if request['engine'] == 'native' else browser(request)
        print(json.dumps({'ok': True, **result}, separators=(',', ':')))
    except Exception as error:
        print(json.dumps({'ok': False, 'error': str(error)[:600]}))
