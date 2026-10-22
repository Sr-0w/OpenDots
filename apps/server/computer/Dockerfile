# syntax=docker/dockerfile:1
FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 PIP_BREAK_SYSTEM_PACKAGES=1
RUN --mount=type=secret,id=opendots_ca,target=/run/opendots-ca.pem \
    apt-get -o Acquire::https::CaInfo=/run/opendots-ca.pem update \
 && apt-get -o Acquire::https::CaInfo=/run/opendots-ca.pem install -y --no-install-recommends \
    ca-certificates chromium xvfb x11vnc xdotool xclip python3 python3-pil \
    xfce4-session xfwm4 xfdesktop4 xfce4-panel thunar dbus-x11 xterm \
    fonts-dejavu fonts-liberation libnss3-tools curl procps util-linux tzdata xauth exo-utils xdg-utils socat python3-pycryptodome \
    python3-pip python3-venv nodejs npm git wget jq unzip zip xz-utils sqlite3 less nano file sudo locales bc \
 && rm -rf /var/lib/apt/lists/*
COPY . /usr/local/share/opendots/
RUN mkdir -p /etc/chromium.d /usr/share/xfce4/helpers \
 && ln -s /usr/local/share/opendots/chromium-flags.sh /etc/chromium.d/opendots \
 && ln -s /usr/local/share/opendots/chromium-helper.desktop /usr/share/xfce4/helpers/opendots-chromium.desktop \
 && chmod a+r /usr/local/share/opendots/chromium-helper.desktop \
 && chmod 755 /usr/local/share/opendots /usr/local/share/opendots/*.sh /usr/local/share/opendots/*.py \
 && chmod -R a+rX /usr/local/share/opendots/wallpapers \
 && ln -s /usr/local/share/opendots/account-entrypoint.sh /usr/local/bin/opendots-account \
 && ln -s /usr/local/share/opendots/bot-session.py /usr/local/bin/opendots-bot-session \
 && ln -s /usr/local/share/opendots/start-desktop.sh /usr/local/bin/opendots-desktop \
 && ln -s /usr/local/share/opendots/desktop-session.sh /usr/local/bin/opendots-session \
 && ln -s /usr/local/share/opendots/wallpaper.py /usr/local/bin/opendots-wallpaper
ENTRYPOINT ["/usr/local/bin/opendots-account"]
