#!/usr/bin/env bash
# Makes sure the reader service is running (systemd restarts it if it stops), then opens
# the library in its own window.
URL=http://mdview.localhost:8765/
if ! curl -s -o /dev/null --max-time 3 http://127.0.0.1:8765/healthz; then
  systemctl --user start mdview-reader.service
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    curl -s -o /dev/null --max-time 1 http://127.0.0.1:8765/healthz && break
    sleep 0.5
  done
fi
exec microsoft-edge --app="$URL" >/dev/null 2>&1
