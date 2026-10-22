"""Capture native screen pixels with the real X11 cursor and its hotspot."""
import ctypes
import hashlib
import json
import os
import subprocess
import sys
from PIL import Image, ImageGrab


class XFixesCursorImage(ctypes.Structure):
    _fields_ = [("x", ctypes.c_short), ("y", ctypes.c_short),
                ("width", ctypes.c_ushort), ("height", ctypes.c_ushort),
                ("xhot", ctypes.c_ushort), ("yhot", ctypes.c_ushort),
                ("cursor_serial", ctypes.c_ulong),
                ("pixels", ctypes.POINTER(ctypes.c_ulong)),
                ("atom", ctypes.c_ulong), ("name", ctypes.c_char_p)]


image = ImageGrab.grab(xdisplay=os.environ["DISPLAY"]).convert("RGBA")
# Compare the desktop before compositing: pointer movement isn't UI progress.
frame_hash = hashlib.sha256(image.tobytes()).hexdigest()
cursor = None
display = None
native = None
try:
    x11 = ctypes.CDLL("libX11.so.6")
    fixes = ctypes.CDLL("libXfixes.so.3")
    x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
    x11.XOpenDisplay.restype = ctypes.c_void_p
    x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
    x11.XFree.argtypes = [ctypes.c_void_p]
    fixes.XFixesGetCursorImage.argtypes = [ctypes.c_void_p]
    fixes.XFixesGetCursorImage.restype = ctypes.POINTER(XFixesCursorImage)
    display = x11.XOpenDisplay(os.environ["DISPLAY"].encode())
    if display:
        native = fixes.XFixesGetCursorImage(display)
        if native:
            value = native.contents
            if 0 < value.width <= 1024 and 0 < value.height <= 1024:
                # XFixes supplies actual ARGB pixels, screen position and hotspot.
                rgba = bytes(channel for i in range(value.width * value.height)
                             for channel in ((value.pixels[i] >> 16) & 255,
                                             (value.pixels[i] >> 8) & 255,
                                             value.pixels[i] & 255,
                                             (value.pixels[i] >> 24) & 255))
                sprite = Image.frombytes("RGBA", (value.width, value.height), rgba)
                left, top = value.x-value.xhot, value.y-value.yhot
                # Explicitly clip sprites crossing any edge of the screen.
                crop = (max(0, -left), max(0, -top),
                        min(value.width, image.width-left), min(value.height, image.height-top))
                if crop[2] > crop[0] and crop[3] > crop[1]:
                    image.alpha_composite(sprite.crop(crop), (max(0, left), max(0, top)))
                    cursor = {"x": value.x, "y": value.y, "hotspotX": value.xhot,
                              "hotspotY": value.yhot, "width": value.width,
                              "height": value.height, "source": "xfixes"}
except (OSError, ValueError):
    pass  # Never invent a pointer when the actual native cursor is unavailable.
finally:
    if native:
        x11.XFree(native)
    if display:
        x11.XCloseDisplay(display)

# Focus is queried from this bot's own DISPLAY/XAUTHORITY, never guessed from pixels.
focused_window = None
try:
    def query(*args):
        return subprocess.check_output(args, timeout=1, stderr=subprocess.DEVNULL).decode("utf-8", "replace").strip()
    window_id = query("xdotool", "getwindowfocus")
    if window_id.isdigit():
        geometry = dict(line.split("=", 1) for line in query("xdotool", "getwindowgeometry", "--shell", window_id).splitlines() if "=" in line)
        title = " ".join(query("xdotool", "getwindowname", window_id).split())[:240]
        wm_class = query("xprop", "-id", window_id, "WM_CLASS")
        wm_class = " ".join(wm_class.split("=", 1)[1].split())[:200] if "=" in wm_class else None
        focused_window = {"id": window_id, "title": title, "wmClass": wm_class,
                          "geometry": {"x": int(geometry["X"]), "y": int(geometry["Y"]),
                                       "width": int(geometry["WIDTH"]), "height": int(geometry["HEIGHT"])}}
except (OSError, ValueError, KeyError, subprocess.SubprocessError):
    pass  # No focused/accessible window is a valid desktop state.

sys.stdout.buffer.write((json.dumps({"cursor": cursor, "frameHash": frame_hash, "focusedWindow": focused_window})+"\n").encode())
image.convert("RGB").save(sys.stdout.buffer, "PNG")
