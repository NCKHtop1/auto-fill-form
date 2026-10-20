#!/usr/bin/env python3
"""Read-only post-merge smoke test for the PandaStudy production domain.

This test never signs in with a real Google account, never posts a Google Form,
never creates a billing order and never approves a payment. Personal endpoints
used by the browser UI are mocked. Public production wiring is checked read-only.
"""
import json
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener, urlopen

from playwright.sync_api import sync_playwright
from motion_ui_browser import assert_hero_quality, hero_asset_inventory, assert_tonal_continuity

BASE = "https://www.pandastudy.info.vn"
APEX = "https://pandastudy.info.vn"
EXPECTED = "2026-10-21-panda-clean-v9"
OUT = Path("qa-artifacts")
OUT.mkdir(parents=True, exist_ok=True)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def no_redirect(url, timeout=15):
    opener = build_opener(NoRedirect)
    request = Request(
        url,
        headers={
            "User-Agent": "PandaStudy-readonly-postdeploy-smoke",
            "Cache-Control": "no-cache",
        },
    )
    try:
        response = opener.open(request, timeout=timeout)
        return response.status, response.headers, response.read()
    except HTTPError as error:
        return error.code, error.headers, error.read()


def wait_until_deployed():
    last = "not requested"
    for attempt in range(36):
        try:
            request = Request(
                BASE + "/index.html?qa_revision=" + EXPECTED + "&poll=" + str(attempt),
                headers={
                    "User-Agent": "PandaStudy-readonly-postdeploy-smoke",
                    "Cache-Control": "no-cache",
                },
            )
            with urlopen(request, timeout=12) as response:
                html = response.read(240000).decode("utf-8", "replace")
                status = response.status
            marker = 'name="pandastudy-ui-revision" content="' + EXPECTED + '"'
            if status == 200 and marker in html:
                print(
                    "PRODUCTION_READY revision=" + EXPECTED
                    + " attempt=" + str(attempt + 1),
                    flush=True,
                )
                return
            last = "status=" + str(status) + " marker=" + str(marker in html)
        except Exception as exc:
            last = type(exc).__name__ + ": " + str(exc)[:120]
        print("WAIT_PRODUCTION attempt=" + str(attempt + 1) + " " + last, flush=True)
        time.sleep(6)
    raise AssertionError("Production deployment marker not served: " + last)


wait_until_deployed()

# Presentation assets for the release must be served from the canonical domain.
for asset_path, expected_type, marker in [
    ("/motion-ui.css?v=20261021b", "text/css", b"hero-scene"),
    ("/motion-ui.js?v=20261020f", "javascript", b"motion-ready"),
]:
    status, headers, body = no_redirect(BASE + asset_path)
    assert status == 200, (asset_path, status)
    assert expected_type in (headers.get("content-type", "").lower()), (asset_path, headers.get("content-type"))
    assert marker in body, (asset_path, "release marker missing")
# Every responsive WebP candidate is fetched, decoded and checked against its
# own quality/transfer budget in the browser section below. Do not keep checking
# an obsolete 600px asset after the page has moved to a sharper srcset.
print("POST_DEPLOY_PASS cinematic V5 CSS/JS release assets served", flush=True)

# Canonical hostname.
status, headers, _ = no_redirect(APEX + "/")
assert status in (301, 308), ("Unexpected apex redirect", status)
assert headers.get("location", "").startswith(BASE), headers.get("location")
print("POST_DEPLOY_PASS apex redirects to canonical www", flush=True)

# OAuth start must use the custom-domain callback and request identity-only
# scopes. Sensitive Google Forms scopes must not be part of ordinary sign-in.
status, headers, _ = no_redirect(BASE + "/api/auth/start")
assert status in (302, 303, 307, 308), ("OAuth start did not redirect", status)
location = headers.get("location", "")
parsed = urlparse(location)
assert parsed.hostname == "accounts.google.com", location
params = parse_qs(parsed.query)
assert params.get("redirect_uri") == [BASE + "/api/auth/callback"], params.get("redirect_uri")
scopes = set((params.get("scope") or [""])[0].split())
assert scopes == {"openid", "email", "profile"}, scopes
assert params.get("state") and params.get("client_id"), "OAuth state/client missing"
print("POST_DEPLOY_PASS OAuth callback and identity-only scopes", flush=True)

# Read-only billing infrastructure readiness. No secrets or rows are exposed.
request = Request(
    BASE + "/api/billing?action=health",
    headers={
        "User-Agent": "PandaStudy-readonly-postdeploy-smoke",
        "Cache-Control": "no-cache",
    },
)
with urlopen(request, timeout=15) as response:
    health = json.loads(response.read().decode("utf-8"))
assert health.get("ok") is True, health
assert health.get("financialConfigReady") is True, health
assert health.get("databaseReachable") is True, health
assert health.get("schemaReady") is True, health
assert health.get("schemaVersion") == 1, health
print("POST_DEPLOY_PASS billing database schema and financial config ready", flush=True)

