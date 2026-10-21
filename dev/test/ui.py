#!/usr/bin/env python3
"""mdview's interface tests.

The renderer has the CommonMark corpus behind it (test/run.js). This suite is for the
rest of the reader: the window, the folders on the left, the tabs along the top, and
the pages each kind of file opens in. It drives a real reader over HTTP with a real
browser, on a port of its own and with folders of its own, so it never touches the
files the reader really shows.

    python3 test/ui.py              # the whole suite
    python3 test/ui.py -k tab       # only the tests whose name holds "tab"

Needs Playwright (`pip install playwright && playwright install chromium`).
"""
import json
import os
import pathlib
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.parse

from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
APP = pathlib.Path(os.environ.get("MDVIEW_APP") or (HERE.parent.parent / "reader"))

# A page of plain text with a heading and a link, so the note's own render and its
# links to another note can both be looked at. It is long enough that a scroll into the
# middle of it is not the end of it.
NOTE = """# The first note

A note with a [link to the second](second.md) in it, and a word to look up:
elephant.

## A second heading

Some more text, so the note is longer than one screen. The reader keeps the place
that was reached, and the place is a page and a fraction of a page, so that a
window that is opened again comes back to the same words.

""" + ("A paragraph of filler, so that the note is several screens long and the " * 40) + """
The last line.
"""

SECOND = "# The second note\n\nThe second one.\n"

SCRIPT = 'print("hello")\n'

# A one-pixel PNG: enough for the picture view to have a size of its own.
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000200000002008060000007352"
    "9c3d0000001e49444154789cedcd310100200c0430f5c8a00000000049454e44ae426082"
)


