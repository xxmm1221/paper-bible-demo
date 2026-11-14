#!/usr/bin/env python3
"""Fetch the missing Noto Serif SC glyph subset for local rules.html only.

Uses the same free Google Fonts text= subset endpoint as the existing demo.
The response's real font signature determines its extension. No package install,
paid model, source-text upload, or changes to the public fonts.css are involved;
only a deduplicated set of missing individual glyphs is sent to Google Fonts.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import re
import runpy
import urllib.parse
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
read_sfnt_cmap = runpy.run_path(str(ROOT / "tools" / "export-rule-source.py"))["read_sfnt_cmap"]


def cmap_for_bytes(data, filename):
    if data[:4] in (b"\x00\x01\x00\x00", b"OTTO", b"true"):
        return read_sfnt_cmap(data)
    if not importlib.util.find_spec("fontTools"):
        raise RuntimeError("Compressed font returned but fontTools unavailable; cmap coverage not verified")
    from fontTools.ttLib import TTFont
    from io import BytesIO
    with TTFont(BytesIO(data)) as font:
        return set(font.getBestCmap())


def main():
    output = ROOT / "local-data"
    report = json.loads((output / "source-validation.json").read_text(encoding="utf-8"))
    coverage = report["fontCoverage"]
    codes = {int(item["codepoint"][2:], 16) for item in coverage["css_declared_missing"]}
    if coverage["actual_cmap_checked"]:
        codes.update(int(item["codepoint"][2:], 16) for item in coverage["actual_cmap_missing"])
    codes = {code for code in codes if code >= 32}
    if not codes:
        raise RuntimeError("No missing glyphs; no extra font requested")
    text = "".join(chr(code) for code in sorted(codes))
    css_url = "https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400&text=" + urllib.parse.quote(text, safe="")
    # Same user agent as the original build: Google returns a readily auditable
    # uncompressed sfnt font rather than requiring a local WOFF2 decoder.
    request = urllib.request.Request(css_url, headers={"User-Agent": "Mozilla/5.0"})
    css = urllib.request.urlopen(request, timeout=60).read().decode("utf-8")
    match = re.search(r"url\(([^)]+)\)", css)
    if not match:
        raise RuntimeError("Font response contains no download URL")
    font_url = match[1].strip("\"'")
    if urllib.parse.urlparse(font_url).hostname != "fonts.gstatic.com":
        raise RuntimeError("Unexpected font asset host")
    data = urllib.request.urlopen(font_url, timeout=60).read()
    signature = data[:4]
    extension, format_name = {
        b"\x00\x01\x00\x00": ("ttf", "truetype"),
        b"OTTO": ("otf", "opentype"),
        b"wOF2": ("woff2", "woff2"),
        b"wOFF": ("woff", "woff"),
    }.get(signature, (None, None))
    if extension is None:
        raise RuntimeError("Unexpected font data signature")
    digest = hashlib.sha256(data).hexdigest()
    filename = f"serif-rules-extra-{digest[:12]}.{extension}"
    actual = cmap_for_bytes(data, filename)
    missing = codes - actual
    if missing:
        raise RuntimeError("Downloaded font lacks requested glyphs: " + ",".join(f"U+{code:04X}" for code in sorted(missing)))
    ranges = ",".join(f"U+{code:X}" for code in sorted(codes))
    extra_css = (
        "/* Local rules-only Noto Serif SC subset; SIL OFL 1.1, ../fonts/LICENSE.txt. */\n"
        f'@font-face{{font-family:PaperSerif;src:url("{filename}") format("{format_name}");'
        f"font-style:normal;font-weight:400;font-display:swap;unicode-range:{ranges};}}\n"
    )
    (output / filename).write_bytes(data)
    (output / "fonts-extra.css").write_text(extra_css, encoding="utf-8")
    manifest = {
        "family": "Noto Serif SC",
        "cssFamily": "PaperSerif",
        "weight": 400,
        "requestedGlyphCount": len(codes),
        "requestedCharacters": text,
        "requestedCodepoints": [f"U+{code:04X}" for code in sorted(codes)],
        "googleCssUrl": css_url,
        "googleFontUrl": font_url,
        "downloadedFile": filename,
        "format": format_name,
        "bytes": len(data),
        "sha256": digest,
        "actualCmapVerified": True,
        "missingRequestedGlyphs": [],
        "originalFontsActuallyVerified": coverage["actual_cmap_checked"],
        "allSourcePrintingCharactersCovered": coverage["actual_cmap_checked"] and not ({int(item["codepoint"][2:], 16) for item in coverage["actual_cmap_missing"]} - actual),
        "license": {"name": "SIL Open Font License 1.1", "local": "../fonts/LICENSE.txt", "url": "https://openfontlicense.org/open-font-license-official-text/"},
        "scope": "Only local rules.html loads this asset; original fonts.css is unchanged.",
    }
    (output / "fonts-extra-validation.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: manifest[k] for k in ("downloadedFile", "bytes", "requestedGlyphCount", "actualCmapVerified", "allSourcePrintingCharactersCovered")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