# Read-only billing readiness. Never create an order here.
request = Request(
    BASE + "/api/billing?action=profile",
    headers={
        "User-Agent": "PandaStudy-readonly-postdeploy-smoke",
        "Cache-Control": "no-cache",
    },
)
with urlopen(request, timeout=15) as response:
    profile = json.loads(response.read().decode("utf-8"))
assert profile.get("ok") is True, profile
assert profile.get("unitPriceVnd") == 500, profile
assert profile.get("signedIn") is False, profile
assert isinstance(profile.get("billingEnabled"), bool), profile
assert isinstance(profile.get("purchasesEnabled"), bool), profile
catalog = {item.get("id"): item for item in profile.get("topupPackages", [])}
assert catalog.get("starter", {}).get("priceVnd") == 10000, catalog
assert catalog.get("popular", {}).get("credits") == 100 and catalog["popular"].get("priceVnd") == 45000 and catalog["popular"].get("discountPercent") == 10, catalog
assert catalog.get("research", {}).get("credits") == 250 and catalog["research"].get("priceVnd") == 110000, catalog
assert catalog.get("pro", {}).get("credits") == 500 and catalog["pro"].get("priceVnd") == 200000 and catalog["pro"].get("discountPercent") == 20, catalog
if profile.get("billingEnabled"):
    assert profile.get("configured") is True, profile

# Merchant QR is order-specific and authenticated. A naked request must
# never reveal payment instructions, even while purchases are live.
qr_status, _, _ = no_redirect(BASE + "/api/payment-qr")
assert qr_status == 404, ("Unauthenticated QR endpoint exposed", qr_status)
print("POST_DEPLOY_PASS billing readiness and authenticated QR boundary", flush=True)

# Administration must not leak data to an unauthenticated request.
admin_status, _, _ = no_redirect(BASE + "/api/admin-topups")
assert admin_status in (401, 403), ("Admin API exposed without session", admin_status)
print("POST_DEPLOY_PASS unauthenticated admin API denied", flush=True)

