#!/usr/bin/env python3
"""Browser UAT for the mandatory PandaStudy Google sign-in wall.

All APIs are mocked. No Google login, Google Form write, payment or email occurs.
"""
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def main():
    server = ThreadingHTTPServer(
        ("127.0.0.1", 0),
        partial(Handler, directory=str(ROOT / "native")),
    )
    Thread(target=server.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:" + str(server.server_address[1])
    state = {"signed_in": False, "is_admin": False}

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 390, "height": 844})
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))

            def mock(route):
                path = route.request.url.split(base, 1)[-1]
                if path.startswith("/api/auth/status"):
                    body = {
                        "configured": True,
                        "signedIn": state["signed_in"],
                        "email": "member@example.test" if state["signed_in"] else "",
                        "isAdmin": bool(state["signed_in"] and state["is_admin"]),
                        "submissionEnabled": False,
                    }
                    return route.fulfill(
                        status=200,
                        content_type="application/json",
                        body=json.dumps(body),
                    )
                if path.startswith("/api/admin-topups"):
                    return route.fulfill(
                        status=200,
                        content_type="application/json",
                        body=json.dumps({
                            "ok": True,
                            "orders": [
                                {"id": "pending-1", "status": "pending_review"},
                                {"id": "pending-2", "status": "pending_review"},
                            ],
                            "pendingOperations": [],
                        }),
                    )
                if path.startswith("/api/billing"):
                    body = {
                        "ok": True,
                        "billingEnabled": True,
                        "configured": True,
                        "purchasesEnabled": True,
                        "signedIn": state["signed_in"],
                        "user": (
                            {
                                "id": "uat-member",
                                "email": "member@example.test",
                                "isAdmin": True,
                            }
                            if state["signed_in"]
                            else None
                        ),
                        "availableCredits": 12,
                        "reservedCredits": 0,
                        "unitPriceVnd": 500,
                        "minTopupCredits": 1,
                        "maxTopupCredits": 100000,
                        "bank": None,
                        "warnings": ["email_notifications"],
                    }
                    return route.fulfill(
                        status=200,
                        content_type="application/json",
                        body=json.dumps(body),
                    )
                if path.startswith("/api/qa-status"):
                    return route.fulfill(
                        status=200,
                        content_type="application/json",
                        body=json.dumps(
                            {
                                "ok": True,
                                "configured": True,
                                "signedIn": state["signed_in"],
                                "canSend": False,
                                "formAllowed": False,
                                "reasons": [],
                            }
                        ),
                    )
                if path.startswith("/api/auth/logout"):
                    state["signed_in"] = False
                    return route.fulfill(
                        status=200,
                        content_type="application/json",
                        body='{"ok":true}',
                    )
                if path.startswith("/api/"):
                    return route.fulfill(
                        status=200,
                        content_type="application/json",
                        body='{"ok":true}',
                    )
                route.continue_()

            page.route(base + "/**", mock)
            page.goto(base + "/index.html#app", wait_until="domcontentloaded")

            gate = page.locator("#psAuthGate")
            gate.wait_for(state="visible")
            assert page.locator('link[href="/auth-gate.css?v=20261019a"]').count() == 1
            assert page.locator('script[src="/auth-gate.js?v=20261019a"]').count() == 1
            assert page.locator(".topbar").is_hidden()
            assert page.locator("#app").is_hidden()
            assert page.get_by_role("link", name="Đăng nhập với Google →").get_attribute("href") == "/api/auth/start"
            assert page.evaluate("document.body.dataset.authenticated") == "false"
            assert "\\n" not in gate.inner_text(), gate.inner_text()
            print("PASS auth wall: signed-out visitor cannot see the main PandaStudy shell and renders no escaped newline text")

            state["signed_in"] = True
            page.evaluate("window.PandaAuthGate.refresh()")
            page.wait_for_function("document.body.dataset.authenticated === 'true'")
            assert gate.is_hidden()
            assert page.locator(".topbar").is_visible()
            assert page.locator("#app").is_visible()
            page.wait_for_timeout(100)
            assert page.locator("#blogWriteBtn").is_hidden()
            page.evaluate("location.hash='#blog-viet-bai'")
            page.wait_for_timeout(100)
            assert page.locator("#blogEditor").is_hidden()
            assert "Chỉ quản trị viên PandaStudy" in page.locator("#blogLoadStatus").inner_text()
            print("PASS blog role: signed-in non-admin cannot see or route into the article editor")

            state["is_admin"] = True
            page.goto(base + "/#blog", wait_until="domcontentloaded")
            page.wait_for_function("document.body.dataset.authenticated === 'true'")
            page.locator("#blog").wait_for(state="visible")
            page.wait_for_function("!document.getElementById('blogWriteBtn').hidden")
            assert page.locator("#blogWriteBtn").is_visible()
            page.locator("#blogWriteBtn").click()
            page.locator("#blogEditor").wait_for(state="visible")
            print("PASS blog role: authenticated PandaStudy admin can open the article editor")
            page.wait_for_function(
                "document.getElementById('pandaBillingRoot').textContent.includes('12 phiếu')"
            )
            account = page.locator("#pandaBillingRoot")
            assert "member@example.test" in account.inner_text()
            assert page.get_by_role("button", name="Nạp phiếu", exact=True).count() == 1
            admin = page.get_by_role("link", name="Quản trị nạp · 2 chờ duyệt", exact=True)
            assert admin.get_attribute("href") == "/admin-topups.html"
            assert page.get_by_role("button", name="Đăng xuất", exact=True).count() == 1
            print("PASS authenticated shell: account, balance, top-up, admin and logout are exposed after sign-in")

            page.set_viewport_size({"width": 320, "height": 760})
            assert page.evaluate(
                "Math.max(document.documentElement.scrollWidth,document.body.scrollWidth) <= innerWidth + 4"
            )
            assert not errors, errors
            browser.close()
            print("ALL AUTH GATE UAT PASS. No external requests or writes.")
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
