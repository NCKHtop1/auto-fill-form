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
        validation_mode = {"invalid_first_student_rows": 0}
        def click_import_form():
            # Keep the input centered below the sticky header. This is a real
            # Playwright click, not force=True or a synthetic DOM click.
            page.locator("#importFormBtn").evaluate(
                "(el) => el.scrollIntoView({block: 'center', behavior: 'instant'})")
            page.locator("#importFormBtn").click()
        def mock_bridge(route):
            request = route.request.post_data_json
            name = request.get("name")
            bridge_operations.append(name)
            if name == "importOwnedForm":
                result = sample_form
            elif name == "validatePlan":
                rows = request.get("args", [None, []])[1]
                results = []
                for i, record in enumerate(rows):
                    code = str(record.get("answers", {}).get("211", ""))
                    number = int(code[2:]) if code.startswith("HS") and code[2:].isdigit() else 0
                    invalid = 0 < number <= validation_mode["invalid_first_student_rows"]
                    results.append({
                        "index": i + 1,
                        "valid": not invalid,
                        "issues": ["Nhóm: Không tìm thấy lựa chọn ĐC-Z"] if invalid else []
                    })
                result = {"valid": all(r["valid"] for r in results),
                          "invalid": sum(not r["valid"] for r in results),
                          "total": len(rows), "results": results}
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
        page.wait_for_function("typeof window.PandaStudyErrorGuide === 'object'")
        # Error diagnostics must be visible, actionable and safe, not a generic red
        # message disappearing after 5 seconds. All external help opens only after
        # explicit user action and must never automatically send private data.
        page.evaluate("""() => toast(
          'Dòng 4 có 2 cột, khác 3 cột ở dòng đầu',
          'error', {stage:'upload'}
        )""")
        data_alert = page.locator("#toastWrap .guide-toast")
        assert data_alert.is_visible()
        assert data_alert.get_attribute("data-issue-kind") == "data"
        assert "Tải Excel/CSV/JSON" in data_alert.inner_text()
        assert "Dòng 4" in data_alert.inner_text()
        assert "hàng tiêu đề" in data_alert.inner_text()
        assert "Email hỗ trợ" in data_alert.inner_text()
        assert "Zalo hỗ trợ" in data_alert.inner_text()
        assert data_alert.locator('a[href^="mailto:"]').count() == 1
        assert data_alert.locator('a[href^="mailto:"]').get_attribute("href").startswith(
            "mailto:trangnguyen11850.marketing@gmail.com?")
        assert data_alert.locator('a[href="https://zalo.me/0349222590"]').count() == 1
        assert "Dòng 4 có 2 cột" not in data_alert.locator('a[href^="mailto:"]').get_attribute("href")
        page.evaluate("""() => {
          Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{
            writeText: async (text) => { window.__pandaCopiedSupport = text; }
          }});
        }""")
        data_alert.get_by_text("Sao chép mô tả lỗi").click()
        page.wait_for_function("!!window.__pandaCopiedSupport")
        assert "Tải Excel/CSV/JSON" in page.evaluate("window.__pandaCopiedSupport")
        assert "Dòng 4 có 2 cột" not in page.evaluate("window.__pandaCopiedSupport")
        page.evaluate("""() => toast(
          '196 dòng chưa hợp lệ.',
          'error', {stage:'validation'}
        )""")
        assert page.locator('#toastWrap .guide-toast[data-issue-kind="validation"]').count() == 1
        assert "Chưa thể kết luận" in page.locator('#toastWrap .guide-toast').last.inner_text()
        assert page.locator("#toastWrap .guide-toast").last.get_by_text("Xem lỗi từng dòng").count() == 1
        page.locator("#toastWrap .guide-toast").last.locator(".guide-toast-close").click()
        assert page.locator('#toastWrap .guide-toast[data-issue-kind="validation"]').count() == 0
        page.evaluate("""() => toast(
          'Internal Server Error', 'error', {stage:'submission',status:500}
        )""")
        assert page.locator('#toastWrap .guide-toast[data-issue-kind="system"]').count() == 1
        assert "Máy chủ PandaStudy" in page.locator('#toastWrap .guide-toast').last.inner_text()
        # The toast must float above (not over) the fixed Zalo button on mobile.
        page.set_viewport_size({"width": 390, "height": 800})
        mobile_alert = page.locator("#toastWrap .guide-toast").last.bounding_box()
        mobile_zalo = page.locator("#psZaloSupport").bounding_box()
        assert mobile_alert and mobile_zalo
        assert mobile_alert["y"] + mobile_alert["height"] <= mobile_zalo["y"] + 2, (
            mobile_alert, mobile_zalo)
        assert mobile_alert["x"] >= 0 and mobile_alert["x"] + mobile_alert["width"] <= 391
        page.locator("#toastWrap .guide-toast").last.locator(".guide-toast-close").click()
        page.set_viewport_size({"width": 1370, "height": 850})
        assert not page.locator("#toastWrap .guide-toast").count()
        page.locator("#formUrl").fill(form_url)
        click_import_form()
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
        # Plain-language text answers UX: required text must be provided;
        # optional contact stays empty without manufacturing personal details.
        sample_form["questions"] = sample_questions + [
            {"id": "200", "index": 2, "title": "Trải nghiệm của người tham gia",
             "helpText": "", "required": True, "supported": True,
             "type": "paragraph", "options": [], "entryIds": ["950"]},
            {"id": "201", "index": 3, "title": "Họ tên & SĐT/Zalo/Email (tùy chọn)",
             "helpText": "", "required": False, "supported": True,
             "type": "short_text", "options": [], "entryIds": ["951"]}
        ]
        sample_form["supportedCount"] = 4
        click_import_form()
        required_text = page.locator('.text-samples[data-qid="200"]')
        optional_text = page.locator('.text-samples[data-qid="201"]')
        required_text.wait_for(timeout=10000)
        assert optional_text.is_visible()
        assert required_text.input_value() == ""
        assert optional_text.input_value() == ""
        assert required_text.get_attribute("placeholder") == "Dán câu trả lời vào đây…"
        assert page.locator('label[for="text-samples-200"]').count() == 1
        plain_ui = page.locator("#questionList").inner_text()
        assert "Khi Excel không có dữ liệu" in plain_ui
        assert "Câu trả lời có sẵn (mỗi dòng một câu)" in plain_ui
        assert "Câu bắt buộc: cần dữ liệu Excel" in plain_ui
        assert "Câu không bắt buộc: nếu không có dữ liệu" in plain_ui
        assert "Thông tin liên hệ chỉ được điền khi" in plain_ui
        assert "Quy tắc tạo dự phòng" not in plain_ui
        assert "{{n}}" not in plain_ui and "{{timestamp}}" not in plain_ui
        page.locator("#responseCount").fill("1")
        page.locator("#buildPlanBtn").click()
        assert "Câu bắt buộc" in page.locator("#workflowResult").inner_text()
        required_text.fill("Nội dung do người trả lời cung cấp")
        page.locator("#buildPlanBtn").click()
        page.wait_for_function("document.querySelectorAll('#planTableBody tr').length===1")
        generated = page.evaluate("window.PandaStudyQA.getRows()[0].answers")
        assert generated["200"] == "Nội dung do người trả lời cung cấp"
        assert "201" not in generated, "Optional contact cannot be invented"
        # Regression: DOM text may be present without an 'input' event (autofill,
        # restored form values, or script-based restoration). Preview must sync it.
        required_text.evaluate("(node) => { node.value = 'HS214\\nHS215\\nHS216'; }")
        page.locator("#responseCount").fill("3")
        page.locator('.text-sample-mode[data-qid="200"]').select_option("ordered")
        page.locator("#buildPlanBtn").click()
        page.wait_for_function("window.PandaStudyQA.getRows().length === 3")
        sample_answers = [row["answers"]["200"] for row in page.evaluate("window.PandaStudyQA.getRows()")]
        assert sample_answers == ["HS214", "HS215", "HS216"], sample_answers
        # A render cycle must preserve visible manual entries.
        page.evaluate("setLanguage('vi')")
        assert page.locator('.text-samples[data-qid="200"]').input_value() == "HS214\nHS215\nHS216"
        page.locator("#buildPlanBtn").click()
        assert [row["answers"]["200"] for row in page.evaluate("window.PandaStudyQA.getRows()")] == sample_answers
        page.locator("#responseCount").fill("4")
        page.locator("#buildPlanBtn").click()
        assert "không đủ điền dòng 4" in page.locator("#workflowResult").inner_text()
        page.locator("#responseCount").fill("3")
        page.locator('.text-samples[data-qid="200"]').fill("HS214\nHS214\nHS216")
        page.locator("#buildPlanBtn").click()
        assert "giá trị trùng" in page.locator("#workflowResult").inner_text()
        page.locator('.text-sample-mode[data-qid="200"]').select_option("random")
        page.locator("#buildPlanBtn").click()
        assert len(page.evaluate("window.PandaStudyQA.getRows()")) == 3
        assert all(row["answers"]["200"] in ["HS214", "HS216"] for row in page.evaluate("window.PandaStudyQA.getRows()"))
        # Optional uploaded-file mode: merely loading a file must NOT change
        # preview answers, selected count, or mapping rules until explicitly opted in.
        sample_form["questions"] = [
            {"id": "601", "index": 0, "title": "Mã hồ sơ", "helpText": "",
             "required": True, "supported": True, "type": "short_text",
             "options": [], "entryIds": ["1011"]},
            {"id": "602", "index": 1, "title": "Trạng thái", "helpText": "",
             "required": True, "supported": True, "type": "multiple_choice",
             "options": ["Đạt", "Chưa đạt"], "entryIds": ["1012"]},
            {"id": "603", "index": 2, "title": "Ý kiến", "helpText": "",
             "required": False, "supported": True, "type": "paragraph",
             "options": [], "entryIds": ["1013"]}
        ]
        sample_form["supportedCount"] = 3
        click_import_form()
        page.locator("#responseCount").fill("2")
        page.locator('.text-samples[data-qid="601"]').fill("TAY001\nTAY002")
        page.locator('.text-sample-mode[data-qid="601"]').select_option("ordered")
        assert page.locator("#fillFromUploadedFile").is_disabled()
        assert not page.locator("#fillFromUploadedFile").is_checked()
        csv_bytes = ("Mã hồ sơ,Trạng thái,Ý kiến\n"
                     "0001,Đạt,Nội dung Excel 1\n"
                     "0002,Chưa đạt,Nội dung Excel 2\n"
                     "0003,Đạt,Nội dung Excel 3\n").encode("utf-8")
        page.locator("#dataFile").set_input_files({
            "name": "bo-phieu-khao-sat.csv", "mimeType": "text/csv",
            "buffer": csv_bytes
        })
        page.wait_for_function("!document.querySelector('#dataSummary').classList.contains('hidden')")
        assert page.locator("#fillFromUploadedFile").is_enabled()
        assert not page.locator("#fillFromUploadedFile").is_checked()
        assert page.locator("#responseCount").input_value() == "2"
        assert page.locator('.mapping-select[data-qid="601"]').is_disabled()
        assert "chưa dùng để điền" in page.locator("#uploadedFileFillHint").inner_text().lower()
        page.locator("#buildPlanBtn").click()
        assert [r["answers"]["601"] for r in page.evaluate("window.PandaStudyQA.getRows()")] == ["TAY001", "TAY002"]
        assert all("603" not in r["answers"] for r in page.evaluate("window.PandaStudyQA.getRows()"))
        page.locator("#fillFromUploadedFile").check()
        assert page.locator("#responseCount").input_value() == "3"
        assert page.locator("#rowStrategy").input_value() == "sequential_no_repeat"
        assert page.locator('.mapping-select[data-qid="601"]').is_enabled()
        assert page.locator('.mapping-select[data-qid="601"]').input_value() == "Mã hồ sơ"
        assert page.locator('.mapping-select[data-qid="602"]').input_value() == "Trạng thái"
        assert page.locator('.mapping-select[data-qid="603"]').input_value() == "Ý kiến"
        page.locator("#buildPlanBtn").click()
        csv_mode_rows = page.evaluate("window.PandaStudyQA.getRows()")
        assert [r["answers"] for r in csv_mode_rows] == [
            {"601": "0001", "602": "Đạt", "603": "Nội dung Excel 1"},
            {"601": "0002", "602": "Chưa đạt", "603": "Nội dung Excel 2"},
            {"601": "0003", "602": "Đạt", "603": "Nội dung Excel 3"}]
        page.locator("#responseCount").fill("4")
        page.locator("#buildPlanBtn").click()
        assert "không thể tạo 4 dòng" in page.locator("#workflowResult").inner_text()
        page.locator("#fillFromUploadedFile").uncheck()
        assert page.locator("#responseCount").input_value() == "2"
        assert page.locator("#rowStrategy").input_value() == "sequential"
        assert page.locator('.mapping-select[data-qid="601"]').is_disabled()
        page.locator("#buildPlanBtn").click()
        assert [r["answers"]["601"] for r in page.evaluate("window.PandaStudyQA.getRows()")] == ["TAY001", "TAY002"]
        assert all("603" not in r["answers"] for r in page.evaluate("window.PandaStudyQA.getRows()"))
        assert page.locator('.text-samples[data-qid="601"]').input_value() == "TAY001\nTAY002"
        # Re-enabling restores file matching without changing the source or manual text.
        page.locator("#fillFromUploadedFile").check()
        page.locator("#buildPlanBtn").click()
        assert page.evaluate("window.PandaStudyQA.getRows()[2].answers['601']") == "0003"

        # Replacing a file must return to opt-in disabled and must not read stale rows.
        second_csv = "Mã hồ sơ,Trạng thái,Ý kiến\n0009,Chưa đạt,Khác\n".encode("utf-8")
        page.locator("#dataFile").set_input_files({
            "name": "bo-phieu-thay-the.csv", "mimeType": "text/csv", "buffer": second_csv
        })
        page.wait_for_function("document.querySelector('#dataSummary').textContent.includes('bo-phieu-thay-the.csv')")
        assert not page.locator("#fillFromUploadedFile").is_checked()
        assert page.locator("#responseCount").input_value() == "2"
        page.locator("#buildPlanBtn").click()
        assert [r["answers"]["601"] for r in page.evaluate("window.PandaStudyQA.getRows()")] == ["TAY001", "TAY002"]
        page.locator("#fillFromUploadedFile").check()
        assert page.locator("#responseCount").input_value() == "1"
        page.locator("#buildPlanBtn").click()
        assert page.evaluate("window.PandaStudyQA.getRows()[0].answers['601']") == "0009"

        # Actual .xlsx end-to-end if SheetJS is available in this Chromium CI.
        # If the CDN is blocked, CSV remains available without that dependency.
        if page.evaluate("typeof XLSX !== 'undefined'"):
            excel_base64 = page.evaluate("""() => {
                const book = XLSX.utils.book_new();
                const sheet = XLSX.utils.aoa_to_sheet([
                  ['Mã hồ sơ', 'Trạng thái', 'Ý kiến'],
                  ['0015', 'Đạt', 'Nhập từ XLSX'],
                  ['0016', 'Chưa đạt', 'Đúng thứ tự']
                ]);
                XLSX.utils.book_append_sheet(book, sheet, 'Dữ liệu');
                return XLSX.write(book, {type:'base64', bookType:'xlsx'});
            }""")
            import base64
            page.locator("#dataFile").set_input_files({
                "name": "phieu-thu-nghiem.xlsx",
                "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "buffer": base64.b64decode(excel_base64)
            })
            page.wait_for_function("document.querySelector('#dataSummary').textContent.includes('phieu-thu-nghiem.xlsx')")
            assert not page.locator("#fillFromUploadedFile").is_checked()
            page.locator("#fillFromUploadedFile").check()
            page.locator("#buildPlanBtn").click()
            assert [r["answers"] for r in page.evaluate("window.PandaStudyQA.getRows()")] == [
                {"601": "0015", "602": "Đạt", "603": "Nhập từ XLSX"},
                {"601": "0016", "602": "Chưa đạt", "603": "Đúng thứ tự"}]
        # Data-type matrix: real XLSX generated by openpyxl, not only in-memory
        # JS workbooks. Exercise different sizes, Unicode, dates, formatted IDs,
        # blank required cells, legacy XLS, malformed replacements, CSV and JSON.
        from io import BytesIO
        from datetime import datetime
        from openpyxl import Workbook
        import base64
        assert page.evaluate("typeof XLSX !== 'undefined' && typeof XLSX.read === 'function'"), (
            "Excel import unavailable because the SheetJS CDN did not load")
        def make_xlsx(size=3, blank_id=False, duplicate=False):
            wb = Workbook()
            ws = wb.active
            ws.title = "Dữ liệu gốc"
            ws.append(["Mã hồ sơ", "Trạng thái", "Ý kiến"])
            for i in range(1, size + 1):
                code = ("00001" if duplicate else f"X{i:05d}")
                if blank_id and i == 2:
                    code = None
                if size == 3 and i == 1:
                    code = 7
                ws.append([code, "Đạt" if i % 2 else "Chưa đạt",
                           "Tiếng Việt 中文 😀\nDòng thứ hai" if i == 1 else f"Ý kiến {i}"])
                if size == 3 and i == 1:
                    ws.cell(i + 1, 1).number_format = "00000"
            second = wb.create_sheet("Sheet phụ")
            second.append(["Mã hồ sơ", "Trạng thái", "Ý kiến"])
            second.append(["SAI-SHEET", "Đạt", "Không được lấy"])
            buf = BytesIO()
            wb.save(buf)
            return buf.getvalue()
        def upload_matrix(name, buffer, mime):
            page.locator("#dataFile").set_input_files({
                "name": name, "mimeType": mime, "buffer": buffer
            })
            page.wait_for_function(
                "name => document.querySelector('#dataSummary').textContent.includes(name)", arg=name)
            assert not page.locator("#fillFromUploadedFile").is_checked()
            page.locator("#fillFromUploadedFile").check()
        xlsx_mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        upload_matrix("matrix-data-3.xlsx", make_xlsx(), xlsx_mime)
        page.locator("#buildPlanBtn").click()
        matrix_answers = [r["answers"] for r in page.evaluate("window.PandaStudyQA.getRows()")]
        assert len(matrix_answers) == 3 and matrix_answers[0]["601"] == "00007", matrix_answers
        assert matrix_answers[0]["603"] == "Tiếng Việt 中文 😀\nDòng thứ hai"
        assert matrix_answers[1]["601"] == "X00002"
        assert not any(x["601"] == "SAI-SHEET" for x in matrix_answers)
        print("PASS XLSX: formatted number, multilingual multiline text and first-sheet alignment")
        for size in (1, 216, 1000):
            upload_matrix(f"matrix-{size}.xlsx", make_xlsx(size), xlsx_mime)
            assert page.locator("#responseCount").input_value() == str(size)
            page.locator("#buildPlanBtn").click()
            exported = page.evaluate("window.PandaStudyQA.getRows()")
            assert len(exported) == size
            assert exported[0]["answers"]["601"] == f"X{1:05d}"
            assert exported[-1]["answers"]["601"] == f"X{size:05d}"
            assert exported[-1]["answers"]["602"] == ("Đạt" if size % 2 else "Chưa đạt")
            print(f"PASS XLSX: {size} rows correctly imported and mapped")
        upload_matrix("required-blank.xlsx", make_xlsx(blank_id=True), xlsx_mime)
        page.locator("#buildPlanBtn").click()
        assert "đang trống" in page.locator("#workflowResult").inner_text()
        print("PASS XLSX: required blank cell never receives invented data")
        upload_matrix("duplicate-key.xlsx", make_xlsx(3, duplicate=True), xlsx_mime)
        page.locator("#buildPlanBtn").click()
        assert len(page.evaluate("window.PandaStudyQA.getRows()")) == 3
        page.locator("#uniqueKeyColumn").select_option("Mã hồ sơ")
        page.locator("#buildPlanBtn").click()
        assert "bị lặp" in page.locator("#workflowResult").inner_text()
        page.locator("#uniqueKeyColumn").select_option("")
        print("PASS XLSX: optional unique-key validation")
        csv_matrix = ("\ufeffMã hồ sơ;Trạng thái;Ý kiến\n"
                      '00008;Đạt;"10,5%; dấu ; trong ô"\n'
                      '00009;Chưa đạt;"Một, hai"\n').encode("utf-8")
        upload_matrix("bom-semicolon.csv", csv_matrix, "text/csv")
        page.locator("#buildPlanBtn").click()
        csv_answers = [r["answers"] for r in page.evaluate("window.PandaStudyQA.getRows()")]
        assert csv_answers[0]["601"] == "00008" and csv_answers[0]["603"] == "10,5%; dấu ; trong ô"
        assert csv_answers[1]["601"] == "00009"
        print("PASS CSV: BOM, Unicode, semicolon, quotes and comma decimals")
        matrix_json = json.dumps([
            {"Mã hồ sơ": "J-1", "Trạng thái": "Đạt", "Ý kiến": "Khảo sát"},
            {"Mã hồ sơ": "J-2", "Trạng thái": "Chưa đạt", "Ý kiến": None}
        ], ensure_ascii=False).encode("utf-8")
        upload_matrix("matrix.json", matrix_json, "application/json")
        page.locator("#buildPlanBtn").click()
        json_answers = [r["answers"] for r in page.evaluate("window.PandaStudyQA.getRows()")]
        assert [r["601"] for r in json_answers] == ["J-1", "J-2"]
        assert "603" not in json_answers[1]
        print("PASS JSON: mixed values and optional null")
        excel_xls = page.evaluate("""() => {
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
              ['Mã hồ sơ','Trạng thái','Ý kiến'], ['L-001','Đạt','XLS cũ']
            ]), 'Dữ liệu');
            return XLSX.write(wb, {type:'base64', bookType:'biff8'});
        }""")
        upload_matrix("matrix-legacy.xls", base64.b64decode(excel_xls), "application/vnd.ms-excel")
        page.locator("#buildPlanBtn").click()
        assert page.evaluate("window.PandaStudyQA.getRows()[0].answers['601']") == "L-001"
        print("PASS XLS: BIFF8 legacy workbook")
        # Invalid replacements must never silently leave a previous active file.
        page.locator("#dataFile").set_input_files({
            "name": "corrupt.xlsx", "mimeType": xlsx_mime, "buffer": b"not a valid workbook"
        })
        page.wait_for_timeout(500)
        error_alert = page.locator('#toastWrap .guide-toast[data-issue-kind="data"]')
        assert error_alert.is_visible(), "Corrupt Excel must raise a detailed data-type alert"
        assert "Tải Excel/CSV/JSON" in error_alert.inner_text()
        assert error_alert.locator('a[href^="mailto:"]').count() == 1
        assert error_alert.locator('a[href="https://zalo.me/0349222590"]').count() == 1
        assert not page.locator("#fillFromUploadedFile").is_checked(), (
            "New corrupt file left the old dataset active; must fail closed")
        page.locator("#buildPlanBtn").click()
        assert [r["answers"]["601"] for r in page.evaluate("window.PandaStudyQA.getRows()")] == [
            "TAY001", "TAY002"]
        print("PASS invalid Excel replacement clears stale data mode")

        # The invalid-file failure path has already cleared the data summary.
        # Do not click the now-hidden Clear Data button.
        assert page.locator("#dataSummary").is_hidden()
        assert page.locator("#fillFromUploadedFile").is_disabled()
        assert not page.locator("#fillFromUploadedFile").is_checked()
        assert "submitOneResponse" not in bridge_operations
        # Full 216-row paste regression (data supplied as Markdown/Sheets clipboard),
        # including both columns, student ID uniqueness and exact row alignment.
        sample_form["questions"] = [
            {"id": "211", "index": 0, "title": "Mã học sinh:", "helpText": "",
             "required": True, "supported": True, "type": "short_text",
             "options": [], "entryIds": ["971"]},
            {"id": "212", "index": 1, "title": "Khối", "helpText": "",
             "required": True, "supported": True, "type": "multiple_choice",
             "options": ["10", "11", "12"], "entryIds": ["972"]}
        ]
        sample_form["supportedCount"] = 2
        click_import_form()
        page.wait_for_function("document.querySelectorAll('#questionList .question-card').length===2")
        grades = json.loads((ROOT / 'tests' / 'fixtures' / 'student-grade-216.json').read_text(encoding='utf-8'))['grades']
        assert len(grades) == 216 and grades[0] == 10 and grades[-1] == 10
        markdown = "| Mã học   sinh | Khối |\n| --- | --- |\n" + "".join(
            "| HS%03d | %d |\n" % (i, grades[i - 1]) for i in range(1, 217))
        page.locator("#pasteDataInput").fill(markdown)
        # Must work even when a user goes straight to 4a without pressing 'Read pasted table'.
        page.locator("#buildPlanBtn").click()
        page.wait_for_function("window.PandaStudyQA.getRows().length === 216")
        assert page.locator("#responseCount").input_value() == "216"
        assert page.locator("#rowStrategy").input_value() == "sequential_no_repeat"
        assert page.locator('.mapping-select[data-qid="211"]').input_value() == "Mã học   sinh"
        assert page.locator('.mapping-select[data-qid="212"]').input_value() == "Khối"
        student_rows = page.evaluate("window.PandaStudyQA.getRows()")
        assert student_rows[0]["answers"] == {"211": "HS001", "212": str(grades[0])}
        assert student_rows[213]["answers"] == {"211": "HS214", "212": "12"}
        assert student_rows[214]["answers"] == {"211": "HS215", "212": "12"}
        assert student_rows[215]["answers"] == {"211": "HS216", "212": "10"}
        assert len({row["answers"]["211"] for row in student_rows}) == 216
        assert [int(row["answers"]["212"]) for row in student_rows] == grades
        # Regression from the user's screenshot: 216 rows, 196 rejected by the
        # Google Form validation. Reasons must be readable, downloadable, and
        # filtered on mobile instead of hidden in desktop-only title tooltips.
        validation_mode["invalid_first_student_rows"] = 196
        page.locator("#validatePlanBtn").click()
        page.wait_for_function(
            "window.PandaStudyQA.getRows().filter(x => x.status === 'invalid').length === 196")
        assert "196 dòng chưa hợp lệ" in page.locator("#workflowResult").inner_text()
        assert "196/216" in page.locator("#validationDiagnostics").inner_text()
        assert "Nhóm: Không tìm thấy lựa chọn ĐC-Z" in page.locator("#validationDiagnostics").inner_text()
        assert "196 dòng:" in page.locator("#validationDiagnostics").inner_text()
        assert page.locator("#downloadPlanBtn").is_disabled()
        assert page.locator("#downloadValidationErrorsBtn").is_enabled()
        assert page.locator(".validation-row-error").count() > 0
        page.locator("#planStatusFilter").select_option("valid")
        assert "20 dòng" in page.locator("#planPageLabel").inner_text()
        assert page.locator(".validation-row-error").count() == 0
        page.locator("#planStatusFilter").select_option("invalid")
        assert "196 dòng" in page.locator("#planPageLabel").inner_text()
        assert page.locator(".validation-row-error").count() > 0
        with page.expect_download(timeout=20000) as saved_errors:
            page.locator("#downloadValidationErrorsBtn").click()
        with open(saved_errors.value.path(), encoding="utf-8-sig", newline="") as f:
            invalid_csv = list(csv.reader(f))
        assert len(invalid_csv) == 197
        assert invalid_csv[1][invalid_csv[0].index("Dòng kế hoạch")] == "1"
        assert invalid_csv[-1][invalid_csv[0].index("Dòng kế hoạch")] == "196"
        assert "Nhóm" in invalid_csv[1][invalid_csv[0].index("Câu hỏi / lỗi")]
        validation_mode["invalid_first_student_rows"] = 0
        page.locator("#validatePlanBtn").click()
        page.wait_for_function("window.PandaStudyQA.getRows().every(x => x.status === 'valid')")
        assert page.locator("#validationDiagnostics").is_hidden()
        assert page.locator("#downloadValidationErrorsBtn").is_disabled()
        page.locator("#planStatusFilter").select_option("all")
        with page.expect_download(timeout=20000) as saved:
            page.locator("#downloadPlanBtn").click()
        with open(saved.value.path(), encoding="utf-8-sig", newline="") as f:
            csv_out = list(csv.reader(f))
        assert len(csv_out) == 217, len(csv_out)
        assert "Mã học sinh:" in csv_out[0] and "Khối" in csv_out[0]
        assert csv_out[1][csv_out[0].index("Mã học sinh:")] == "HS001"
        assert csv_out[216][csv_out[0].index("Mã học sinh:")] == "HS216"
        assert csv_out[216][csv_out[0].index("Khối")] == "10"

        # No ID should be silently reused if requested count exceeds the dataset.
        page.locator("#responseCount").fill("217")
        page.locator("#buildPlanBtn").click()
        assert "không thể tạo 217 dòng" in page.locator("#workflowResult").inner_text()

        # TSV from Sheets and direct pasted table inside a question must also work.
        page.locator("#pasteDataInput").fill("Mã học sinh\tKhối\nHS001\t10\nHS002\t12")
        page.locator("#buildPlanBtn").click()
        assert [row["answers"] for row in page.evaluate("window.PandaStudyQA.getRows()")] == [
            {"211": "HS001", "212": "10"}, {"211": "HS002", "212": "12"}]
        page.locator("#clearDataBtn").click()
        page.locator('.text-samples[data-qid="211"]').fill(markdown)
        page.locator("#buildPlanBtn").click()
        assert len(page.evaluate("window.PandaStudyQA.getRows()")) == 216
        assert page.evaluate("window.PandaStudyQA.getRows()[215].answers['211']") == "HS216"
        assert "Tự nhận diện bảng dán" in page.locator("#pasteDataStatus").inner_text()

        # Generic use case: invoice identifiers + locale semicolon-CSV.
        page.locator("#clearDataBtn").click()
        sample_form["questions"] = [
            {"id": "311", "index": 0, "title": "Mã đơn hàng", "helpText": "",
             "required": True, "supported": True, "type": "short_text",
             "options": [], "entryIds": ["991"]},
            {"id": "312", "index": 1, "title": "Giá trị", "helpText": "",
             "required": True, "supported": True, "type": "short_text",
             "options": [], "entryIds": ["992"]}
        ]
        sample_form["supportedCount"] = 2
        click_import_form()
        page.locator("#pasteDataInput").fill("Mã đơn hàng;Giá trị\n0001;10,5\n0002;20,0")
        page.locator("#buildPlanBtn").click()
        assert page.locator("#pasteDataStatus").inner_text().find("semicolon") != -1
        assert page.locator('.mapping-select[data-qid="311"]').input_value() == "Mã đơn hàng"
        assert page.locator('.mapping-select[data-qid="312"]').input_value() == "Giá trị"
        assert [r["answers"] for r in page.evaluate("window.PandaStudyQA.getRows()")] == [
            {"311": "0001", "312": "10,5"}, {"311": "0002", "312": "20,0"}]
        # Blank mapped fields must fail, not be filled with synthetic answers.
        page.locator("#pasteDataInput").fill("Mã đơn hàng;Giá trị\n0001;10,5\n0002;")
        page.locator("#buildPlanBtn").click()
        assert "cột “Giá trị” đang trống" in page.locator("#workflowResult").inner_text()
        page.locator("#uniqueKeyColumn").select_option("Mã đơn hàng")
        page.locator("#pasteDataInput").fill("Mã đơn hàng;Giá trị\n0001;10,5\n0001;20,0")
        page.locator("#buildPlanBtn").click()
        assert "bị lặp" in page.locator("#workflowResult").inner_text()

        # Generic headerless single column: no specific student-name rule.
        page.locator("#clearDataBtn").click()
        sample_form["questions"] = [
            {"id": "411", "index": 0, "title": "Mã phiếu", "helpText": "",
             "required": True, "supported": True, "type": "short_text",
             "options": [], "entryIds": ["993"]}
        ]
        sample_form["supportedCount"] = 1
        click_import_form()
        page.locator("#pasteFormat").select_option("lines")
        page.locator("#pasteHeaderMode").select_option("none")
        page.locator("#pasteDataInput").fill("0001\n0002\n0003")
        page.locator("#loadPastedDataBtn").click()
        assert page.locator("#pasteDataStatus").inner_text().find("không có tiêu đề") != -1
        assert page.locator("#responseCount").input_value() == "3"
        page.locator('.mapping-select[data-qid="411"]').select_option("Cột 1")
        page.locator("#buildPlanBtn").click()
        assert [r["answers"]["411"] for r in page.evaluate("window.PandaStudyQA.getRows()")] == [
            "0001", "0002", "0003"]
        assert page.locator("#rowStrategy").input_value() == "sequential_no_repeat"

        # Strict mapping: an ambiguous short title cannot silently select either ID column.
        page.locator("#clearDataBtn").click()
        sample_form["questions"] = [
            {"id": "511", "index": 0, "title": "Mã", "helpText": "",
             "required": True, "supported": True, "type": "short_text",
             "options": [], "entryIds": ["994"]}
        ]
        sample_form["supportedCount"] = 1
        click_import_form()
        page.locator("#pasteFormat").select_option("auto")
        page.locator("#pasteHeaderMode").select_option("first")
        page.locator("#pasteDataInput").fill("Mã đơn hàng\tMã khách hàng\nA1\tB1")
        page.locator("#buildPlanBtn").click()
        assert page.locator('.mapping-select[data-qid="511"]').input_value() == ""
        assert "Câu bắt buộc" in page.locator("#workflowResult").inner_text()

        # Partly required Likert grid: preserve blank optional rows rather than
        # invent a random answer, but block missing required rows.
        page.locator("#clearDataBtn").click()
        sample_form["questions"] = [{
            "id": "801", "index": 0, "title": "Khảo sát lưới", "helpText": "",
            "required": True, "requiredRows": [True, False],
            "supported": True, "type": "grid",
            "rows": ["A", "B"], "columns": ["Có", "Không"],
            "options": ["Có", "Không"], "entryIds": ["1001", "1002"]
        }]
        sample_form["supportedCount"] = 1
        click_import_form()
        page.locator("#pasteDataInput").fill("Khảo sát lưới / A\tKhảo sát lưới / B\nCó\t\nKhông\tCó")
        page.locator("#buildPlanBtn").click()
        assert [r["answers"]["801"] for r in page.evaluate("window.PandaStudyQA.getRows()")] == [
            ["Có", ""], ["Không", "Có"]]
        page.locator("#pasteDataInput").fill("Khảo sát lưới / A\tKhảo sát lưới / B\n\tCó")
        page.locator("#buildPlanBtn").click()
        assert "hàng “A”" in page.locator("#workflowResult").inner_text()
        assert "submitOneResponse" not in bridge_operations
        page.locator("#clearDataBtn").click()
        sample_form["questions"] = sample_questions
        sample_form["supportedCount"] = 2
        click_import_form()
        page.wait_for_function("document.querySelectorAll('#questionList .question-card').length===2")
        for count in (50, 100):
            page.locator("#responseCount").fill(str(count))
            page.locator("#buildPlanBtn").click()
            assert page.locator("#planTableBody tr").count() == count
            assert page.locator("#downloadPlanBtn").is_disabled()
            assert "Chưa kiểm tra" in page.locator("#workflowResult").inner_text()
            page.locator("#validatePlanBtn").click()
            page.locator("#planTableBody tr .status-chip.success").first.wait_for(timeout=10000)
            assert page.locator("#planTableBody tr .status-chip.success").count() == count
            assert "chưa gửi" in page.locator("#workflowResult").inner_text().lower()
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
        click_import_form()
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
