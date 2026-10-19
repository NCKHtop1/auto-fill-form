#!/usr/bin/env python3
"""Payment UI UAT with mocked APIs. No bank, Google Form, or email writes.

Run with the same Python Playwright environment as tests/qa_browser.py.
Screenshots are written to qa-artifacts/ for local review and CI upload.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import parse_qs, urlparse
import json

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS = ROOT / "qa-artifacts"
BANK = {"bankName": "PandaStudy UAT Bank", "bankId": "000000", "accountNumber": "00000000000000", "accountName": "PANDASTUDY UAT MERCHANT"}
USER = {"id": "uat-user", "email": "user@example.test", "isAdmin": False}
ADMIN = {"id": "uat-admin", "email": "admin@example.test", "isAdmin": True}
PACKAGES = [
    {"id": "starter", "name": "Bắt đầu", "credits": 20, "priceVnd": 10000, "listPriceVnd": 10000, "discountPercent": 0, "popular": False},
    {"id": "popular", "name": "Phổ biến", "credits": 100, "priceVnd": 45000, "listPriceVnd": 50000, "discountPercent": 10, "popular": True},
    {"id": "research", "name": "Nghiên cứu", "credits": 250, "priceVnd": 110000, "listPriceVnd": 125000, "discountPercent": 12, "popular": False},
    {"id": "pro", "name": "Chuyên sâu", "credits": 500, "priceVnd": 200000, "listPriceVnd": 250000, "discountPercent": 20, "popular": False},
]
UAT_QR_PATH = "/assets/uat-payment-qr.svg"
UAT_QR_SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="320" height="360" viewBox="0 0 320 360">
<rect width="320" height="360" rx="18" fill="#f2f7ef"/>
<rect x="46" y="34" width="228" height="224" rx="16" fill="white" stroke="#61865f" stroke-width="3" stroke-dasharray="10 7"/>
<text x="160" y="139" text-anchor="middle" font-family="sans-serif" font-size="32" font-weight="700" fill="#246d3c">QR UAT</text>
<text x="160" y="175" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#617166">Ảnh giả lập kiểm thử</text>
<text x="160" y="298" text-anchor="middle" font-family="sans-serif" font-size="21" font-weight="700" fill="#962b25">Không chuyển tiền</text>
<text x="160" y="328" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#617166">Không chứa dữ liệu thanh toán</text>
</svg>"""
FORM_URL = "https://docs.google.com/forms/d/UATKEEPTST123/edit"
FORM = {
    "id": "UATKEEPTST123", "title": "Form UAT giữ dữ liệu", "description": "Local mock only",
    "accessMode": "public", "collectsEmail": None, "responseCount": None,
    "acceptingResponses": True, "supportedCount": 1, "unsupportedCount": 0,
    "questions": [{"id": "1", "index": 0, "title": "Lựa chọn", "helpText": "", "required": True,
                   "supported": True, "options": ["Có", "Không"], "type": "multiple_choice", "entryIds": ["400"]}],
}


