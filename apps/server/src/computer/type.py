"""Native X11 typing; stdin stays open as a cancellation/liveness channel."""
import ctypes
import atexit
import json
import os
import select
import subprocess
import sys
import time


def retain_unicode_mappings(text):
    """Keep spare Unicode keycodes mapped until clients consumed the whole text.

    xdotool's temporary per-character mappings can be restored before a busy
    XTerm processes their KeyPress events. Give a batch stable mappings instead.
    Leave the existing keyboard layout untouched; restore only our empty slots.
    """
    x11 = ctypes.CDLL('libX11.so.6')
    display_type = ctypes.c_void_p
    x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
    x11.XOpenDisplay.restype = display_type
    x11.XCloseDisplay.argtypes = [display_type]
    x11.XDisplayKeycodes.argtypes = [display_type, ctypes.c_void_p, ctypes.c_void_p]
    x11.XGetKeyboardMapping.argtypes = [display_type, ctypes.c_ubyte, ctypes.c_int, ctypes.c_void_p]
    x11.XGetKeyboardMapping.restype = ctypes.POINTER(ctypes.c_ulong)
    x11.XChangeKeyboardMapping.argtypes = [display_type, ctypes.c_int, ctypes.c_int, ctypes.c_void_p, ctypes.c_int]
    x11.XKeysymToKeycode.argtypes = [display_type, ctypes.c_ulong]
    x11.XKeysymToKeycode.restype = ctypes.c_ubyte
    x11.XSync.argtypes = [display_type, ctypes.c_int]
    x11.XFree.argtypes = [ctypes.c_void_p]
    display = x11.XOpenDisplay(os.environ['DISPLAY'].encode())
    if not display:
        raise RuntimeError('Display unavailable')
    low, high, width = ctypes.c_int(), ctypes.c_int(), ctypes.c_int()
    x11.XDisplayKeycodes(display, ctypes.byref(low), ctypes.byref(high))
    mapping = x11.XGetKeyboardMapping(display, low.value, high.value-low.value+1, ctypes.byref(width))
    try:
        free = [code for code in range(low.value, high.value+1) if all(mapping[(code-low.value)*width.value+i] == 0 for i in range(width.value))]
    finally:
        x11.XFree(mapping)
    symbols = list(dict.fromkeys(ord(c) if ord(c) < 256 else 0x01000000 | ord(c) for c in text if ord(c) >= 128))
    missing = [symbol for symbol in symbols if not x11.XKeysymToKeycode(display, symbol)]
    installed = []
    if len(missing) <= len(free):
        for code, symbol in zip(free, missing):
            row = (ctypes.c_ulong * width.value)(symbol)
            x11.XChangeKeyboardMapping(display, code, width.value, row, 1)
            installed.append(code)
        x11.XSync(display, False)

    def restore():
        if installed:
            time.sleep(.1)
            empty = (ctypes.c_ulong * width.value)()
            for code in installed:
                x11.XChangeKeyboardMapping(display, code, width.value, empty, 1)
            x11.XSync(display, False)
        x11.XCloseDisplay(display)
    atexit.register(restore)

text = json.loads(sys.stdin.readline())["text"]
retain_unicode_mappings(text)
process = subprocess.Popen(["xdotool", "type", "--clearmodifiers", "--delay", "12", "--file", "-"], stdin=subprocess.PIPE)
process.stdin.write(text.encode("utf-8"))
process.stdin.close()
cancelled = False
try:
    while process.poll() is None:
        ready, _, _ = select.select([sys.stdin], [], [], 0.02)
        if ready and sys.stdin.read(1) == "":
            cancelled = True
            process.terminate()
            try:
                process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            break
finally:
    if cancelled:
        # An interrupted keystroke must not leave a key/modifier held down.
        try:
            x11, xtst = ctypes.CDLL("libX11.so.6"), ctypes.CDLL("libXtst.so.6")
            x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
            x11.XOpenDisplay.restype = ctypes.c_void_p
            x11.XQueryKeymap.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
            x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
            xtst.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
            display = x11.XOpenDisplay(os.environ["DISPLAY"].encode())
            if display:
                keys = (ctypes.c_ubyte * 32)()
                x11.XQueryKeymap(display, keys)
                for code in range(8, 256):
                    if keys[code // 8] & (1 << (code % 8)):
                        xtst.XTestFakeKeyEvent(display, code, False, 0)
                x11.XCloseDisplay(display)
        except OSError:
            pass
sys.exit(130 if cancelled else process.returncode)
