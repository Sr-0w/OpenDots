#!/usr/bin/python3
"""MIT: Linux adaptation of iFurySt CursorMotionPath and progress animator.

Uses the real X11 pointer, not a screenshot overlay. Upstream provenance/license
and the reference Swift source are in vendor/open-computer-use. The macOS glyph
renderer/pose dynamics are deliberately not part of this Linux port.
"""
import ctypes
import math
import os
import select
import sys
import time


def path_point(start, end, progress):
    dx, dy = end[0] - start[0], end[1] - start[1]
    distance = max(math.hypot(dx, dy), 1)
    direction = 1 if dx >= 0 else -1
    curve = min(max(distance * .22, 28), 110) * direction
    ox, oy = -dy / distance * curve, dx / distance * curve
    a = (start[0] + dx * .18 + ox, start[1] + dy * .10 + oy)
    b = (start[0] + dx * .80 + ox * .48, start[1] + dy * .96 + oy * .48)
    t = min(max(progress, 0), 1)
    return tuple(round((1-t)**3 * start[i] + 3*(1-t)**2*t*a[i] + 3*(1-t)*t*t*b[i] + t**3*end[i]) for i in range(2))


def move(x, y):
    x11, xtst = ctypes.CDLL('libX11.so.6'), ctypes.CDLL('libXtst.so.6')
    x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
    x11.XOpenDisplay.restype = ctypes.c_void_p
    x11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
    x11.XDefaultRootWindow.restype = ctypes.c_ulong
    x11.XQueryPointer.argtypes = [ctypes.c_void_p, ctypes.c_ulong] + [ctypes.c_void_p]*7
    x11.XFlush.argtypes = [ctypes.c_void_p]
    x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
    xtst.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
    display = x11.XOpenDisplay(os.environ['DISPLAY'].encode())
    if not display:
        raise RuntimeError('Display unavailable')
    try:
        root, child = ctypes.c_ulong(), ctypes.c_ulong()
        rx, ry, wx, wy, mask = (ctypes.c_int() for _ in range(5))
        if not x11.XQueryPointer(display, x11.XDefaultRootWindow(display), ctypes.byref(root), ctypes.byref(child), ctypes.byref(rx), ctypes.byref(ry), ctypes.byref(wx), ctypes.byref(wy), ctypes.byref(mask)):
            raise RuntimeError('Pointer unavailable')
        start, end = (rx.value, ry.value), (x, y)
        if start == end:
            return
        # Same Verlet spring as upstream (response 1.4, damping .9, dt 1/240).
        # Compress its 343/240 timeline to .35 s for interactive desktop use.
        stiffness, dt = (2*math.pi/1.4)**2, 1/240
        drag = 2*.9*math.sqrt(stiffness)
        progress = velocity = force = 0
        began = time.monotonic()
        for step in range(344):
            # stdin EOF cancels motion before the eventual click.
            if select.select([sys.stdin], [], [], 0)[0] and sys.stdin.read(1) == '':
                raise RuntimeError('Motion cancelled')
            half_velocity = velocity + force * dt / 2
            progress += half_velocity * dt
            force = stiffness * (1-progress) - drag * half_velocity
            velocity = half_velocity + force * dt / 2
            if step % 6 == 0:
                px, py = path_point(start, end, progress)
                xtst.XTestFakeMotionEvent(display, -1, max(0, min(1279, px)), max(0, min(799, py)), 0)
                x11.XFlush(display)
                time.sleep(max(0, began + .35 * step/343 - time.monotonic()))
        xtst.XTestFakeMotionEvent(display, -1, x, y, 0)
        x11.XFlush(display)
    finally:
        x11.XCloseDisplay(display)


if __name__ == '__main__':
    x, y = map(int, sys.argv[1:])
    if not (0 <= x < 1280 and 0 <= y < 800):
        raise SystemExit('Point outside desktop')
    move(x, y)