def make_order(identifier="order-1", status="pending_payment"):
    return {
        "id": identifier, "orderCode": "PD-UAT-" + identifier,
        "quantity": 20, "unitPriceVnd": 500, "amountVnd": 10000,
        "status": status, "paymentMemo": "PANDA UAT " + identifier,
        "bank": BANK, "qrImageUrl": UAT_QR_PATH, "qrHasAmountAndMemo": False,
        "createdAt": "2026-10-18T02:00:00Z", "customer": USER,
        "notifications": {"sent": 2},
    }


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def main():
    ARTIFACTS.mkdir(exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(ROOT / "native")))
    Thread(target=server.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:" + str(server.server_address[1])
    state = {
        "profile": {"ok": True, "billingEnabled": False, "configured": False, "purchasesEnabled": False,
                    "signedIn": True, "user": USER, "availableCredits": 0, "reservedCredits": 0,
                    "unitPriceVnd": 500, "minTopupCredits": 1, "maxTopupCredits": 100000,
                    "topupPackages": PACKAGES, "bank": None},
        "orders": [], "operations": [], "users": [], "calls": [], "fail_create_once": False,
        "commerce": {"packages": [dict(item, badge=("Phổ biến nhất" if item["id"] == "popular" else ""),
                                         featured=item["popular"], enabled=True, sortOrder=(idx + 1) * 10)
                                  for idx, item in enumerate(PACKAGES)],
                     "promotions": [{"id": "promo-uat-1", "code": "WELCOME_UAT", "name": "10 phiếu trải nghiệm",
                                     "description": "Ưu đãi QA", "credits": 10,
                                     "startsAt": "2026-10-19T16:40:00.000Z", "endsAt": "2026-10-27T17:00:00.000Z",
                                     "enabled": True, "grantedCount": 2}]},
        "can_send": False, "delay_submit": False, "pending_submit": None,
    }
    errors = []

    def mock(route):
        request = route.request
        parsed = urlparse(request.url)
        if f"{parsed.scheme}://{parsed.netloc}" != base:
            route.abort()
            return
        if parsed.path == UAT_QR_PATH:
            route.fulfill(status=200, content_type="image/svg+xml", body=UAT_QR_SVG)
            return
        if not parsed.path.startswith("/api/"):
            route.continue_()
            return
        query = {key: value[0] for key, value in parse_qs(parsed.query).items()}
        data = request.post_data_json if request.method == "POST" else None
        state["calls"].append({"path": parsed.path, "query": query, "data": data})
        response, status = {"ok": True}, 200
        if parsed.path == "/api/billing":
            action = data.get("action") if data else query.get("action")
            if action == "profile":
                response = state["profile"]
            elif action == "orders":
                response = {"ok": True, "orders": state["orders"]}
            elif action == "status":
                response = {"ok": True, "order": next(item for item in state["orders"] if item["id"] == query["orderId"])}
            elif action == "create":
                assert state["profile"]["purchasesEnabled"] is True
                if state["fail_create_once"]:
                    state["fail_create_once"] = False
                    status, response = 503, {"ok": False, "error": "Thử lại yêu cầu hiện tại."}
                else:
                    order = next((item for item in state["orders"] if item.get("key") == data["idempotencyKey"]), None)
                    if not order:
                        order = make_order("order-" + str(len(state["orders"]) + 1))
                        package = next((item for item in PACKAGES if item["id"] == data.get("packageId")), None)
                        if package:
                            order.update(quantity=package["credits"], amountVnd=package["priceVnd"],
                                         listPriceVnd=package["listPriceVnd"], discountPercent=package["discountPercent"],
                                         package=package, key=data["idempotencyKey"])
                        else:
                            order.update(quantity=data["quantity"], amountVnd=data["quantity"] * 500,
                                         listPriceVnd=data["quantity"] * 500, discountPercent=0,
                                         package=None, key=data["idempotencyKey"])
                        state["orders"].insert(0, order)
                    response = {"ok": True, "order": order}
            elif action == "submitPaid":
                order = next(item for item in state["orders"] if item["id"] == data["orderId"])
                order["status"] = "pending_review"
                response = {"ok": True, "order": order}
        elif parsed.path == "/api/admin-topups":
            if not (state["profile"].get("user") or {}).get("isAdmin"):
                status, response = 403, {"ok": False, "error": "Không có quyền."}
            elif not data:
                if query.get("resource") == "users":
                    search = query.get("search", "").lower()
                    users = [item for item in state["users"]
                             if not search or search in item["email"].lower() or search in item["id"].lower()]
                    response = {"ok": True, "users": users}
                elif query.get("resource") == "commerce":
                    response = {"ok": True, "commerce": state["commerce"]}
                elif query.get("resource") == "metrics":
                    response = {"ok": True, "metrics": {
                        "timezone": "Asia/Ho_Chi_Minh",
                        "currentMonth": {"revenueVnd": 55000, "approvedOrders": 2, "creditsSold": 120, "buyers": 2},
                        "pending": {"reviewAmountVnd": 110000, "reviewOrders": 1, "paymentOrders": 1},
                        "allTime": {"revenueVnd": 255000, "approvedOrders": 5, "creditsSold": 620, "buyers": 3},
                        "monthly": [{"month": "2026-09", "revenueVnd": 200000, "approvedOrders": 3, "creditsSold": 500, "buyers": 2},
                                    {"month": "2026-10", "revenueVnd": 55000, "approvedOrders": 2, "creditsSold": 120, "buyers": 2}],
                        "packages": [{"id": "popular", "name": "Phổ biến", "revenueVnd": 45000, "approvedOrders": 1, "creditsSold": 100},
                                     {"id": "starter", "name": "Bắt đầu", "revenueVnd": 10000, "approvedOrders": 1, "creditsSold": 20}]
                    }}
                else:
                    orders = [item for item in state["orders"] if
                              (item["id"] == query["orderId"] if "orderId" in query else
                               query.get("status") == "all" or item["status"] == query.get("status"))]
                    response = {"ok": True, "orders": orders, "pendingOperations": state["operations"]}
            elif data["action"] == "approve":
                assert data["confirmedBankTransfer"] is True
                order = next(item for item in state["orders"] if item["id"] == data["orderId"])
                if data.get("receivedAmountVnd") is not None:
                    assert data["receivedAmountVnd"] == order["amountVnd"]
                assert order["status"] == "pending_review"
                if data.get("bankReference"):
                    order["bankReference"] = data["bankReference"]
                else:
                    order["manualBankConfirmation"] = True
                order.update(status="approved", adminNote=data["note"])
                # Match the mutation API, whose returned order need not include customer metadata.
                response = {"ok": True, "order": {key: value for key, value in order.items() if key != "customer"}}
            elif data["action"] == "reject":
                order = next(item for item in state["orders"] if item["id"] == data["orderId"])
                order.update(status="rejected", adminNote=data["note"])
                response = {"ok": True, "order": {key: value for key, value in order.items() if key != "customer"}}
            elif data["action"] == "resolveOperation":
                assert data["confirmedReview"] is True
                assert len(data["evidence"].strip()) >= 20
                state["operations"] = [item for item in state["operations"] if item["id"] != data["operationId"]]
            elif data["action"] == "savePackage":
                package = next(item for item in state["commerce"]["packages"] if item["id"] == data["id"])
                package.update(name=data["name"], badge=data["badge"], credits=data["credits"],
                               priceVnd=data["priceVnd"], listPriceVnd=data["listPriceVnd"],
                               featured=data["featured"], popular=data["featured"],
                               enabled=data["enabled"], sortOrder=data["sortOrder"])
                response = {"ok": True, "package": package}
            elif data["action"] == "savePromotion":
                if data.get("id"):
                    promotion = next(item for item in state["commerce"]["promotions"] if item["id"] == data["id"])
                    promotion.update(code=data["code"], name=data["name"], description=data["description"],
                                     credits=data["credits"], startsAt=data["startsAt"], endsAt=data["endsAt"],
                                     enabled=data["enabled"])
                else:
                    promotion = {"id": "promo-new", "grantedCount": 0, **{key: value for key, value in data.items()
                                                                        if key not in ("action",)}}
                    state["commerce"]["promotions"].insert(0, promotion)
                response = {"ok": True, "promotion": promotion}
        elif parsed.path == "/api/auth/status":
            response = {"configured": True, "signedIn": True, "email": "shell@example.test", "submissionEnabled": False}
        elif parsed.path == "/api/qa-status":
            response = {"ok": True, "configured": state["can_send"], "signedIn": state["can_send"],
                        "canSend": state["can_send"], "formAllowed": state["can_send"], "reasons": []}
        elif parsed.path == "/api/qa-verify":
            response = {"ok": True, "count": 100, "source": "google-sheet-public-csv", "note": "Mock read only"}
        elif parsed.path == "/api/bridge":
            if data["name"] == "getBillingProfile":
                response = {"configured": True, "billingEnabled": False, "availableCredits": 1000000}
            elif data["name"] == "importOwnedForm":
                response = FORM
            elif data["name"] == "validatePlan":
                batch = data["args"][1]
                response = {"valid": True, "invalid": 0, "total": len(batch),
                            "results": [{"index": index + 1, "valid": True, "issues": []} for index in range(len(batch))]}
            else:
                response = []
        elif parsed.path == "/api/qa-submit":
            if state["delay_submit"]:
                state["pending_submit"] = route
                return
            raise AssertionError("Payment UI must never send a Google Form automatically")
        route.fulfill(status=status, content_type="application/json", body=json.dumps(response, ensure_ascii=False))

    def action_calls(action):
        return [call for call in state["calls"] if (call.get("data") or {}).get("action") == action]

    try:
        with sync_playwright() as engine:
            browser = engine.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1280, "height": 960})
            context.route("**/*", mock)
            context.on("page", lambda page: page.on("pageerror", lambda error: errors.append(str(error))))
            page = context.new_page()
            page.goto(base + "/index.html#app")
            page.wait_for_function("window.PandaBilling?.getProfile()")
            assert page.locator("#pandaBillingRoot").is_visible()
            assert USER["email"] in page.locator("#pandaBillingRoot").inner_text()
            assert "Tài khoản PandaStudy" in page.locator("#pandaBillingRoot").inner_text()
            assert page.get_by_role("button", name="Nạp phiếu", exact=True).count() == 0
            assert page.locator("#qaRunStep").count() == 1
            print("PASS disabled: authenticated account shell is visible; six-step workspace preserved")

            state["profile"].update(billingEnabled=True, configured=False)
            page.evaluate("window.PandaBilling.refresh()")
            page.evaluate("window.PandaBilling.openPurchase()")
            assert page.locator(".pb-modal img").count() == 0
            assert page.get_by_role("button", name="Tạo yêu cầu mua phiếu", exact=True).count() == 0
            page.get_by_role("button", name="Đóng mua phiếu", exact=True).click()
            print("PASS unconfigured: account remains visible; no QR, bank instructions or create action")

            state["profile"].update(configured=True, purchasesEnabled=True, bank=BANK, availableCredits=3)
            page.evaluate("window.PandaBilling.refresh()")
            assert page.get_by_role("button", name="Nạp phiếu", exact=True).count() == 1
            assert page.get_by_role("button", name="Lịch sử nạp", exact=True).count() == 1
            assert page.get_by_role("button", name="Đăng xuất", exact=True).count() == 1
            print("PASS account: balance, top-up, history and logout actions are available after sign-in")

            page.evaluate("window.PandaBilling.refresh()")
            page.locator("#dataFile").set_input_files({"name": "preserve-payment-uat.json", "mimeType": "application/json",
                                                       "buffer": json.dumps([{"LuaChon": "Có"}, {"LuaChon": "Không"}]).encode()})
            page.locator("#dataSummary").wait_for(state="visible")
            page.locator("#formUrl").fill(FORM_URL)
            page.locator("#importFormBtn").click()
            page.locator("#questionList .mapping-select").wait_for()
            page.locator("#questionList .mapping-select").select_option("LuaChon")
            page.locator("#responseCount").fill("7")
            page.locator("#buildPlanBtn").click()
            page.locator("#validatePlanBtn").click()
            page.wait_for_function("window.PandaStudyQA.getRows().length === 7 && window.PandaStudyQA.getRows().every(row => row.status === 'valid')")
            plan_before = page.evaluate("window.PandaStudyQA.getRows()")
            page.set_viewport_size({"width": 320, "height": 800})
            page.get_by_role("button", name="Nạp phiếu", exact=True).click()
            page.locator(".pb-package-card").first.wait_for(state="visible")
            assert page.locator(".pb-package-card").count() == 4
            assert page.locator('[data-package-id="popular"]').get_attribute("aria-pressed") == "true"
            assert "45.000" in page.locator(".pb-total").inner_text()
            assert "tiết kiệm 5.000" in page.locator(".pb-package-summary").inner_text().lower()
            page.locator("#pbQuantity").fill("1")
            assert page.locator("#pbQuantity").evaluate("element => element.checkValidity()")
            assert "500" in page.locator(".pb-total").inner_text()
            page.locator('[data-package-id="popular"]').click()
            assert "45.000" in page.locator(".pb-total").inner_text()
            state["fail_create_once"] = True
            page.locator(".pb-modal form .pb-button-primary").click()
            page.get_by_text("Thử lại yêu cầu hiện tại.", exact=True).wait_for()
            page.locator(".pb-modal form .pb-button-primary").click()
            page.get_by_role("button", name="Tôi đã chuyển khoản", exact=True).wait_for()
            assert page.get_by_role("button", name="Tôi đã chuyển khoản", exact=True).is_enabled()
            assert page.locator(".pb-modal").evaluate("element => element.contains(document.activeElement)")
            creates = action_calls("create")
            assert creates[-1]["data"]["idempotencyKey"] == creates[-2]["data"]["idempotencyKey"]
            assert len(state["orders"]) == 1
            assert page.locator(".pb-modal img").count() == 1
            assert page.locator(".pb-modal img").get_attribute("src") == base + UAT_QR_PATH
            assert "QR chưa có sẵn số tiền và nội dung chuyển khoản" in page.locator(".pb-modal").inner_text()
            state["orders"][0]["qrImageUrl"] = "https://example.invalid/uat-payment-qr.svg"
            page.evaluate("window.PandaBilling.openPurchase({showOrders: true})")
            page.locator("#pbOrderHistory button").first.click()
            assert page.locator(".pb-modal img").count() == 0
            state["orders"][0]["qrImageUrl"] = UAT_QR_PATH
            page.evaluate("window.PandaBilling.openPurchase({showOrders: true})")
            page.locator("#pbOrderHistory button").first.click()
            assert page.locator(".pb-modal img").get_attribute("src") == base + UAT_QR_PATH
            page.wait_for_function("document.querySelector('.pb-modal img').complete && document.querySelector('.pb-modal img').naturalWidth > 0")
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            assert page.locator(".pb-modal").evaluate("element => element.scrollWidth <= element.clientWidth")
            page.screenshot(path=str(ARTIFACTS / "billing-mobile.png"))
            page.set_viewport_size({"width": 1280, "height": 1050})
            page.locator(".pb-qr").scroll_into_view_if_needed()
            page.screenshot(path=str(ARTIFACTS / "billing-desktop-qr.png"))
            print("PASS create: quantity, price, stable retry key, mock static QR, same-origin URL enforcement, 320px layout")

            state["profile"].update(purchasesEnabled=False)
            page.evaluate("window.PandaBilling.refresh()")
            assert page.locator(".pb-modal img").count() == 0
            assert page.get_by_role("button", name="Tạo yêu cầu mua phiếu", exact=True).count() == 0
            assert BANK["accountNumber"] not in page.locator(".pb-modal").inner_text()
            assert page.get_by_role("button", name="Tôi đã chuyển khoản", exact=True).is_enabled()
            assert "3 phiếu khả dụng" in page.locator("#pandaBillingRoot").inner_text()
            page.get_by_role("button", name="Quay lại danh sách", exact=True).click()
            assert page.get_by_role("button", name="Tạo yêu cầu mua phiếu", exact=True).count() == 0
            page.locator("#pbOrderHistory button").first.click()
            page.get_by_role("button", name="Tôi đã chuyển khoản", exact=True).click()
            page.get_by_text("Đã nhận thông báo bạn chuyển khoản.", exact=False).wait_for()
            assert state["profile"]["availableCredits"] == 3
            assert not any(call["path"] == "/api/qa-submit" for call in state["calls"])
            print("PASS pause: no new payment instructions; existing balance/history and paid report preserved")

            state["orders"][0]["status"] = "approved"
            state["profile"].update(availableCredits=103, purchasesEnabled=True)
            page.get_by_role("button", name="Kiểm tra trạng thái", exact=True).click()
            page.get_by_text("Đã cộng 100 phiếu vào tài khoản.", exact=False).wait_for()
            assert "103 phiếu" in page.locator("#pandaBillingRoot").inner_text()
            page.keyboard.press("Escape")
            assert page.locator("#formUrl").input_value() == FORM_URL
            assert page.locator("#responseCount").input_value() == "7"
            assert page.locator("#dataFile").evaluate("element => element.files[0].name") == "preserve-payment-uat.json"
            assert page.locator("#questionList .mapping-select").input_value() == "LuaChon"
            assert page.evaluate("window.PandaStudyQA.getRows()") == plan_before
            assert not any(call["path"] == "/api/qa-submit" for call in state["calls"])
            state["profile"]["availableCredits"] = 22
            page.evaluate("window.dispatchEvent(new Event('pandastudy:billing-refresh'))")
            page.wait_for_function("document.getElementById('pandaBillingRoot').textContent.includes('22 phiếu')")
            print("PASS approval: file, mapping and validated plan preserved; window balance event; no automatic Form send")

            admin = context.new_page()
            admin.goto(base + "/admin-topups.html")
            admin.get_by_text("Tài khoản này không có quyền duyệt nạp.", exact=True).wait_for()
            assert not admin.locator("#paWorkspace").is_visible()
            assert not any(call["path"] == "/api/admin-topups" for call in state["calls"])
            print("PASS nonadmin: no administration data requested or actions shown")

            state["profile"]["user"] = ADMIN
            state["orders"] = [make_order("admin-one", "pending_review"), make_order("admin-two", "pending_review"), make_order("admin-unpaid")]
            state["users"] = [
                {"id": "uat-user", "email": USER["email"], "role": "user", "availableCredits": 22,
                 "reservedCredits": 1, "createdAt": "2026-10-17T01:00:00Z", "lastActivityAt": "2026-10-19T03:00:00Z",
                 "totalOrders": 3, "pendingOrders": 2, "approvedOrders": 1, "purchasedCredits": 20,
                 "paidAmountVnd": 10000, "totalOperations": 4, "consumedOperations": 3, "unknownOperations": 1},
                {"id": "uat-admin", "email": ADMIN["email"], "role": "admin", "availableCredits": 0,
                 "reservedCredits": 0, "createdAt": "2026-10-16T01:00:00Z", "lastActivityAt": "2026-10-19T04:00:00Z",
                 "totalOrders": 0, "pendingOrders": 0, "approvedOrders": 0, "purchasedCredits": 0,
                 "paidAmountVnd": 0, "totalOperations": 0, "consumedOperations": 0, "unknownOperations": 0},
            ]
            state["operations"] = [
                {"id": "op-db-1", "operationId": "row-op-1", "customer": USER, "credits": 1,
                 "status": "unknown", "formId": "UAT-FORM", "createdAt": "2026-10-18T02:00:00Z", "canResolve": True},
                {"id": "op-db-2", "operationId": "row-op-2", "customer": USER, "credits": 1,
                 "status": "dispatching", "createdAt": "2026-10-18T03:00:00Z", "canResolve": False},
            ]
            admin.goto(base + "/admin-topups.html?orderId=admin-one")
            admin.get_by_text(USER["email"], exact=True).first.wait_for()
            assert "55.000" in admin.locator("#paRevenueSummary").inner_text()
            assert "255.000" in admin.locator("#paRevenueSummary").inner_text()
            assert "10/2026" in admin.locator("#paRevenueMonthly").inner_text()
            assert "Phổ biến" in admin.locator("#paRevenuePackages").inner_text()
            admin.get_by_text("10 phiếu trải nghiệm", exact=True).wait_for()
            assert admin.locator("#paPackages .pb-commerce-card").count() == 4
            assert "Đã cấp cho 2 tài khoản" in admin.locator("#paPromotions").inner_text()
            popular_form = admin.locator("#paPackages .pb-commerce-card").filter(has_text="Phổ biến").first
            popular_form.get_by_label("Tên gói").fill("Phổ biến Plus")
            popular_form.get_by_label("Số phiếu").fill("120")
            popular_form.get_by_label("Giá bán (đồng)").fill("47000")
            popular_form.get_by_label("Giá niêm yết (đồng)").fill("60000")
            popular_form.get_by_role("button", name="Lưu gói", exact=True).click()
            popular_form.get_by_text("Đã lưu cấu hình gói.", exact=True).wait_for()
            assert any(call["data"] and call["data"].get("action") == "savePackage" for call in state["calls"])
            print("PASS admin commerce: packages and timed promotions are visible and editable only in admin workspace")
            assert "22" in admin.locator("#paUsers").inner_text()
            assert "Admin" in admin.locator("#paUsers").inner_text()
            admin.locator("#paUserSearch").fill("user@example.test")
            admin.get_by_role("button", name="Tìm", exact=True).click()
            admin.get_by_text("Kết quả tìm kiếm: 1 tài khoản", exact=False).wait_for()
            assert USER["email"] in admin.locator("#paUsers").inner_text()
            assert ADMIN["email"] not in admin.locator("#paUsers").inner_text()
            admin.get_by_role("button", name="Xóa lọc", exact=True).click()
            admin.get_by_text("Danh sách gần nhất: 2 tài khoản", exact=False).wait_for()
            print("PASS admin accounts: persistent Google users, balances, roles and search visible only to admin")
            admin.get_by_role("button", name="Kiểm tra và duyệt", exact=True).click()
            assert admin.locator("#paReceivedAmount").get_attribute("required") is None
            assert admin.locator("#paBankReference").get_attribute("required") is None
            assert admin.locator("#paConfirmedBank").get_attribute("required") is not None
            admin.get_by_role("button", name="Xác nhận duyệt và cộng 20 phiếu", exact=True).click()
            assert not action_calls("approve")
            admin.locator("#paConfirmedBank").check()
            admin.get_by_role("button", name="Xác nhận duyệt và cộng 20 phiếu", exact=True).click()
            admin.get_by_text("Đã duyệt và cộng 20 phiếu.", exact=True).wait_for()
            assert len(action_calls("approve")) == 1
            assert action_calls("approve")[0]["data"]["receivedAmountVnd"] is None
            assert action_calls("approve")[0]["data"]["bankReference"] == ""
            assert USER["email"] in admin.locator("#paDetail").inner_text()
            admin.screenshot(path=str(ARTIFACTS / "billing-admin-desktop.png"), full_page=True)
            print("PASS admin approval: exact amount, reference and explicit confirmation; customer preserved")

            admin.locator("#paOrders button").first.click()
            admin.get_by_role("button", name="Từ chối đơn", exact=True).click()
            admin.locator("#paRejectNote").fill("Chưa đối chiếu được khoản tiền vào của đơn này.")
            admin.get_by_role("button", name="Xác nhận từ chối", exact=True).click()
            admin.get_by_text("Đã từ chối đơn và lưu lý do.", exact=True).wait_for()
            assert state["orders"][1]["status"] == "rejected"
            print("PASS reject: reason saved and reflected in current order")

            resolves = admin.get_by_role("button", name="Đối chiếu và xử lý", exact=True)
            assert not resolves.nth(1).is_enabled()
            resolves.first.click()
            admin.locator(".pb-admin-operation select").select_option("release")
            admin.locator("#paEvidence-op-db-1").fill("Đã đối chiếu Form và Sheet theo thời điểm gửi, xác nhận không có phản hồi.")
            admin.locator("#paResolve-op-db-1").check()
            admin.get_by_role("button", name="Xác nhận kết quả đối chiếu", exact=True).click()
            admin.get_by_text("Đã xác nhận không gửi thành công và trả phiếu đang giữ.", exact=True).wait_for()
            assert len(state["operations"]) == 1
            admin.get_by_role("button", name="Thử gửi lại email lỗi", exact=True).click()
            admin.get_by_text("Đã yêu cầu xử lý lại thông báo", exact=False).wait_for()
            admin.set_viewport_size({"width": 320, "height": 850})
            assert admin.evaluate("document.documentElement.scrollWidth <= innerWidth")
            admin.screenshot(path=str(ARTIFACTS / "billing-admin-mobile.png"), full_page=True)
            print("PASS operation review, email retry, administration at 320px")

            admin.locator("#paFilter").select_option("pending_payment")
            admin.locator("#paOrders button").first.click()
            assert admin.get_by_role("button", name="Kiểm tra và duyệt", exact=True).count() == 0
            assert "Người dùng chưa báo đã chuyển khoản" in admin.locator("#paDetail").inner_text()
            assert not any(call["path"] == "/api/qa-submit" for call in state["calls"])

            # A deliberately delayed, mocked submission exercises the real run code.
            # Mutating both URL and plan by script simulates an import that finishes
            # after a run starts; inert UI alone cannot protect against that race.
            state.update(can_send=True, delay_submit=True)
            state["profile"]["user"] = USER
            run_page = context.new_page()
            run_page.goto(base + "/index.html#app")
            run_page.locator("#dataFile").set_input_files({"name": "run-race.json", "mimeType": "application/json",
                                                           "buffer": json.dumps([{"LuaChon": "Có"}, {"LuaChon": "Không"}]).encode()})
            run_page.locator("#dataSummary").wait_for(state="visible")
            run_page.locator("#formUrl").fill(FORM_URL)
            run_page.locator("#importFormBtn").click()
            run_page.locator("#questionList .mapping-select").wait_for()
            run_page.locator("#questionList .mapping-select").select_option("LuaChon")
            run_page.locator("#responseCount").fill("3")
            run_page.locator("#buildPlanBtn").click()
            run_page.locator("#validatePlanBtn").click()
            run_page.wait_for_function("window.PandaStudyQA.getRows().length === 3 && window.PandaStudyQA.getRows().every(row => row.status === 'valid')")
            original_rows = run_page.evaluate("window.PandaStudyQA.getRows()")
            run_page.evaluate("""() => {
                const bridge = window.PandaStudyQA;
                const original = bridge.updateRow;
                window.__uatRowUpdates = 0;
                bridge.updateRow = (...args) => { window.__uatRowUpdates++; return original(...args); };
            }""")
            run_page.locator("#qaConsent").check()
            run_page.wait_for_function("document.getElementById('qaRunStartAll').disabled === false")
            run_page.locator("#qaRunStartAll").click()
            run_page.wait_for_function("document.getElementById('qaRunMessage').textContent.includes('Đang gửi dòng 1/')")
            run_page.evaluate("() => true")  # Drain request callbacks before examining the delayed route.
            assert state["pending_submit"] is not None
            editing = ["fileStep", "formSetupStep", "mappingStep", "planStep", "previewSection"]
            assert run_page.evaluate("ids => ids.every(id => document.getElementById(id)?.inert === true)", editing)
            run_page.evaluate("""() => {
                const before = window.PandaStudyQA.getPlanToken();
                const input = document.getElementById('formUrl');
                input.value = 'https://docs.google.com/forms/d/NEWUATCONTEXT123/edit';
                input.dispatchEvent(new Event('input', {bubbles: true}));
                document.getElementById('responseCount').value = '1';
                document.getElementById('buildPlanBtn').click();
                window.__uatReplacedPlan = before !== window.PandaStudyQA.getPlanToken();
            }""")
            assert run_page.evaluate("window.__uatReplacedPlan")
            assert len(run_page.evaluate("window.PandaStudyQA.getRows()")) == 1
            submit_calls = [call for call in state["calls"] if call["path"] == "/api/qa-submit"]
            assert len(submit_calls) == 1
            assert submit_calls[0]["data"]["formUrl"] == FORM_URL
            assert submit_calls[0]["data"]["answers"] == original_rows[0]["answers"]
            state["pending_submit"].fulfill(status=200, content_type="application/json", body=json.dumps({
                "ok": True, "status": "page-confirmed", "delivery": "confirmed",
                "operationId": submit_calls[0]["data"]["operationId"],
                "receivedAt": "2026-10-18T03:00:00Z", "note": "Delayed local mock; no Google request.",
            }))
            run_page.wait_for_function("document.getElementById('qaRunMessage').textContent.includes('dữ liệu trước:')")
            assert run_page.evaluate("ids => ids.every(id => document.getElementById(id)?.inert === false)", editing)
            assert run_page.evaluate("window.__uatRowUpdates") == 0
            assert run_page.evaluate("window.PandaStudyQA.getRows()[0].status") == "ready"
            assert len([call for call in state["calls"] if call["path"] == "/api/qa-submit"]) == 1
            assert "Đã nhận: 1" in run_page.locator("#qaRunCounters").inner_text()
            assert run_page.locator("#qaRunExport").is_enabled()
            assert run_page.locator("#qaRunStartAll").is_disabled()
            run_page.screenshot(path=str(ARTIFACTS / "billing-run-context-race.png"), full_page=True)
            print("PASS in-flight context race: only captured Form receives one mocked request; new plan untouched; editing restored")
            assert not errors, errors
            browser.close()
            print("ALL PAYMENT UI UAT PASS. All external requests and APIs mocked; no real writes.")
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
