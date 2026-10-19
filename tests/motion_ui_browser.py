#!/usr/bin/env python3
"""PandaStudy premium motion UI browser UAT.

Read-only local test. All account/API traffic is mocked; no Google, bank, email or
production mutations are performed.
"""
from __future__ import annotations
import functools
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent / "native"

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
BASE = "http://127.0.0.1:" + str(server.server_address[1])

def mock_page(page):
    page.route("**/api/auth/status", lambda r: r.fulfill(
        status=200, content_type="application/json",
        body=json.dumps({
            "configured": True, "signedIn": True, "email": "motion-qa@example.test",
            "isAdmin": False, "submissionEnabled": False, "billingEnabled": True
        })
    ))
    page.route("**/api/billing?action=profile", lambda r: r.fulfill(
        status=200, content_type="application/json",
        body=json.dumps({
            "ok": True, "billingEnabled": True, "configured": True, "purchasesEnabled": True,
            "signedIn": True,
            "user": {"id": "motion-user", "email": "motion-qa@example.test", "isAdmin": False},
            "availableCredits": 25, "reservedCredits": 0, "unitPriceVnd": 500,
            "minTopupCredits": 1, "maxTopupCredits": 100000,
            "topupPackages": [
                {"id": "starter", "name": "Bắt đầu", "badge": "", "credits": 20,
                 "priceVnd": 10000, "listPriceVnd": 10000, "discountPercent": 0,
                 "popular": False, "featured": False},
                {"id": "popular", "name": "Phổ biến", "badge": "Phổ biến nhất", "credits": 100,
                 "priceVnd": 45000, "listPriceVnd": 50000, "discountPercent": 10,
                 "popular": True, "featured": True}
            ],
            "activePromotions": [], "promotionGrants": [], "bank": None, "warnings": []
        })
    ))
    page.route("**/api/qa-status**", lambda r: r.fulfill(
        status=200, content_type="application/json",
        body=json.dumps({"ok": True, "canSend": False, "configured": True, "signedIn": True,
                         "formAllowed": False, "accessMode": "public", "reasons": []})
    ))
    page.route("https://cdn.jsdelivr.net/**", lambda r: r.abort())

def overflow(page):
    return page.evaluate("""() => ({
      viewport: innerWidth,
      width: document.documentElement.scrollWidth,
      delta: document.documentElement.scrollWidth - innerWidth
    })""")

try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)

        # Desktop full-motion path.
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        mock_page(page)
        page.goto(BASE + "/#home", wait_until="domcontentloaded")
        page.wait_for_function("document.body.dataset.authenticated === 'true'")
        page.wait_for_function("document.documentElement.classList.contains('motion-ready')")

        assert page.locator('link[href^="/motion-ui.css"]').count() == 1
        assert page.locator('script[src^="/motion-ui.js"]').count() == 1
        assert page.locator(".hero-motion-chip").count() == 3
        assert page.locator(".motion-orbit").count() == 1
        assert page.locator(".hero-flow").count() == 1

        animation = page.locator(".hero-art img").evaluate("el => getComputedStyle(el).animationName")
        assert "psHeroFloat" in animation, animation

        before = page.locator(".hero-art").evaluate(
            "el => [getComputedStyle(el).getPropertyValue('--parallax-x').trim(),"
            "getComputedStyle(el).getPropertyValue('--parallax-y').trim()]"
        )
        box = page.locator(".hero-art").bounding_box()
        assert box
        page.mouse.move(box["x"] + box["width"] * .88, box["y"] + box["height"] * .2)
        page.wait_for_timeout(80)
        after = page.locator(".hero-art").evaluate(
            "el => [getComputedStyle(el).getPropertyValue('--parallax-x').trim(),"
            "getComputedStyle(el).getPropertyValue('--parallax-y').trim()]"
        )
        assert before != after and after != ["0px", "0px"], (before, after)

        workspace = page.locator("#app")
        assert workspace.evaluate("el => el.classList.contains('motion-reveal')")
        workspace.scroll_into_view_if_needed()
        page.wait_for_function("document.getElementById('app').classList.contains('is-visible')")

        cta = page.get_by_role("link", name="Bắt đầu ngay ↗")
        assert cta.get_attribute("href") == "#app"
        cta.click()
        page.wait_for_function("location.hash === '#app'")
        assert page.locator("#app").is_visible()

        assert overflow(page)["delta"] <= 1, overflow(page)
        assert not errors, errors
        print("PASS motion desktop: hero float, pointer parallax, reveal and CTA preserved", flush=True)
        context.close()

        # Responsive guardrails.
        for width, height in [(768, 900), (390, 844), (320, 800)]:
            ctx = browser.new_context(viewport={"width": width, "height": height})
            p = ctx.new_page()
            mock_page(p)
            p.goto(BASE + "/#home", wait_until="domcontentloaded")
            p.wait_for_function("document.body.dataset.authenticated === 'true'")
            p.wait_for_function("document.documentElement.classList.contains('motion-ready')")
            geom = overflow(p)
            assert geom["delta"] <= 1, (width, geom)
            assert p.locator(".hero-art").is_visible()
            assert p.locator(".hero-motion-chip--map").is_hidden() if width <= 650 else True
            print(f"PASS motion responsive: {width}px has no horizontal overflow", flush=True)
            ctx.close()

        # Accessibility/reduced-motion path.
        reduced = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
        rp = reduced.new_page()
        reduced_errors = []
        rp.on("pageerror", lambda e: reduced_errors.append(str(e)))
        mock_page(rp)
        rp.goto(BASE + "/#home", wait_until="domcontentloaded")
        rp.wait_for_function("document.body.dataset.authenticated === 'true'")
        rp.wait_for_function("document.documentElement.classList.contains('motion-ready')")

        reduced_animation = rp.locator(".hero-art img").evaluate("el => getComputedStyle(el).animationName")
        assert reduced_animation == "none", reduced_animation
        hidden_reveals = rp.locator(".motion-reveal").evaluate_all(
            "els => els.filter(el => { const s=getComputedStyle(el); return s.opacity==='0' || s.transform!=='none'; }).length"
        )
        assert hidden_reveals == 0, hidden_reveals

        rbox = rp.locator(".hero-art").bounding_box()
        assert rbox
        rp.mouse.move(rbox["x"] + rbox["width"] * .9, rbox["y"] + rbox["height"] * .1)
        rp.wait_for_timeout(80)
        reduced_vars = rp.locator(".hero-art").evaluate(
            "el => [getComputedStyle(el).getPropertyValue('--parallax-x').trim(),"
            "getComputedStyle(el).getPropertyValue('--parallax-y').trim()]"
        )
        assert reduced_vars == ["0px", "0px"], reduced_vars
        assert not reduced_errors, reduced_errors
        print("PASS motion accessibility: reduced-motion is static and fully visible", flush=True)
        reduced.close()

        browser.close()
finally:
    server.shutdown()
