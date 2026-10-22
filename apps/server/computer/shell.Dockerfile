# syntax=docker/dockerfile:1
FROM debian:stable-slim
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 PIP_BREAK_SYSTEM_PACKAGES=1
RUN --mount=type=secret,id=opendots_ca,target=/run/opendots-ca.pem \
    apt-get -o Acquire::https::CaInfo=/run/opendots-ca.pem update \
 && apt-get -o Acquire::https::CaInfo=/run/opendots-ca.pem install -y --no-install-recommends \
    python3 python3-pip python3-venv nodejs npm git curl wget jq ca-certificates \
    unzip zip xz-utils sqlite3 less nano file procps sudo tzdata locales bc \
 && rm -rf /var/lib/apt/lists/*
