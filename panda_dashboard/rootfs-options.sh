#!/bin/sh
# The Supervisor writes /data/options.json readable by root only; let nginx serve it.
[ -f /data/options.json ] && chmod 644 /data/options.json
exit 0
