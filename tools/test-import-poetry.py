#!/usr/bin/env python3
"""Deterministic importer regressions; no network or corpus rewriting."""
import importlib.util
from io import BytesIO
from pathlib import Path
import sys
import unittest
from zipfile import ZipFile

HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("poetry_import", HERE / "import-poetry.py")
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


class ImporterTests(unittest.TestCase):
    def test_opening_quote_goes_with_poem_and_body_is_unchanged(self):
        parts = [{"kind": "prose", "text": "那人说："},
                 {"kind": "poetry", "text": "这是我骨中的骨，", "line": "GEN.q00001"},
                 {"kind": "poetry", "text": "肉中的肉。", "line": "GEN.q00002"}]
        target = "那人说：“这是我骨中的骨，肉中的肉。”"
        mapped, _, _ = importer.align_group(parts, target, "GEN.2:23")
        self.assertEqual([p["text"] for p in mapped], ["那人说：", "“这是我骨中的骨，", "肉中的肉。”"])
        self.assertEqual("".join(p["text"] for p in mapped), target)

    def test_note_words_cannot_capture_a_scripture_anchor(self):
        parts = [{"kind": "poetry", "text": "死人要复活，", "line": "ISA.a"},
                 {"kind": "poetry", "text": "尸首要兴起。", "line": "ISA.b"}]
        target = "死人（原文作“你的死人”）要复活，尸首（原文作“我的尸首”）要兴起。"
        mapped, _, _ = importer.align_group(parts, target, "ISA.26:19")
        self.assertEqual(mapped[1]["text"], "尸首（原文作“我的尸首”）要兴起。")
        self.assertEqual("".join(p["text"] for p in mapped), target)

    def test_untrusted_alignment_cannot_write_a_best_guess(self):
        with self.assertRaises(ValueError):
            importer.align_group([{"kind": "poetry", "text": "完全不同的第一句", "line": "TEST.a"},
                                  {"kind": "poetry", "text": "完全不同的第二句", "line": "TEST.b"}],
                                 "毫无共同文字。", "TEST.1:1")

    def test_parser_keeps_unmarked_continuations_and_shared_line(self):
        xml = '''<html xmlns="http://www.w3.org/1999/xhtml"><body><div class="main">
        <div class="psalmlabel">1</div><div class="d">标题。</div>
        <div class="q"><span class="verse" id="T1_1">1</span>首句，</div>
        <div class="q">次句<a class="noteref">*</a>。</div>
        <div class="q"><span class="verse" id="T1_2">2</span>第二节。
        <span class="verse" id="T1_3">3</span>第三节。</div>
        <div class="q">（<span class="verse" id="T1_4">4</span>括注。）</div>
        <div class="footnote">不得混入正文</div></div></body></html>'''
        buffer = BytesIO()
        with ZipFile(buffer, "w") as archive:
            archive.writestr("OEBPS/TST.xhtml", xml)
        buffer.seek(0)
        with ZipFile(buffer) as archive:
            groups, lines, _ = importer.parse_book(archive, "TST")
        self.assertEqual(len(lines), 4)
        self.assertEqual(groups[1, 1, 1][0], {"kind": "prose", "text": "标题。"})
        self.assertEqual(groups[1, 1, 1][-1]["text"], "次句。")
        self.assertEqual(groups[1, 2, 2][0]["line"], groups[1, 3, 3][0]["line"])
        self.assertEqual(groups[1, 4, 4][0]["text"], "（括注。）")

    @unittest.skipUnless(importer.DEFAULT_EPUB.exists(), "private local donor not present")
    def test_full_corpus_is_complete_unchanged_and_idempotent(self):
        source = importer.read_source(importer.ROOT / "local-data" / "bible-source.js")
        result, report = importer.import_poetry(source, importer.DEFAULT_EPUB)
        repeated, repeat_report = importer.import_poetry(result, importer.DEFAULT_EPUB)
        self.assertEqual(result, repeated)
        self.assertEqual(report, repeat_report)
        self.assertEqual(importer.source_rows(source), importer.source_rows(result))
        self.assertEqual(importer.title_rows(source), importer.title_rows(result))
        self.assertEqual(report["result"]["importedLines"], 20578)
        self.assertEqual(report["result"]["unmappedLines"], [])
        self.assertTrue(all(report["gates"].values()))


if __name__ == "__main__":
    unittest.main()
