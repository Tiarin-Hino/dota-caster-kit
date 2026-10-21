#!/bin/sh
cd "$(dirname "$0")"
(sleep 1; open http://127.0.0.1:58900/ 2>/dev/null || xdg-open http://127.0.0.1:58900/ 2>/dev/null) &
node app/server.js
