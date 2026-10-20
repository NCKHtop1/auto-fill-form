#!/usr/bin/env python3
"""PandaStudy Cinematic Hero V3 browser UAT.

Local-only browser test. Account/API traffic is mocked. It never sends Google
Form responses, creates a real payment, sends email, or mutates production.
"""
from __future__ import annotations
import functools
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent / "native"
OUT = Path(__file__).resolve().parent.parent / "qa-artifacts"
OUT.mkdir(parents=True, exist_ok=True)
HERO = ROOT / "assets" / "hero-cinematic-v3.webp"

assert (ROOT / "motion-ui.js").stat().st_size < 12_000, "motion-ui.js exceeds 12 KB guardrail"
assert (ROOT / "motion-ui.css").stat().st_size < 24_000, "motion-ui.css exceeds 24 KB guardrail"
assert HERO.is_file(), HERO
assert HERO.stat().st_size < 60_000, "cinematic hero exceeds 60 KB guardrail"

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
      width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      delta: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth
    })""")

try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)

        # Desktop cinematic-motion path.
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        mock_page(page)
        page.goto(BASE + "/#home", wait_until="domcontentloaded")
        page.wait_for_function("document.body.dataset.authenticated === 'true'")
        page.wait_for_function("document.documentElement.classList.contains('motion-ready')")

        assert page.locator('meta[name="pandastudy-ui-revision"]').get_attribute("content") == "2026-10-20-seamless-v4"
        assert page.locator('link[href="/motion-ui.css?v=20261020d"]').count() == 1
        assert page.locator('script[src="/motion-ui.js?v=20261020d"]').count() == 1
        assert page.locator(".hero-cinematic").count() == 1
        assert page.locator(".hero-aura").count() == 2
        assert page.locator(".hero-scan").count() == 1
        assert page.locator(".hero-depth-grid").count() == 1
        assert page.locator(".hero-live-chip").count() == 1
        assert page.locator(".hero-proof span").count() == 3

        image = page.locator(".hero-art img")
        image.wait_for(state="visible")
        assert image.get_attribute("src") == "/assets/hero-cinematic-v3.webp"
        assert image.get_attribute("width") == "600"
        assert image.get_attribute("height") == "338"
        page.wait_for_function("document.querySelector('.hero-art img').complete && document.querySelector('.hero-art img').naturalWidth > 0")
        dimensions = image.evaluate("el => [el.naturalWidth, el.naturalHeight]")
        assert dimensions == [600, 338], dimensions
        average_luma = image.evaluate("""el => {
          const c=document.createElement('canvas'); c.width=30; c.height=17;
          const x=c.getContext('2d'); x.drawImage(el,0,0,c.width,c.height);
          const d=x.getImageData(0,0,c.width,c.height).data;
          let sum=0; for(let i=0;i<d.length;i+=4) sum += (d[i]+d[i+1]+d[i+2])/3;
          return sum/(d.length/4);
        }""")
        assert average_luma > 35, ("hero appears blank/dark", average_luma)

        animation = image.evaluate("el => getComputedStyle(el).animationName")
        assert "psCinematicBreath" in animation, animation
        hero_background = page.locator(".hero-cinematic").evaluate("el => getComputedStyle(el).backgroundImage")
        assert "gradient" in hero_background, hero_background
        frame_style = page.locator(".hero-art").evaluate("""el => {
          const s=getComputedStyle(el);
          return {border:s.borderTopWidth,radius:s.borderRadius,overflow:s.overflow,shadow:s.boxShadow};
        }""")
        assert frame_style["border"] == "0px", frame_style
        assert frame_style["radius"] == "0px", frame_style
        assert frame_style["overflow"] == "visible", frame_style
        assert frame_style["shadow"] == "none", frame_style
        image_mask = image.evaluate("el => getComputedStyle(el).webkitMaskImage || getComputedStyle(el).maskImage")
        assert "radial-gradient" in image_mask, image_mask
        assert page.locator(".hero-nowrap-desktop").evaluate("el => getComputedStyle(el).whiteSpace") == "nowrap"

        before = page.locator(".hero-art").evaluate(
            "el => [getComputedStyle(el).getPropertyValue('--parallax-x').trim(),"
            "getComputedStyle(el).getPropertyValue('--parallax-y').trim()]"
        )
        box = page.locator(".hero-art").bounding_box()
        assert box
        page.mouse.move(box["x"] + box["width"] * .88, box["y"] + box["height"] * .2)
        page.wait_for_timeout(90)
        after = page.locator(".hero-art").evaluate(
            "el => [getComputedStyle(el).getPropertyValue('--parallax-x').trim(),"
            "getComputedStyle(el).getPropertyValue('--parallax-y').trim()]"
        )
        assert before != after and after != ["0px", "0px"], (before, after)

        # Original CTA semantics and navigation must remain intact.
        primary = page.get_by_role("link", name="Bắt đầu ngay ↗")
        secondary = page.get_by_role("link", name="Xem cách dùng")
        assert primary.get_attribute("href") == "#app"
        assert secondary.get_attribute("href") == "#how"
        primary.click()
        page.wait_for_function("location.hash === '#app'")
        assert page.locator("#app").is_visible()

        workspace = page.locator("#app")
        assert workspace.evaluate("el => el.classList.contains('motion-reveal')")
        workspace.scroll_into_view_if_needed()
        page.wait_for_function("document.getElementById('app').classList.contains('is-visible')")
        assert overflow(page)["delta"] <= 1, overflow(page)
        page.evaluate("location.hash='#home'")
        page.wait_for_function("document.body.dataset.pandaPage === 'home'")
        page.screenshot(path=str(OUT / "cinematic_v3_desktop_1440.png"), full_page=False)
        assert not errors, errors
        print("PASS cinematic desktop: V3 asset, motion, parallax, reveal and CTAs preserved", flush=True)
        context.close()

        # Responsive guardrails: no horizontal overflow and image stays readable.
        for width, height in [(1024, 860), (768, 900), (390, 844), (320, 800)]:
            ctx = browser.new_context(viewport={"width": width, "height": height})
            p = ctx.new_page()
            mock_page(p)
            p.goto(BASE + "/#home", wait_until="domcontentloaded")
            p.wait_for_function("document.body.dataset.authenticated === 'true'")
            p.wait_for_function("document.documentElement.classList.contains('motion-ready')")
            p.wait_for_function("document.querySelector('.hero-art img').complete && document.querySelector('.hero-art img').naturalWidth > 0")
            geom = overflow(p)
            assert geom["delta"] <= 1, (width, geom)
            assert p.locator(".hero-art").is_visible()
            assert p.locator(".hero-copy").is_visible()
            art_box = p.locator(".hero-art").bounding_box()
            assert art_box and art_box["width"] <= width + 1, (width, art_box)
            if width <= 650:
                columns = p.locator(".hero-inner").evaluate("el => getComputedStyle(el).gridTemplateColumns")
                assert " " not in columns.strip(), (width, columns)
            if width in (390, 320):
                p.screenshot(path=str(OUT / f"cinematic_v3_mobile_{width}.png"), full_page=False)
            print(f"PASS cinematic responsive: {width}px has no horizontal overflow", flush=True)
            ctx.close()

        # Accessibility / reduced-motion path.
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
        rp.wait_for_timeout(90)
        reduced_vars = rp.locator(".hero-art").evaluate(
            "el => [getComputedStyle(el).getPropertyValue('--parallax-x').trim(),"
            "getComputedStyle(el).getPropertyValue('--parallax-y').trim()]"
        )
        assert reduced_vars == ["0px", "0px"], reduced_vars
        assert rp.get_by_role("link", name="Bắt đầu ngay ↗").is_visible()
        rp.screenshot(path=str(OUT / "cinematic_v3_reduced_1440.png"), full_page=False)
        assert not reduced_errors, reduced_errors
        print("PASS cinematic accessibility: reduced-motion is static and fully usable", flush=True)
        reduced.close()
        browser.close()
finally:
    server.shutdown()
