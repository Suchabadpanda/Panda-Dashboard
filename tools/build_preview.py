#!/usr/bin/env python3
"""Bundle the dashboard into one self-contained HTML file running the demo snapshot.

    python3 tools/build_preview.py            # → dist/preview.html

Handy for sharing a look at the dashboard without connecting to Home Assistant.
"""
import pathlib
import re

repo = pathlib.Path(__file__).resolve().parent.parent
root = repo / "panda_dashboard" / "www"
html = (root / "index.html").read_text()

css = (root / "css/app.css").read_text()
html = html.replace('<link rel="stylesheet" href="css/app.css">', f"<style>\n{css}\n</style>")

def inline(m):
    src = (root / m.group(1)).read_text()
    return f"<script>\n/* {m.group(1)} */\n{src}\n</script>"

html = html.replace('<script src="js/config.js"></script>', '<script>window.HD_FORCE_DEMO = true;</script>\n  <script src="js/config.js"></script>')
html = re.sub(r"<script>document\.write\(.*?data/config\.js.*?</script>\n?", "", html)
# demo.js is loaded on demand by the app; the preview always needs it
html = html.replace('<script src="js/app.js"></script>', '<script src="js/demo.js"></script>\n  <script src="js/app.js"></script>')
# The People page's map library is loaded on demand from vendor/; the preview carries it inline
lf_css = (root / "vendor/leaflet.css").read_text()
html = html.replace('<script src="js/views/map.js"></script>', f'<style>\n{lf_css}\n</style>\n  <script src="vendor/leaflet.js"></script>\n  <script src="js/views/map.js"></script>')
html = re.sub(r'<script src="((?:js|vendor)/[^"]+)"></script>', inline, html)
out = repo / "dist/preview.html"
out.parent.mkdir(exist_ok=True)
out.write_text(html)
print(f"Wrote {out} ({out.stat().st_size // 1024} KB)")
