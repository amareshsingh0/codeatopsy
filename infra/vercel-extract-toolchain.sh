#!/bin/sh
# Build sandbox only: Docker exports a toolchain filesystem, never runs user code.
set -eu
apt-get install -y --no-install-recommends bubblewrap util-linux
mkdir -p /opt/codeautopsy/rootfs
container=$(docker create codeautopsy-sandbox:local)
trap 'docker rm "$container" >/dev/null 2>&1 || true' EXIT
docker export "$container" > /tmp/codeautopsy-toolchain.tar
tar -xf /tmp/codeautopsy-toolchain.tar -C /opt/codeautopsy/rootfs
rm /tmp/codeautopsy-toolchain.tar
mkdir -p /opt/codeautopsy/rootfs/trace /opt/codeautopsy/rootfs/proc /opt/codeautopsy/rootfs/dev
bwrap --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent --new-session \
  --cap-drop ALL --cap-add CAP_SETUID --cap-add CAP_SETGID --cap-add CAP_SETPCAP \
  --ro-bind /opt/codeautopsy/rootfs / --proc /proc --dev /dev --tmpfs /tmp \
  --chdir /work -- setpriv --bounding-set=-all --reuid=1000 --regid=1000 --clear-groups --no-new-privs \
  sh -c 'node --version; python3 --version; gcc --version | head -n 1; java -version; test ! -e /opt/codeautopsy'
