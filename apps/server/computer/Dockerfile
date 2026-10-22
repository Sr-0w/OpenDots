# syntax=docker/dockerfile:1
FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 DISPLAY=:99 HOME=/home/opendots
RUN --mount=type=secret,id=opendots_ca,target=/run/opendots-ca.pem \
    apt-get -o Acquire::https::CaInfo=/run/opendots-ca.pem update \
 && apt-get -o Acquire::https::CaInfo=/run/opendots-ca.pem install -y --no-install-recommends \
    ca-certificates chromium xvfb x11vnc xdotool xclip python3 python3-pil \
    xfce4-session xfwm4 xfdesktop4 xfce4-panel thunar dbus-x11 xterm \
    fonts-dejavu fonts-liberation libnss3-tools curl procps util-linux tzdata \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --uid 1000 --create-home --shell /bin/bash opendots
COPY start-desktop.sh /usr/local/bin/opendots-desktop
COPY desktop-session.sh /usr/local/bin/opendots-session
COPY wallpaper.py /usr/local/bin/opendots-wallpaper
COPY wallpapers/ /usr/local/share/opendots/wallpapers/
RUN chmod 755 /usr/local/bin/opendots-desktop /usr/local/bin/opendots-session /usr/local/bin/opendots-wallpaper \
 && chmod -R a+rX /usr/local/share/opendots/wallpapers
EXPOSE 5900
ENTRYPOINT ["/usr/local/bin/opendots-desktop"]
