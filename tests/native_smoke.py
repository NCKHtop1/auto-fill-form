#!/usr/bin/env python3
"""PandaStudy native browser checks using the CI Chromium installation."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import functools
import socket
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent / "native"
assert (ROOT / "index.html").is_file(), ROOT

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

handler = functools.partial(QuietHandler, directory=str(ROOT))
server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
port = server.server_address[1]
thread = Thread(target=server.serve_forever, daemon=True)
thread.start()
base = "http://127.0.0.1:" + str(port)
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1370, "height": 850})
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda err: errors.append(str(err)))
        page.route("**/api/auth/status", lambda route: route.fulfill(
            status=200, content_type="application/json",
            body='{"configured":false,"signedIn":false,"submissionEnabled":false}'))
        page.goto(base + "/#home", wait_until="domcontentloaded")
        page.locator("#blogGrid article").first.wait_for(timeout=15000)
        assert page.title() == "PandaStudy", page.title()
        assert page.locator("#blogGrid article").count() == 5
        assert page.locator("#langEn").count() == 0
        assert page.locator('link[rel="icon"][href="/panda.svg"]').count() == 1
        page.locator("#blogGrid article").first.locator("a").click()
        page.locator("#articleTitle").wait_for()
        assert "SPSS" in page.locator("#articleTitle").inner_text()
        assert "Bắt đầu từ bảng dữ liệu" in page.locator("#articleContent").inner_text()
        page.locator('#blogReader a[href="#blog"]').first.click()
        page.locator("#blogGrid article").first.wait_for(state="visible", timeout=10000)
        page.locator('a[href="#blog-viet-bai"]').first.click()
        page.locator("#postTitle").fill("Bài thử đăng blog PandaStudy")
        page.locator("#postSummary").fill("Đây là phần tóm tắt để thử tính năng lưu bản nháp.")
        page.locator("#postBody").fill("# Giới thiệu\n" + "Nội dung thử nghiệm. " * 10)
        page.locator("#saveBlogDraft").click()
        assert "Đã lưu" in page.locator("#blogEditorStatus").inner_text()
        page.locator("#previewBlogDraft").click()
        assert page.locator("#blogEditorPreview").is_visible()
        page.reload(wait_until="domcontentloaded")
        page.locator("#postTitle").wait_for()
        assert page.locator("#postTitle").input_value() == "Bài thử đăng blog PandaStudy"
        page.locator('a[href="/dieu-khoan.html"]').click()
        assert "Điều khoản sử dụng" in page.locator("h1").inner_text()
        page.goto(base + "/bao-mat.html", wait_until="domcontentloaded")
        assert "Chính sách bảo mật" in page.locator("h1").inner_text()
        context.close()
        mobile = browser.new_context(viewport={"width": 390, "height": 810})
        phone = mobile.new_page()
        phone.route("**/api/auth/status", lambda route: route.fulfill(
            status=200, content_type="application/json",
            body='{"configured":false,"signedIn":false,"submissionEnabled":false}'))
        phone.goto(base + "/#home", wait_until="domcontentloaded")
        phone.locator("#mobileMenu").click()
        assert phone.locator("#mainNav").is_visible()
        phone.locator('#mainNav a[href="#blog"]').click()
        assert phone.locator("#mainNav").is_hidden()
        phone.locator("#blogGrid article").first.wait_for(timeout=15000)
        assert phone.locator("#blogGrid article").count() == 5
        assert not errors, "Uncaught JS exceptions: " + repr(errors)
        mobile.close()
        browser.close()
        print("PASS: blog reader, editor, draft, footer links, icon, title, mobile menu.")
finally:
    server.shutdown()
