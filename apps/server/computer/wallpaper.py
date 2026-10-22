#!/usr/bin/python3
"""Local clock-driven wallpaper. Assets stay unchanged; only two cached PNGs exist."""
import argparse
from datetime import datetime
import os
from pathlib import Path
import subprocess
import time
from PIL import Image, ImageOps

ASSETS = Path('/usr/local/share/opendots/wallpapers')
# Five supplied photographs; the endpoints match for a continuous midnight wrap.
KEYFRAMES = [(0, 'night.jpg'), (6, 'dawn.jpg'), (9, 'morning.jpg'),
             (13, 'day.jpg'), (18, 'dusk.jpg'), (22, 'night.jpg'), (24, 'night.jpg')]


def frame_at(hour):
    hour %= 24
    for (start, first), (end, second) in zip(KEYFRAMES, KEYFRAMES[1:]):
        if start <= hour < end:
            progress = (hour - start) / (end - start)
            return first, second, progress * progress * (3 - 2 * progress)
    raise ValueError('Invalid clock')


def render(hour, destination):
    first, second, weight = frame_at(hour)
    with Image.open(ASSETS / first) as source:
        left = ImageOps.fit(source.convert('RGB'), (1280, 800), method=Image.Resampling.LANCZOS)
    with Image.open(ASSETS / second) as source:
        right = ImageOps.fit(source.convert('RGB'), (1280, 800), method=Image.Resampling.LANCZOS)
    temporary = destination.with_suffix('.tmp')
    Image.blend(left, right, weight).save(temporary, format='PNG')
    os.replace(temporary, destination)


def query(*args):
    return subprocess.run(['xfconf-query', '-c', 'xfce4-desktop', *args],
                          check=True, capture_output=True, text=True, timeout=10).stdout


def apply(image):
    properties = query('-l').splitlines()
    targets = [p for p in properties if p.endswith('/last-image')]
    if not targets:
        return False  # xfdesktop has not yet discovered the display.
    query('-p', '/backdrop/single-workspace-mode', '-n', '-t', 'bool', '-s', 'true')
    for target in targets:
        query('-p', target, '-s', str(image))
        query('-p', target.rsplit('/', 1)[0] + '/image-style', '-n', '-t', 'int', '-s', '5')
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--at', help='Render a deterministic local time, e.g. 13:00')
    parser.add_argument('--once', action='store_true')
    options = parser.parse_args()
    cache = Path.home() / '.cache/opendots-wallpaper'
    cache.mkdir(parents=True, exist_ok=True, mode=0o700)
    index = 0
    while True:
        now = datetime.now()  # TZ is supplied from the account timezone.
        hour = now.hour + now.minute / 60 + now.second / 3600
        if options.at:
            hours, minutes = map(int, options.at.split(':'))
            if not 0 <= hours <= 23 or not 0 <= minutes <= 59:
                parser.error('--at requires HH:MM within 00:00..23:59')
            hour = hours + minutes / 60
        image = cache / f'wallpaper-{index % 2}.png'
        try:
            render(hour, image)
            if apply(image):
                print(f'Wallpaper ready: {image.name}', flush=True)
                if options.once:
                    return
                index += 1
                time.sleep(60)
            else:
                time.sleep(1)
        except (subprocess.SubprocessError, OSError) as error:
            print(f'Wallpaper retry: {error}', flush=True)
            time.sleep(5)


if __name__ == '__main__':
    main()
