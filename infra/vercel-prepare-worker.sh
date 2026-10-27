#!/bin/sh
# Run once in a disposable build sandbox, before any application credentials exist.
set -eu
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends docker.io ca-certificates bubblewrap util-linux
mkdir -p /opt/codeautopsy /tmp/codeautopsy-work
if ! docker info >/dev/null 2>&1; then
    rm -f /var/run/docker.pid
    dockerd --host=unix:///var/run/docker.sock --bridge=none --iptables=false --ip-forward=false --ip-masq=false >/tmp/codeautopsy-docker.log 2>&1 &
    count=0
    until docker info >/dev/null 2>&1; do
        count=$((count + 1))
        if [ "$count" -gt 20 ]; then
            echo "Docker daemon could not start" >&2
            exit 1
        fi
        sleep 1
    done
fi
docker build --network=host -f /opt/codeautopsy/sandbox.Dockerfile -t codeautopsy-sandbox:local /opt/codeautopsy
# Docker is a build-time exporter only. Production jobs use isolated VM/process
# boundaries and do not need a Docker daemon or cgroup-root modifications.
sh /opt/codeautopsy/extract.sh
