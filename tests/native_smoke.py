#!/usr/bin/env python3
"""PandaStudy native browser checks using the CI Chromium installation."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import functools
import socket
import json
import csv
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
            body='{"configured":true,"signedIn":true,"email":"qa@example.test","isAdmin":true,"submissionEnabled":false}'))
        form_url = "https://docs.google.com/forms/d/1RC3eFGv0NBSFxzD7PHkhaENbaXf64Lfw28K5TTjisRE/edit"
        sample_questions = [
            {"id": "100", "index": 0, "title": "Giới tính", "helpText": "",
             "required": True, "supported": True, "type": "multiple_choice",
             "options": ["Nam", "Nữ"], "entryIds": ["900"]},
            {"id": "102", "index": 1, "title": "Thang đo", "helpText": "",
             "required": True, "supported": True, "type": "grid",
             "options": ["Không đồng ý", "Đồng ý"], "rows": ["Câu 1", "Câu 2"],
             "columns": ["Không đồng ý", "Đồng ý"], "entryIds": ["901", "902"]}
        ]
        sample_form = {
            "id": "1RC3eFGv0NBSFxzD7PHkhaENbaXf64Lfw28K5TTjisRE",
            "title": "Google Form thử nghiệm",
            "description": "Đọc biểu mẫu công khai",
            "accessMode": "public", "acceptingResponses": True,
            "responseCount": None, "collectsEmail": None,
            "limitOneResponsePerUser": None,
            "supportedCount": 2, "unsupportedCount": 0,
            "questions": sample_questions
        }
        bridge_operations = []
        def mock_bridge(route):
            request = route.request.post_data_json
            name = request.get("name")
            bridge_operations.append(name)
            if name == "importOwnedForm":
                result = sample_form
            elif name == "validatePlan":
                rows = request.get("args", [None, []])[1]
                result = {"valid": True, "invalid": 0, "total": len(rows),
                          "results": [{"index": i + 1, "valid": True, "issues": []}
                                      for i in range(len(rows))]}
            elif name == "getBillingProfile":
                result = {"configured": True, "billingEnabled": False,
                          "availableCredits": 1000000, "unitPriceVnd": 0}
            elif name == "getScheduledQaRuns":
                result = []
            else:
                route.fulfill(status=400, content_type="application/json",
                              body=json.dumps({"error": "Unsupported mock operation"}))
                return
            route.fulfill(status=200, content_type="application/json",
                          body=json.dumps(result, ensure_ascii=False))
        page.route("**/api/bridge", mock_bridge)
        page.goto(base + "/#home", wait_until="domcontentloaded")
        page.locator("#formUrl").fill(form_url)
        page.locator("#importFormBtn").click()
        page.locator("#questionList .question-card").first.wait_for(timeout=10000)
        assert page.locator("#questionList .question-card").count() == 2
        assert "Google Form thử nghiệm" in page.locator("#formSummary").inner_text()
        assert page.locator(".steps-strip a").count() == 6
        assert page.locator(".steps-strip a").last.get_attribute("href") == "#qaRunStep"
        assert page.locator("#formUrl").get_attribute("aria-label") == "Đường dẫn Google Form"
        assert page.locator("#billingHint").is_hidden()
        assert page.locator("#planMessage").is_hidden()
        assert page.locator("#buildPlanBtn").inner_text().startswith("4a.")
        assert page.locator("#validatePlanBtn").inner_text().startswith("4b.")
        assert page.locator("#downloadPlanBtn").is_disabled()
        assert page.locator("#refreshCountBtn").is_disabled()
        assert "Chưa cấu hình Google" not in page.locator("#googleStatus").inner_text()
        for count in (50, 100):
            page.locator("#responseCount").fill(str(count))
            page.locator("#buildPlanBtn").click()
            assert page.locator("#planTableBody tr").count() == count
            assert page.locator("#downloadPlanBtn").is_disabled()
            assert "Chưa kiểm tra" in page.locator("#workflowResult").inner_text()
            page.locator("#validatePlanBtn").click()
            page.locator("#planTableBody tr .status-chip.success").first.wait_for(timeout=10000)
            assert page.locator("#planTableBody tr .status-chip.success").count() == count
            assert "Chưa gửi" in page.locator("#workflowResult").inner_text()
            assert page.locator("#downloadPlanBtn").is_enabled()
            assert "Đã kiểm tra" in page.locator("#progressText").inner_text()
            with page.expect_download(timeout=12000) as download_event:
                page.locator("#downloadPlanBtn").click()
            csv_download = download_event.value
            assert "chua-gui" in csv_download.suggested_filename
            with open(csv_download.path(), encoding="utf-8-sig", newline="") as f:
                csv_rows = list(csv.reader(f))
            assert len(csv_rows) == count + 1, (count, len(csv_rows))
            assert len(csv_rows[0]) == 5, csv_rows[0]
            assert csv_rows[0][:2] == ["STT", "Trạng thái"]
            assert csv_rows[1][2] in ("Nam", "Nữ")
            assert all(x[1] == "Hợp lệ (chưa gửi)" for x in csv_rows[1:])
            assert "Không có phản hồi" not in page.locator("#workflowResult").inner_text() or "chưa gửi" in page.locator("#workflowResult").inner_text().lower()
        assert "submitOneResponse" not in bridge_operations
        assert page.locator("#submitPlanBtn").is_disabled()
        assert page.locator("#submitPlanBtn").is_hidden()

        sample_form["questions"].append({
            "id": "103", "index": 2, "title": "Ý định mua lại",
            "helpText": "", "required": True, "supported": True,
            "type": "grid", "options": ["Column 1"],
            "rows": ["Câu cần thang 5 mức"], "columns": ["Column 1"],
            "entryIds": ["903"]
        })
        sample_form["supportedCount"] = 3
        page.locator("#importFormBtn").click()
        page.locator("#formWarning").wait_for(state="visible", timeout=10000)
        assert "Column 1" in page.locator("#formWarning").inner_text()
        # Home keeps the working Form and hides editorial/help content.
        assert page.locator("#app").is_visible()
        assert page.locator("#blog").is_hidden()
        assert page.locator("#how").is_hidden()
        assert page.locator("#faq").is_hidden()
        assert page.locator("#about").is_hidden()
        # Each top tab shows only its selected section, without destroying Form state.
        page.locator('#mainNav a[href="#how"]').click()
        page.locator("#how").wait_for(state="visible", timeout=5000)
        assert page.locator("#app").is_hidden()
        assert page.locator("#faq").is_hidden()
        page.locator('#mainNav a[href="#faq"]').click()
        page.locator("#faq").wait_for(state="visible", timeout=5000)
        assert page.locator("#how").is_hidden()
        page.locator('#mainNav a[href="#about"]').click()
        page.locator("#about").wait_for(state="visible", timeout=5000)
        assert page.locator("#faq").is_hidden()
        page.locator('#mainNav a[href="#app"]').click()
        page.locator("#app").wait_for(state="visible", timeout=5000)
        assert page.locator("#formSummary").is_visible()
        assert "Google Form thử nghiệm" in page.locator("#formSummary").inner_text()
        page.locator('#mainNav a[href="#blog"]').click()
        page.locator("#blog").wait_for(state="visible", timeout=5000)
        assert page.locator("#app").is_hidden()
        assert page.locator("#how").is_hidden()
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
            body='{"configured":true,"signedIn":true,"email":"qa@example.test","isAdmin":false,"submissionEnabled":false}'))
        phone.goto(base + "/#home", wait_until="domcontentloaded")
        phone.locator("#mobileMenu").click()
        assert phone.locator("#mainNav").is_visible()
        phone.locator('#mainNav a[href="#blog"]').click()
        phone.locator("#blog").wait_for(state="visible", timeout=5000)
        assert phone.locator("#mainNav").is_hidden()
        assert phone.locator("#app").is_hidden()
        phone.locator("#blogGrid article").first.wait_for(timeout=15000)
        assert phone.locator("#blogGrid article").count() == 5
        assert not errors, "Uncaught JS exceptions: " + repr(errors)
        mobile.close()
        browser.close()
        print("PASS: blog reader, editor, draft, footer links, icon, title, mobile menu.")
finally:
    server.shutdown()