def a_pdf():
    """A one-page PDF, built with the offsets its cross-reference table needs."""
    stream = "BT /F1 18 Tf 20 100 Td (Hello) Tj ET"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources "
        "<< /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for n, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{n} 0 obj\n{body}\nendobj\n".encode()
    start = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n".encode()
    return bytes(out)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Reader:
    """A reader of its own, on a port of its own, with folders of its own."""

    def __init__(self):
        self.dir = pathlib.Path(tempfile.mkdtemp(prefix="mdview-ui-"))
        self.notes = self.dir / "notes"
        self.notes.mkdir()
        (self.notes / "first.md").write_text(NOTE, encoding="utf-8")
        (self.notes / "second.md").write_text(SECOND, encoding="utf-8")
        (self.notes / "script.py").write_text(SCRIPT, encoding="utf-8")
        (self.notes / "notes.csv").write_text("id,name\n1,one\n2,two\n", encoding="utf-8")
        (self.notes / "dot.png").write_bytes(PNG)
        (self.notes / "with-picture.md").write_text(
            "# With a picture\n\n![a dot](dot.png)\n", encoding="utf-8"
        )
        self.sub = self.notes / "sub"
        self.sub.mkdir()
        (self.sub / "inside.md").write_text("# Inside\n", encoding="utf-8")
        self.roots = self.dir / "roots.json"
        self.roots.write_text(json.dumps([str(self.notes)]), encoding="utf-8")
        self.port = free_port()
        self.base = f"http://127.0.0.1:{self.port}"
        self.process = subprocess.Popen(
            [sys.executable, str(APP / "server.py")],
            env={**os.environ, "MDVIEW_PORT": str(self.port), "MDVIEW_ROOTS": str(self.roots)},
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self.wait()

    def wait(self):
        import urllib.request

        for _ in range(100):
            try:
                with urllib.request.urlopen(self.base + "/healthz", timeout=1) as r:
                    if r.read() == b"ok":
                        return
            except Exception:
                time.sleep(0.1)
        raise RuntimeError("the reader did not start")

    def stop(self):
        self.process.terminate()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
        shutil.rmtree(self.dir, ignore_errors=True)


class InterfaceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reader = Reader()
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch()
        cls.context = cls.browser.new_context(viewport={"width": 1280, "height": 820})
        cls.page = cls.context.new_page()
        cls.errors = []
        cls.page.on("pageerror", lambda e: cls.errors.append(str(e)))

    @classmethod
    def tearDownClass(cls):
        cls.context.close()
        cls.browser.close()
        cls.pw.stop()
        cls.reader.stop()

    def setUp(self):
        # Every test starts from an empty window: the workspace keeps its state in the
        # browser, and a test that inherited the last one's tabs would be testing the
        # last test.
        self.page.goto(self.reader.base + "/", wait_until="load")
        self.page.evaluate("() => localStorage.clear()")
        self.page.reload(wait_until="load")
        self.page.wait_for_timeout(300)

    # the helpers

    def open_workspace(self, query=""):
        """The window. The query is what follows the slash: `library`, `?open=…`."""
        self.page.goto(self.reader.base + "/" + query, wait_until="load")
        self.page.wait_for_timeout(400)

    def rows(self):
        """The names in the tree, the files only."""
        return self.page.locator('.ws-row:not([data-dir="1"]):not(.up) .name').all_inner_texts()

    def tabs(self):
        return [t.strip() for t in self.page.locator(".ws-tab .name").all_inner_texts()]

    def document(self):
        """The frame the open file is shown in."""
        self.page.wait_for_selector(".ws-frame", timeout=15000)
        return self.page.frame_locator(".ws-frame")

    def open_in_the_tree(self, name):
        self.page.locator(".ws-row", has_text=name).first.click()
        self.page.wait_for_timeout(1200)

    # the tests

    def test_the_window_opens_with_the_folders_on_the_left(self):
        self.open_workspace()
        self.assertEqual(self.page.locator("#ws-root-where").inner_text(), str(self.reader.notes))
        self.assertIn("first.md", self.rows())
        self.assertEqual(self.page.locator(".ws-tab").count(), 0)
        self.assertTrue(self.page.locator("#ws-empty").is_visible())

    def test_a_file_opens_in_a_tab(self):
        self.open_workspace()
        self.open_in_the_tree("first.md")
        self.assertEqual(self.tabs(), ["first.md"])
        self.assertIn("The first note", self.document().locator("h1").first.inner_text())

    def test_the_tabs_come_back_after_a_reload(self):
        self.open_workspace()
        self.open_in_the_tree("first.md")
        self.page.reload(wait_until="load")
        self.page.wait_for_timeout(1200)
        self.assertIn("first.md", self.tabs())

    def test_a_file_with_no_engine_opens_as_its_text(self):
        self.open_workspace()
        self.open_in_the_tree("script.py")
        self.assertIn('print("hello")', self.document().locator(".txt-body").inner_text())

    def test_a_link_to_another_note_opens_a_tab(self):
        self.open_workspace()
        self.open_in_the_tree("first.md")
        link = self.document().locator(".mdview a").first
        link.scroll_into_view_if_needed()
        link.click()
        self.page.wait_for_timeout(1500)
        self.assertIn("second.md", self.tabs())

    def test_a_picture_in_a_note_opens_in_the_picture_view(self):
        self.open_workspace()
        self.open_in_the_tree("with-picture.md")
        self.page.wait_for_timeout(1200)
        image = self.document().locator(".mdview img").first
        image.scroll_into_view_if_needed()
        image.click()
        self.page.wait_for_timeout(2000)
        self.assertIn("dot.png", self.tabs())

    def test_the_tree_filters_by_kind(self):
        self.open_workspace()
        self.page.click('.ws-chip[data-kind="md"]')
        self.page.wait_for_timeout(300)
        self.assertEqual(sorted(self.rows()), ["first.md", "second.md", "with-picture.md"])
        self.page.click('.ws-chip[data-kind="all"]')
        self.page.wait_for_timeout(300)
        self.assertIn("script.py", self.rows())
    def test_the_filter_panel_filters_by_extension(self):
        self.open_workspace()
        self.page.click("#ws-more-btn")
        self.page.wait_for_timeout(300)
        options = self.page.locator("#ws-ext option").all_inner_texts()
        self.assertIn(".py", options)
        self.page.select_option("#ws-ext", "py")
        self.page.wait_for_timeout(300)
        self.assertEqual(self.rows(), ["script.py"])

    def test_going_up_moves_the_tree_one_level(self):
        self.open_workspace()
        self.assertTrue(self.page.locator(".ws-row.up").count() >= 1)
        self.page.locator(".ws-row.up").first.click()
        self.page.wait_for_timeout(600)
        self.assertEqual(self.page.locator("#ws-root-where").inner_text(), str(self.reader.dir))

    def test_the_three_dots_reposition_the_tree(self):
        self.open_workspace()
        row = self.page.locator(".ws-row.dir").first
        row.hover()
        row.locator(".dots").click()
        self.page.wait_for_timeout(300)
        menu = self.page.locator(".ws-menu .ws-menu-item").all_inner_texts()
        self.assertIn("Go to this folder", menu)
        self.page.locator(".ws-menu .ws-menu-item", has_text="Go to this folder").click()
        self.page.wait_for_timeout(800)
        self.assertNotEqual(self.page.locator("#ws-root-where").inner_text(), str(self.reader.notes))

    def test_a_write_without_the_token_is_refused(self):
        import urllib.error
        import urllib.request

        request = urllib.request.Request(
            self.reader.base + "/api/mkdir",
            data=json.dumps({"dir": str(self.reader.notes), "name": "nope"}).encode(),
            headers={"Content-Type": "application/json", "Origin": self.reader.base},
            method="POST",
        )
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(request)
        self.assertEqual(caught.exception.code, 403)
        self.assertFalse((self.reader.notes / "nope").exists())

    def test_a_file_outside_the_folders_offers_to_add_its_folder(self):
        outside = self.reader.dir / "outside.md"
        outside.write_text("# Outside\n", encoding="utf-8")
        self.open_workspace("?open=" + urllib.parse.quote(str(outside)))
        self.page.wait_for_timeout(1500)
        self.assertIn("only shows the folders", self.document().locator("body").inner_text())

    def test_a_picture_opens_at_its_own_size(self):
        picture = self.reader.notes / "dot.png"
        picture.write_bytes(PNG)
        self.open_workspace("?open=" + urllib.parse.quote(str(picture)))
        self.page.wait_for_timeout(1500)
        self.assertEqual(self.document().locator(".imgview-level").inner_text(), "100%")

    def test_a_pdf_opens_with_its_page_tools(self):
        pdf = self.reader.notes / "one.pdf"
        pdf.write_bytes(a_pdf())
        self.open_workspace("?open=" + urllib.parse.quote(str(pdf)))
        self.page.wait_for_timeout(4000)
        self.assertEqual(self.document().locator(".pdf-nav").count(), 1)

    def test_the_reading_place_is_kept(self):
        self.open_workspace()
        self.open_in_the_tree("first.md")
        self.page.wait_for_timeout(1500)
        self.document().locator("body").evaluate(
            "() => window.scrollTo(0, document.documentElement.scrollHeight * 0.4)"
        )
        self.page.wait_for_timeout(2000)
        self.open_workspace("library")
        self.page.wait_for_timeout(600)
        self.assertIn("Read to", self.page.locator("#recent li").first.inner_text())


if __name__ == "__main__":
    unittest.main(verbosity=2)