# Signed-out visitors must see only the login wall.
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    signed_out = browser.new_context(viewport={"width": 390, "height": 844})
    gate_page = signed_out.new_page()
    gate_page.route("https://cdn.jsdelivr.net/**", lambda route: route.abort())
    gate_page.goto(BASE + "/index.html#app", wait_until="domcontentloaded", timeout=30000)
    gate_page.locator("#psAuthGate").wait_for(state="visible", timeout=12000)
    assert gate_page.locator(".topbar").is_hidden()
    assert gate_page.locator("#app").is_hidden()
    assert gate_page.get_by_role("link", name="Đăng nhập với Google →").get_attribute("href") == "/api/auth/start"
    signed_out.close()
    print("POST_DEPLOY_PASS signed-out visitor is blocked by login wall", flush=True)

    # Existing six-step behavior stays intact; real DPRs verify delivered pixels.
    # Account traffic stays mocked, so these checks cannot spend live credits.
    hero_inventory = None
    for width, dpr in [(320, 2), (360, 3), (390, 3), (768, 2), (1024, 2), (1440, 2)]:
        context = browser.new_context(viewport={"width": width, "height": 860},
                                      device_scale_factor=dpr, is_mobile=width <= 650,
                                      has_touch=width <= 650)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.route(
            "**/api/auth/status",
            lambda route: route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps(
                    {
                        "configured": True,
                        "signedIn": True,
                        "email": "qa@example.test",
                        "submissionEnabled": False,
                    }
                ),
            ),
        )
        page.route(
            "**/api/qa-status**",
            lambda route: route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps(
                    {
                        "ok": True,
                        "configured": True,
                        "signedIn": True,
                        "canSend": False,
                        "formAllowed": False,
                        "reasons": ["Hãy nhập Google Form ở Bước 2."],
                    }
                ),
            ),
        )
        page.route(
            "**/api/billing?action=profile",
            lambda route: route.fulfill(
                status=200, content_type="application/json",
                body=json.dumps({**profile, "signedIn": True,
                    "user": {"id": "production-ui-fixture", "email": "qa@example.test", "isAdmin": False},
                    "availableCredits": 10, "reservedCredits": 0}),
            ),
        )
        page.route("https://cdn.jsdelivr.net/**", lambda route: route.abort())
        page.goto(
            BASE + "/index.html?qa_revision=" + EXPECTED + "#home",
            wait_until="domcontentloaded",
            timeout=30000,
        )
        page.locator("#qaRunStep").wait_for(state="attached", timeout=12000)
        page.wait_for_function("document.body.dataset.authenticated === 'true'", timeout=12000)
        assert (
            page.locator('meta[name="pandastudy-ui-revision"]').get_attribute("content")
            == EXPECTED
        )
        assert page.locator('script[src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"]').count() == 1
        assert page.locator('script[src*="xlsx@0.18.5"]').count() == 0
        assert page.locator(".steps-strip a").count() == 6
        assert page.locator(".hero-cinematic").count() == 1
        assert page.locator(".hero-panda-float").count() == 0
        assert page.locator(".hero-panda-erase").count() == 0
        hero_image = page.locator(".hero-scene")
        page.wait_for_function(
            "document.querySelector('.hero-scene').complete && document.querySelector('.hero-scene').naturalWidth > 0",
            timeout=12000,
        )
        if hero_inventory is None:
            hero_inventory = hero_asset_inventory(page)
            print("POST_DEPLOY_PASS every responsive WebP candidate decoded within its quality budget", flush=True)
        quality = assert_hero_quality(page, hero_inventory, pointer_extremes=width >= 1024)
        (OUT / f"production-hero-quality-{width}-dpr{dpr}.json").write_text(
            json.dumps(quality, indent=2), encoding="utf-8")
        assert hero_image.evaluate("el => getComputedStyle(el).animationName") == "none"
        live_luma = hero_image.evaluate("""el => {
          const c=document.createElement('canvas'); c.width=30; c.height=17;
          const x=c.getContext('2d'); x.drawImage(el,0,0,c.width,c.height);
          const d=x.getImageData(0,0,c.width,c.height).data;
          let sum=0; for(let i=0;i<d.length;i+=4) sum += (d[i]+d[i+1]+d[i+2])/3;
          return sum/(d.length/4);
        }""")
        assert live_luma > 35, ("Production hero appears blank/dark", live_luma)
        assert page.locator("#formUrl").get_attribute("aria-label") == "Đường dẫn Google Form"
        assert page.locator("#qaRunCounters").is_hidden()
        assert page.locator("#qaRunMessage").is_hidden()
        assert page.locator("#billingHint").is_hidden()
        assert page.locator("#planMessage").is_hidden()
        for tab in ["home", "app", "blog", "faq"]:
            page.evaluate("(tab) => location.hash = tab", tab)
            page.wait_for_function(
                "(tab) => document.body.dataset.pandaPage === tab",
                arg=tab,
                timeout=9000,
            )
            assert page.locator("#" + tab).is_visible(), tab
            overflow = page.evaluate(
                "() => Math.max(document.documentElement.scrollWidth,"
                "document.body.scrollWidth) - innerWidth"
            )
            assert overflow <= 4, (
                "Production " + tab + " overflow " + str(overflow)
                + "px at " + str(width)
            )
        page.evaluate("() => location.hash = 'home'")
        page.wait_for_function(
            "() => document.body.dataset.pandaPage === 'home'",
            timeout=8000,
        )
        if width in (320, 390, 1440):
            page.screenshot(
                path=str(OUT / ("production-cinematic-" + str(width) + ".png")),
                full_page=False,
            )
        assert not errors, "Uncaught JS errors: " + repr(errors)
        print(
            "POST_DEPLOY_PASS viewport=" + str(width) + " DPR=" + str(dpr)
            + " hero sharp/no overlap; core flow/navigation unchanged",
            flush=True,
        )
        context.close()

    # Live reduced-motion rendering must remain static and usable.
    reduced = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
    reduced_page = reduced.new_page()
    reduced_errors = []
    reduced_page.on("pageerror", lambda error: reduced_errors.append(str(error)))
    reduced_page.route(
        "**/api/auth/status",
        lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({
                "configured": True, "signedIn": True, "email": "qa@example.test",
                "isAdmin": False, "submissionEnabled": False,
            }),
        ),
    )
    reduced_page.route(
        "**/api/qa-status**",
        lambda route: route.fulfill(
            status=200, content_type="application/json",
            body=json.dumps({
                "ok": True, "configured": True, "signedIn": True,
                "canSend": False, "formAllowed": False,
                "reasons": ["Hãy nhập Google Form ở Bước 2."],
            }),
        ),
    )
    reduced_page.route("https://cdn.jsdelivr.net/**", lambda route: route.abort())
    reduced_page.goto(BASE + "/index.html?qa_revision=" + EXPECTED + "#home", wait_until="domcontentloaded", timeout=30000)
    reduced_page.wait_for_function("document.body.dataset.authenticated === 'true'")
    assert reduced_page.locator(".hero-scene").evaluate("el => getComputedStyle(el).animationName") == "none"
    assert reduced_page.locator(".hero-panda-float").count() == 0
    assert reduced_page.locator(".hero-panda-erase").count() == 0
    assert reduced_page.locator(".hero-art").evaluate("el => getComputedStyle(el).transform") == "none"
    assert not reduced_errors, reduced_errors
    reduced_page.screenshot(path=str(OUT / "production-cinematic-reduced.png"), full_page=False)
    reduced.close()
    print("POST_DEPLOY_PASS production reduced-motion rendering", flush=True)

    browser.close()

print(
    "POST_DEPLOY_PASS domain=" + BASE
    + " revision=" + EXPECTED
    + " (read-only; no Google writes; no payment writes)",
    flush=True,
)
