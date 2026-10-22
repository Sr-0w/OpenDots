"""Independent X11 fixture: a solid 9x9 magenta cursor, hotspot (4,6)."""
import ctypes as c
import json
import os
import subprocess
import sys

class Color(c.Structure):
    _fields_ = [("pixel", c.c_ulong), ("red", c.c_ushort), ("green", c.c_ushort),
                ("blue", c.c_ushort), ("flags", c.c_char), ("pad", c.c_char)]

x = c.CDLL("libX11.so.6")
x.XOpenDisplay.argtypes = [c.c_char_p]
x.XOpenDisplay.restype = c.c_void_p
x.XCloseDisplay.argtypes = [c.c_void_p]
x.XDefaultRootWindow.argtypes = [c.c_void_p]
x.XDefaultRootWindow.restype = c.c_ulong
x.XCreateBitmapFromData.argtypes = [c.c_void_p, c.c_ulong, c.c_char_p, c.c_uint, c.c_uint]
x.XCreateBitmapFromData.restype = c.c_ulong
x.XCreatePixmapCursor.argtypes = [c.c_void_p, c.c_ulong, c.c_ulong, c.POINTER(Color), c.POINTER(Color), c.c_uint, c.c_uint]
x.XCreatePixmapCursor.restype = c.c_ulong
x.XDefineCursor.argtypes = [c.c_void_p, c.c_ulong, c.c_ulong]
x.XUndefineCursor.argtypes = [c.c_void_p, c.c_ulong]
x.XSync.argtypes = [c.c_void_p, c.c_int]
display = x.XOpenDisplay(os.environ["DISPLAY"].encode())
assert display
try:
    if sys.argv[1] == "restore":
        x.XUndefineCursor(display, int(sys.argv[2]))
    else:
        values = dict(line.split("=", 1) for line in subprocess.check_output(["xdotool", "getmouselocation", "--shell"]).decode().splitlines())
        window = int(values["WINDOW"]) or x.XDefaultRootWindow(display)
        bitmap = x.XCreateBitmapFromData(display, window, bytes([255, 1])*9, 9, 9)
        foreground = Color(0, 65535, 0, 65535, b"\x07", b"\x00")
        background = Color(0, 0, 0, 0, b"\x07", b"\x00")
        cursor = x.XCreatePixmapCursor(display, bitmap, bitmap, c.byref(foreground), c.byref(background), 4, 6)
        x.XDefineCursor(display, window, cursor)
        print(json.dumps({"window": window}))
    x.XSync(display, False)
finally:
    x.XCloseDisplay(display)
