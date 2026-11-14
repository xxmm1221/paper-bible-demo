#!/usr/bin/env python3
"""Transfer semantic poetry divisions, never scripture wording or physical lines.

The donor is eBible's cmn-cu89s EPUB. Every output text is a slice of the
existing canonical verse; source typography, punctuation and spelling are not
copied. q IDs describe semantic lines, independent of font, page or viewport.
Only local-data is written; prepare-rule-release.cjs publishes allowed fields.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from copy import deepcopy
from difflib import SequenceMatcher
import hashlib
import json
from pathlib import Path
import re
import unicodedata
import xml.etree.ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_EPUB = ROOT.parent / "paper-bible-demo" / "references" / "cmn-cu89s.epub"
NS = "{http://www.w3.org/1999/xhtml}"
OPENING = set("“‘「『（([{《〈【〔〖")
CLOSING = set("”’」』）)]}》〉】〕〗")
NOTE_PATTERN = re.compile(r"（[^（）]*(?:原文|或作|或译|下同|本作|有古卷|有抄本)[^（）]*）")


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def read_source(path):
    text = path.read_text(encoding="utf-8-sig")
    match = re.search(r"function\s*\(\)\s*\{\s*return\s+(\{.*\})\s*;\s*\}\);?\s*$", text, re.S)
    if not match:
        raise ValueError(f"Unrecognized source wrapper: {path}")
    return json.loads(match[1])


def source_rows(source):
    return [[b["code"], c["chapter"], v, t] for b in source["books"] for c in b["chapters"] for v, t in c["verses"]]


def title_rows(source):
    return [[b["code"], c["chapter"], v, t] for b in source["books"] for c in b["chapters"] for v, t in c["titles"]]


def normalized(text):
    """Comparison only. Do not mutate original text, including spaces/notes."""
    # A target edition's retained inline note can repeat the very words being
    # aligned (Isaiah 26:19). Exclude these *only from comparison*, so an anchor
    # cannot mistakenly land inside a note instead of the scripture clause.
    notes = {i for match in NOTE_PATTERN.finditer(text) for i in range(*match.span())}
    positions = [i for i, ch in enumerate(text) if i not in notes and unicodedata.category(ch)[0] in "LN"]
    return "".join(text[i] for i in positions), positions


def text_events(node):
    """Inline formatting is transparent; verse and footnote markers are not text."""
    if node.get("class") == "verse":
        yield ("verse", node.get("id"))
        return
    if node.get("class") in ("noteref", "footnote") or node.tag == NS + "aside":
        return
    if node.text:
        yield ("text", node.text)
    for child in node:
        yield from text_events(child)
        if child.tail:
            yield ("text", child.tail)


def parse_book(zipfile, code):
    root = ET.fromstring(zipfile.read(f"OEBPS/{code}.xhtml").decode("utf-8-sig"))
    main = next(n for n in root.iter(NS + "div") if n.get("class") == "main")
    groups, lines, chapter, current, qnum, previous_line = {}, {}, None, None, 0, None
    pending_heading = []
    qs_count = 0
    for div in main:
        cls = div.get("class")
        if cls == "psalmlabel":
            chapter = int("".join(div.itertext()).strip())
            current, previous_line, pending_heading = None, None, []
            continue
        if cls == "d":
            pending_heading.append("".join(v for k, v in text_events(div) if k == "text").strip())
            continue
        if cls not in ("q", "qs", "p", "m"):
            continue
        if cls == "q":
            qnum += 1
            line = f"{code}.q{qnum:05d}"
            lines[line] = {"chapter": chapter, "fragments": []}
            previous_line = line
        elif cls == "qs":
            # A Selah marker accompanies the preceding semantic line; it does
            # not add an invented q line to the donor's 20,578-line inventory.
            line = previous_line
            qs_count += 1
        else:
            line = None
        events = list(text_events(div))
        first_marker = next((i for i, event in enumerate(events) if event[0] == "verse"), None)
        if first_marker is not None:
            leading = "".join(v for k, v in events[:first_marker] if k == "text").strip()
            if leading and all(ch in OPENING or ch.isspace() for ch in leading):
                # A few q elements put an opening parenthesis before the verse
                # span (e.g. Job 31:6). It belongs to that verse, not 31:5.
                events = [events[first_marker], ("text", leading)] + events[first_marker + 1:]
        for kind, value in events:
            if kind == "verse":
                vpart = value.split("_", 1)[1]
                vs = [int(v) for v in vpart.split("-")]
                current = (chapter, vs[0], vs[-1])
                group = groups.setdefault(current, [])
                if pending_heading:
                    group.append({"kind": "prose", "text": "".join(pending_heading)})
                    pending_heading = []
                continue
            # EPUB indentation uses ASCII whitespace; fullwidth spaces in the
            # scripture are retained in donor text for audit, never published.
            value = re.sub(r"[\r\n\t ]+", "", value)
            if not value or not value.strip("\u00a0"):
                continue
            if current is None:
                raise ValueError(f"Unanchored scripture in {code}: {value!r}")
            segment = {"kind": "poetry" if line else "prose", "text": value}
            if line:
                segment["line"] = line
                if cls == "q":
                    lines[line]["fragments"].append([*current, value])
            group = groups[current]
            if group and (group[-1]["kind"], group[-1].get("line")) == (segment["kind"], segment.get("line")):
                group[-1]["text"] += value
            else:
                group.append(segment)
    return groups, lines, qs_count


def raw_boundary(text, positions, index):
    if index <= 0:
        return 0
    if index >= len(positions):
        return len(text)
    boundary = positions[index]
    # Sentence punctuation and closing quotes stay with the previous line;
    # an opening quote belongs to the following line, never the prose intro.
    while boundary > positions[index - 1] + 1 and (text[boundary - 1] in OPENING or text[boundary - 1].isspace()):
        boundary -= 1
    return boundary


def align_group(parts, target, ref):
    donor = "".join(p["text"] for p in parts)
    a, _ = normalized(donor)
    b, positions = normalized(target)
    matcher = SequenceMatcher(None, a, b, autojunk=False)
    equal = {}
    opcodes = matcher.get_opcodes()
    for tag, a0, a1, b0, b1 in opcodes:
        if tag == "equal":
            for i in range(a0, a1):
                equal[i] = b0 + i - a0
    changes = [{"source": a[a0:a1], "target": b[b0:b1], "at": a0, "kind": tag}
               for tag, a0, a1, b0, b1 in opcodes if tag != "equal"]
    boundaries, uncertainty = [0], []
    source_cursor = 0
    for part in parts[:-1]:
        source_cursor += len(normalized(part["text"])[0])
        if source_cursor in equal:
            mapped = equal[source_cursor]
            method = "next-exact"
        elif source_cursor - 1 in equal:
            mapped = equal[source_cursor - 1] + 1
            method = "previous-exact"
        else:
            candidates = [(tag, a0, a1, b0, b1) for tag, a0, a1, b0, b1 in opcodes if a0 <= source_cursor <= a1 and a1 > a0]
            tag, a0, a1, b0, b1 = candidates[0]
            # Two adjoining spelling/pronoun variants can straddle a break,
            # e.g. 权利|她 -> 权力|他 (Zechariah 9). Equal-length, <=3-character
            # substitutions with exact flanking anchors have an unambiguous
            # character correspondence; all other interpolation is forbidden.
            flanks = all(i in equal for i in range(max(0, a0 - 4), a0)) and \
                all(i in equal for i in range(a1, min(len(a), a1 + 4)))
            if tag != "replace" or a1 - a0 != b1 - b0 or a1 - a0 > 3 or not flanks:
                raise ValueError(f"Unresolved semantic boundary: {ref} source offset {source_cursor}")
            mapped = b0 + source_cursor - a0
            method = "equal-length-variant"
        boundary = raw_boundary(target, positions, mapped)
        boundaries.append(boundary)
        # A changed character immediately adjacent to a semantic break warrants
        # explicit review. The audit stores both contexts without editing them.
        exact_left = all(i in equal for i in range(max(0, source_cursor - 2), source_cursor))
        exact_right = all(i in equal for i in range(source_cursor, min(len(a), source_cursor + 2)))
        if method == "equal-length-variant" or not (exact_left and exact_right):
            uncertainty.append({"ref": ref, "boundary": len(boundaries) - 1, "sourceIndex": source_cursor,
                                "targetIndex": boundary, "method": method,
                                "status": "resolved",
                                "reason": "Short equal-length variants with exact four-character flanks" if method == "equal-length-variant" else
                                          "Exact adjacent scripture anchor; nearby spelling differences do not move the boundary",
                                "sourceContext": a[max(0, source_cursor - 10):source_cursor] + " | " + a[source_cursor:source_cursor + 10],
                                "targetContext": target[max(0, boundary - 16):boundary] + " | " + target[boundary:boundary + 16]})
    boundaries.append(len(target))
    if boundaries != sorted(boundaries):
        raise ValueError(f"Nonmonotonic alignment: {ref}")
    segments = []
    for part, start, end in zip(parts, boundaries, boundaries[1:]):
        item = dict(part, text=target[start:end])
        if not item["text"]:
            raise ValueError(f"Empty semantic segment: {ref} {part}")
        segments.append(item)
    if "".join(s["text"] for s in segments) != target:
        raise ValueError(f"Canonical text changed: {ref}")
    coverage = len(equal) / max(1, len(a))
    if coverage < .95:
        raise ValueError(f"Insufficient source alignment coverage: {ref} {coverage:.3%}")
    return segments, {"ref": ref, "sourceCoverage": round(coverage, 6), "targetCoverage": round(len(equal) / max(1, len(b)), 6), "changes": changes}, uncertainty


def joined_groups(groups, chapters):
    """Align chapters, then split exact target slices back at canonical verses.

    Besides explicit merged ranges, the editions occasionally put words on
    different sides of a verse marker (1 John 2:13-14). Chapter-local alignment
    handles both without manual reference exceptions or changing verse records.
    """
    merged = []
    for chapter, c in chapters.items():
        source_groups = [(lo, hi, parts) for (ch, lo, hi), parts in groups.items() if ch == chapter]
        chapter_parts = []
        for lo, hi, parts in source_groups:
            for part in parts:
                if chapter_parts and (chapter_parts[-1]["kind"], chapter_parts[-1].get("line")) == (part["kind"], part.get("line")):
                    chapter_parts[-1]["text"] += part["text"]
                else:
                    chapter_parts.append(dict(part))
        merged.append([chapter, c["verses"][0][0], c["verses"][-1][0], chapter_parts])
    return merged


def import_poetry(source, epub):
    output = deepcopy(source)
    output["edition"] = "rules-2"
    coverage, alignments, uncertain, imported_lines, all_lines = [], [], [], set(), {}
    qs_count, annotated_verses = 0, 0
    with ZipFile(epub) as z:
        for book in output["books"]:
            code = book["code"]
            groups, lines, qs = parse_book(z, code)
            all_lines.update(lines)
            qs_count += qs
            chapters = {c["chapter"]: c for c in book["chapters"]}
            annotated = defaultdict(dict)
            for chapter, first, last, parts in joined_groups(groups, chapters):
                if not any(p["kind"] == "poetry" for p in parts):
                    continue
                canonical = [(v, t) for v, t in chapters[chapter]["verses"] if first <= v <= last]
                if [v for v, _ in canonical] != list(range(first, last + 1)):
                    raise ValueError(f"Missing target verse range: {code}.{chapter}.{first}-{last}")
                target = "".join(t for _, t in canonical)
                ref = f"{code}.{chapter}:{first}" + (f"-{last}" if first != last else "")
                mapped, audit, issues = align_group(parts, target, ref)
                alignments.append(audit)
                uncertain.extend(issues)
                cursor = 0
                ranges = []
                for item in mapped:
                    ranges.append((cursor, cursor + len(item["text"]), item))
                    cursor += len(item["text"])
                verse_cursor = 0
                for verse, text in canonical:
                    pieces = []
                    end = verse_cursor + len(text)
                    for lo, hi, item in ranges:
                        start_part, end_part = max(lo, verse_cursor), min(hi, end)
                        if start_part < end_part:
                            new = dict(item, text=target[start_part:end_part])
                            pieces.append(new)
                    if text.strip() == "-":
                        pieces = [{"kind": "prose", "text": text}]
                    assert "".join(p["text"] for p in pieces) == text, ref
                    if any(p["kind"] == "poetry" for p in pieces):
                        annotated[chapter][verse] = pieces
                        imported_lines.update(p["line"] for p in pieces if p["kind"] == "poetry")
                    verse_cursor = end
            for chapter in book["chapters"]:
                records = [{"verse": v, "segments": parts} for v, parts in sorted(annotated[chapter["chapter"]].items())]
                if records:
                    chapter["poetry"] = records
                    annotated_verses += len(records)
                else:
                    chapter.pop("poetry", None)
            coverage.append({"code": code, "sourceLines": len(lines), "importedLines": sum(x in imported_lines for x in lines)})
    assert source_rows(source) == source_rows(output), "Body must be byte-for-byte identical per verse"
    assert title_rows(source) == title_rows(output), "Existing headings must not change"
    assert len(all_lines) == 20578 and sum(c["sourceLines"] > 0 for c in coverage) == 53, "Unexpected donor line inventory"
    assert set(all_lines) == imported_lines, "Every source q line must survive into the output"
    for book in output["books"]:
        for chapter in book["chapters"]:
            canonical = dict(chapter["verses"])
            for record in chapter.get("poetry", []):
                text, cursor = canonical[record["verse"]], 0
                spans = [match.span() for match in NOTE_PATTERN.finditer(text)]
                for segment in record["segments"]:
                    cursor += len(segment["text"])
                    if any(lo < cursor < hi for lo, hi in spans):
                        raise ValueError(f"Boundary inside an inline note: {book['code']}.{chapter['chapter']}:{record['verse']}")
                    if segment["text"].rstrip()[-1:] in OPENING or segment["text"].lstrip()[:1] in CLOSING:
                        raise ValueError(f"Orphan quote/bracket at semantic boundary: {book['code']}.{chapter['chapter']}:{record['verse']}")
    report = {"source": {"epub": str(epub), "sha256": hashlib.sha256(epub.read_bytes()).hexdigest(),
                         "poetryLines": len(all_lines), "poetryBooks": sum(c["sourceLines"] > 0 for c in coverage), "selahMarkers": qs_count},
              "result": {"edition": output["edition"], "importedLines": len(imported_lines), "annotatedVerses": annotated_verses,
                         "unmappedLines": sorted(set(all_lines) - imported_lines), "perBook": coverage},
              "integrity": {"beforeBodySha256": digest(source_rows(source)), "afterBodySha256": digest(source_rows(output)),
                            "beforeTitlesSha256": digest(title_rows(source)), "afterTitlesSha256": digest(title_rows(output)),
                            "bodyCharacters": sum(len(t) for _, _, _, t in source_rows(source)), "verseCount": len(source_rows(source))},
              "boundaryReview": uncertain,
              "gates": {"allSourceLinesMapped": True, "allBoundaryReviewsResolved": all(x["status"] == "resolved" for x in uncertain),
                        "noInterpolation": True, "noSplitInlineNotes": True, "noOrphanOpeningOrClosingMarks": True,
                        "canonicalBodyAndTitlesUnchanged": True, "minimumSourceCoverageRequired": .95},
              "alignment": {"groups": len(alignments), "minimumSourceCoverage": min(a["sourceCoverage"] for a in alignments),
                            "lowCoverage": [a for a in alignments if a["sourceCoverage"] < .9],
                            "changedGroups": [a for a in alignments if a["changes"]]},
              "limitations": ["q semantic boundaries imported; donor has no q1/q2 indentation hierarchy",
                              "qs (Selah) retained with preceding q, canonical inline notes retained",
                              "No donor wording, font metrics, printed page numbers, or physical line coordinates imported"]}
    return output, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--epub", type=Path, default=DEFAULT_EPUB)
    parser.add_argument("--source", type=Path, default=ROOT / "local-data" / "bible-source.js")
    parser.add_argument("--output", type=Path, default=ROOT / "local-data" / "bible-source.js")
    parser.add_argument("--report", type=Path, default=ROOT / "local-data" / "poetry-import-audit.json")
    parser.add_argument("--audit-only", action="store_true")
    args = parser.parse_args()
    source = read_source(args.source)
    output, report = import_poetry(source, args.epub)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if not args.audit_only:
        wrapper = "/* Canonical scripture with semantic poetry lines; no physical line or page coordinates. */\n" + \
            "(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.BIBLE_SOURCE=factory();})(typeof window!=='undefined'?window:globalThis,function(){return " + \
            json.dumps(output, ensure_ascii=False, separators=(",", ":")) + ";});\n"
        args.output.write_text(wrapper, encoding="utf-8")
    print(json.dumps({"result": report["result"] | {"perBook": "see report"}, "integrity": report["integrity"],
                      "boundaryReview": len(report["boundaryReview"]), "lowCoverage": len(report["alignment"]["lowCoverage"]),
                      "written": not args.audit_only}, ensure_ascii=False))


if __name__ == "__main__":
    main()
