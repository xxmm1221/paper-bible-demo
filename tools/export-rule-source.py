#!/usr/bin/env python3
"""Export existing scripture semantics without page, line, or glyph coordinates.

The input is a read-only local SQLite database. App-derived source permissions
have not been established; generated local-data is deliberately Git-ignored.
Paragraph ranges are retained ONLY as referenceSegments, not typesetting input:
the source's app segmentation has not been verified against the printed edition.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sqlite3
import struct


ROOT = Path(__file__).resolve().parents[1]
EXPECTED = {"books": 66, "chapters": 1189, "verses": 31102, "titles": 2652}


def canonical_hash(value):
    payload = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def scripture_rows(source):
    return [
        [bi, chapter["chapter"], verse, text]
        for bi, book in enumerate(source["books"], 1)
        for chapter in book["chapters"]
        for verse, text in chapter["verses"]
    ]


def title_rows(source):
    return [
        [bi, chapter["chapter"], verse, text]
        for bi, book in enumerate(source["books"], 1)
        for chapter in book["chapters"]
        for verse, text in chapter["titles"]
    ]


def read_sfnt_cmap(data):
    """Read Unicode sfnt cmap with stdlib, without converting or changing a font.

    The existing .woff2-named assets contain sfnt bytes. Detect the signature,
    never assume the filename represents the encoding. Compressed WOFF/WOFF2
    intentionally needs fontTools rather than an unverified custom decoder.
    """
    if data[:4] not in (b"\x00\x01\x00\x00", b"OTTO", b"true"):
        raise ValueError("Not an uncompressed sfnt font")
    u16 = lambda offset: struct.unpack_from(">H", data, offset)[0]
    u32 = lambda offset: struct.unpack_from(">I", data, offset)[0]
    cmap = None
    for i in range(u16(4)):
        record = 12 + 16 * i
        if data[record:record + 4] == b"cmap":
            cmap = u32(record + 8)
            break
    if cmap is None:
        raise ValueError("No cmap table")
    mapped = set()
    supported = 0
    for i in range(u16(cmap + 2)):
        record = cmap + 4 + i * 8
        platform, encoding = u16(record), u16(record + 2)
        if platform != 0 and not (platform == 3 and encoding in (1, 10)):
            continue
        table = cmap + u32(record + 4)
        fmt = u16(table)
        if fmt == 4:
            supported += 1
            count = u16(table + 6) // 2
            ends = table + 14
            starts = ends + 2 * count + 2
            deltas = starts + 2 * count
            offsets = deltas + 2 * count
            for segment in range(count):
                lo, hi = u16(starts + 2 * segment), u16(ends + 2 * segment)
                delta = u16(deltas + 2 * segment)
                offset_address = offsets + 2 * segment
                offset = u16(offset_address)
                for code in range(lo, min(hi, 65534) + 1):
                    if offset:
                        glyph = u16(offset_address + offset + 2 * (code - lo))
                        if glyph:
                            glyph = (glyph + delta) & 65535
                    else:
                        glyph = (code + delta) & 65535
                    if glyph:
                        mapped.add(code)
        elif fmt in (12, 13):
            supported += 1
            for group in range(u32(table + 12)):
                start = table + 16 + group * 12
                lo, hi, glyph = u32(start), u32(start + 4), u32(start + 8)
                if fmt == 12:
                    mapped.update(range(lo + (glyph == 0), hi + 1))
                elif glyph:
                    mapped.update(range(lo, hi + 1))
    if not supported:
        raise ValueError("No supported Unicode cmap (format 4, 12, or 13)")
    return mapped


def font_coverage(characters):
    """Report CSS coverage separately from optional actual font cmap coverage."""
    css = (ROOT / "fonts.css").read_text(encoding="utf-8")
    declared = set()
    for start, end in re.findall(r"U\+([0-9A-Fa-f]+)(?:-([0-9A-Fa-f]+))?", css):
        lo = int(start, 16)
        declared.update(range(lo, int(end, 16) + 1 if end else lo + 1))

    def describe(codes):
        return [{"character": chr(n), "codepoint": f"U+{n:04X}"} for n in sorted(codes)]

    source_codes = {ord(ch) for ch in characters}
    controls = {n for n in source_codes if n < 32}
    wanted = source_codes - controls
    report = {
        "unique_source_characters": len(source_codes),
        "unique_printing_characters": len(wanted),
        "nonprinting_characters_not_glyphs": describe(controls),
        "css_declared_missing": describe(wanted - declared),
        "actual_cmap_checked": False,
        "actual_cmap_missing": None,
    }
    cmap = set()
    errors = []
    has_fonttools = bool(importlib.util.find_spec("fontTools"))
    if has_fonttools:
        from fontTools.ttLib import TTFont
    for path in sorted((ROOT / "fonts").glob("*.woff2")):
        try:
            if has_fonttools:
                with TTFont(path) as font:
                    cmap.update(font.getBestCmap())
            else:
                cmap.update(read_sfnt_cmap(path.read_bytes()))
        except Exception as exc:
            errors.append({"font": path.name, "error": type(exc).__name__ + ": " + str(exc)})
    if errors:
        report["font_errors"] = errors
    else:
        report["actual_cmap_checked"] = True
        report["actual_cmap_missing"] = describe(wanted - cmap)
        report["actual_cmap_method"] = "fontTools" if has_fonttools else "stdlib sfnt Unicode cmap format 4/12/13"
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="Local SQLite database, opened mode=ro")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "local-data")
    args = parser.parse_args()
    path = args.source.resolve(strict=True)
    before_hash = hashlib.sha256(path.read_bytes()).hexdigest()
    legacy = (ROOT / "bible-data.js").read_text(encoding="utf-8-sig")
    if not legacy.startswith("window.BIBLE_DATA="):
        raise ValueError("Unexpected legacy metadata wrapper")
    metadata = json.loads(legacy.split("=", 1)[1].strip().removesuffix(";"))["books"]

    with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True) as connection:
        connection.execute("PRAGMA query_only=ON")
        bodies = [list(row) for row in connection.execute(
            "SELECT Book,Chapter,Verse,Scripture FROM Bible ORDER BY Book,Chapter,Verse,id")]
        titles = [list(row) for row in connection.execute(
            "SELECT Book,Chapter,Verse,Scripture FROM Titles ORDER BY Book,Chapter,Verse,id")]
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        segments = list(connection.execute(
            "SELECT book_id,par_id,sub_info FROM list_sub ORDER BY book_id,par_id,id")) if "list_sub" in tables else []

    counts = {
        "books": len({row[0] for row in bodies}),
        "chapters": len({tuple(row[:2]) for row in bodies}),
        "verses": len(bodies),
        "titles": len(titles),
    }
    if counts != EXPECTED:
        raise ValueError(f"Unexpected input inventory: {counts!r}; expected {EXPECTED!r}")
    coordinates = [tuple(row[:3]) for row in bodies]
    if len(set(coordinates)) != len(coordinates):
        raise ValueError("Duplicate scripture references; refusing to drop or merge them")
    if any(not isinstance(row[3], str) or row[3] == "" for row in bodies + titles):
        raise ValueError("Null or empty input text")

    source = {
        "edition": "rules-1",
        "books": [{"code": b["code"], "name": b["name"], "short": b["short"], "chapters": []} for b in metadata],
        "provenance": {
            "sourceFile": path.name,
            "sourceSha256": before_hash,
            "textPreservedExactly": True,
            "layoutCoordinatesStored": False,
            "paragraphPolicy": "No unverified app segmentation is used for layout; referenceSegments is audit-only.",
            "rightsStatus": "Local comparison only; app-derived source redistribution permission not confirmed.",
            "omittedFeatures": ["missing printed footnotes", "unverified poetic line structure", "unverified name and supplied-word styles"],
        },
    }
    chapter_map = {}
    body_numbers = defaultdict(set)
    for book, chapter, verse, text in bodies:
        if not 1 <= book <= len(source["books"]):
            raise ValueError(f"Invalid book number {book}")
        key = (book, chapter)
        if key not in chapter_map:
            record = {"chapter": chapter, "verses": [], "titles": [], "paragraphs": []}
            chapter_map[key] = record
            source["books"][book - 1]["chapters"].append(record)
        chapter_map[key]["verses"].append([verse, text])
        body_numbers[key].add(verse)
    for book, chapter, verse, text in titles:
        if verse not in body_numbers[book, chapter]:
            raise ValueError(f"Title anchor does not exist: {book} {chapter}:{verse}")
        chapter_map[book, chapter]["titles"].append([verse, text])

    segment_differences = []
    segment_keys = set()
    for book, chapter, raw in segments:
        key = (book, chapter)
        if key in segment_keys or key not in chapter_map:
            raise ValueError(f"Duplicate or unknown reference segment chapter: {key}")
        segment_keys.add(key)
        if not re.fullmatch(r"[0-9,-]+", raw or ""):
            raise ValueError(f"Unsupported reference segment syntax at {key}")
        starts, covered = [], set()
        for part in raw.split(","):
            endpoints = list(map(int, part.split("-")))
            lo, hi = endpoints[0], endpoints[-1]
            if len(endpoints) > 2 or lo < 1 or hi < lo:
                raise ValueError(f"Invalid reference segment at {key}: {part}")
            within = set(range(lo, hi + 1))
            if covered & within:
                raise ValueError(f"Overlapping reference segments at {key}: {part}")
            starts.append(lo)
            covered.update(within)
        chapter_map[key]["referenceSegments"] = {"ranges": raw, "starts": starts, "usedForLayout": False}
        if covered != body_numbers[key]:
            segment_differences.append({
                "book": book, "chapter": chapter,
                "rangeOnlyVerseNumbers": sorted(covered - body_numbers[key]),
                "bodyOnlyVerseNumbers": sorted(body_numbers[key] - covered),
            })

    # Full round-trip equality includes every fullwidth space and punctuation mark.
    payload = json.dumps(source, ensure_ascii=False, separators=(",", ":"))
    round_trip = json.loads(payload)
    assert scripture_rows(round_trip) == bodies, "Scripture changed during export"
    assert title_rows(round_trip) == titles, "Titles changed during export"
    after_hash = hashlib.sha256(path.read_bytes()).hexdigest()
    assert after_hash == before_hash, "Source database changed during the read-only export"
    characters = set("".join(row[3] for row in bodies + titles))
    for book in source["books"]:
        characters.update(book["name"] + book["short"])
    report = {
        "status": "validated-local-export-not-published",
        "counts": {**counts, "referenceSegmentChapters": len(segments), "layoutParagraphStarts": 0},
        "sourceFile": path.name,
        "sourceSha256Before": before_hash,
        "sourceSha256After": after_hash,
        "sourceDatabaseUnchanged": before_hash == after_hash,
        "scriptureHash": canonical_hash(bodies),
        "exportedScriptureHash": canonical_hash(scripture_rows(round_trip)),
        "titlesHash": canonical_hash(titles),
        "exportedTitlesHash": canonical_hash(title_rows(round_trip)),
        "scriptureCharacters": sum(len(row[3]) for row in bodies),
        "fullwidthSpacesPreserved": sum(row[3].count("\u3000") for row in bodies),
        "referenceSegmentDifferences": segment_differences,
        "fontCoverage": font_coverage(characters),
        "limitations": source["provenance"]["omittedFeatures"],
        "redistributionPermissionConfirmed": False,
    }
    wrapper = (
        "/* Generated local-only semantic source. No imposed typesetting breaks or page coordinates. */\n"
        "(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();"
        "else root.BIBLE_SOURCE=factory();})(typeof window!=='undefined'?window:globalThis,function(){return "
        + payload + ";});\n"
    )
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    (output / "bible-source.js").write_text(wrapper, encoding="utf-8")
    (output / "source-validation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"counts": report["counts"], "databaseUnchanged": report["sourceDatabaseUnchanged"],
                      "segmentDifferences": segment_differences, "fontCoverage": report["fontCoverage"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
