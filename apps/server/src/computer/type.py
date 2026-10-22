"""Native X11 typing; stdin stays open as a cancellation/liveness channel."""
import ctypes
import json
import os
import select
import subprocess
import sys

text = json.loads(sys.stdin.readline())["text"]
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
