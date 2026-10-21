#!/usr/bin/env python3
"""PandaStudy cinematic hero quality and motion browser UAT.

Local-only browser test. Account/API traffic is mocked. It never sends Google
Form responses, creates a real payment, sends email, or mutates production.
"""
from __future__ import annotations
import functools
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent / "native"
OUT = Path(__file__).resolve().parent.parent / "qa-artifacts"
OUT.mkdir(parents=True, exist_ok=True)


def hero_asset_inventory(page):
    """Decode each declared candidate, not density-corrected naturalWidth.

    The old 600px / 60KB gate allowed an image to pass while being enlarged
    beyond its useful pixels. V4 keeps an independent transfer budget for each
    responsive tier and checks actual pixel coverage in assert_hero_quality.
    These public/local image GETs cannot submit Forms or change account data.
    """
    inventory = page.locator(".hero-scene").evaluate(r"""async el => {
      const entries = (el.getAttribute('srcset') || '').split(',').filter(x => x.trim());
      const candidates = await Promise.all(entries.map(async entry => {
        const match = entry.trim().match(/^(\S+)\s+(\d+)w$/);
        if (!match) throw new Error('Hero srcset needs width descriptors: ' + entry);
        const url = new URL(match[1], document.baseURI).href;
        if (new URL(url).origin !== location.origin) throw new Error('Hero asset must be same-origin');
        const response = await fetch(url);
        if (!response.ok) throw new Error('Hero candidate failed: ' + response.status + ' ' + url);
        if (new URL(response.url).origin !== location.origin) throw new Error('Hero redirected off-origin');
        const blob = await response.blob();
        const header = new Uint8Array(await blob.slice(0,12).arrayBuffer());
        if (String.fromCharCode(...header.slice(0,4)) !== 'RIFF' ||
            String.fromCharCode(...header.slice(8,12)) !== 'WEBP') throw new Error('Hero is not a WebP file');
        const bitmap = await createImageBitmap(blob);
        const result = {url, declaredWidth: Number(match[2]), width: bitmap.width,
          height: bitmap.height, bytes: blob.size, type: blob.type};
        bitmap.close();
        return result;
      }));
      return {src: el.getAttribute('src'), sizes: el.getAttribute('sizes'),
        width: Number(el.getAttribute('width')), height: Number(el.getAttribute('height')),
        candidates};
    }""")
    candidates = inventory["candidates"]
    assert len(candidates) >= 2, ("Hero needs mobile and high-density candidates", inventory)
    assert inventory["sizes"], "Hero sizes must describe its responsive slot"
    assert inventory["width"] > 0 and inventory["height"] > 0, inventory
    widths = [item["width"] for item in candidates]
    assert len(set(widths)) == len(widths), ("Duplicate hero candidate widths", widths)
    assert min(widths) <= 800 and max(widths) >= 1536, ("Missing responsive image tier", widths)
    assert inventory["src"] in [urlparse(item["url"]).path for item in candidates], inventory
    for item in candidates:
        path = urlparse(item["url"]).path
        assert path.startswith("/assets/hero-cinematic-v4-") and path.endswith(".webp"), path
        assert item["type"] == "image/webp", item
        assert item["declaredWidth"] == item["width"], ("srcset descriptor differs from encoded pixels", item)
        aspect_error = abs(item["width"] / item["height"] - inventory["width"] / inventory["height"])
        assert aspect_error <= .005, ("Hero candidates/HTML disagree on aspect ratio", item, inventory)
        # The sharper source has a scoped quality budget: <=800w 100KB,
        # <=1600w 200KB, larger 300KB hard cap. JS/CSS budgets stay unchanged.
        byte_limit = 100_000 if item["width"] <= 800 else 200_000 if item["width"] <= 1600 else 300_000
        assert 0 < item["bytes"] <= byte_limit, ("Hero transfer budget exceeded", item, byte_limit)
    return inventory


def hero_geometry(page, pointer_extremes=False):
    """Measure painted text ranges and the transformed image over its keyframes.

    Sampling is controlled through the Web Animations API in the disposable CI
    browser. Original animation times/play states are restored after each probe.
    Container boxes alone missed the original overflowing hero image.
    """
    page.evaluate("() => document.fonts.ready.then(() => true)")
    page.wait_for_function("""() => [...document.querySelector('.hero-copy').getAnimations({subtree:true})]
      .every(a => !Number.isFinite(a.effect.getComputedTiming().endTime) || a.playState === 'finished')""")
    positions = [(0.5, 0.5)]
    if pointer_extremes:
        positions += [(0.02, 0.02), (0.02, 0.98), (0.98, 0.02), (0.98, 0.98)]
    probes = []
    for x, y in positions:
        if pointer_extremes:
            box = page.locator(".hero-art").bounding_box()
            assert box, "Hero art has no measurable box"
            page.mouse.move(box["x"] + box["width"] * x, box["y"] + box["height"] * y)
            page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        probes.append(page.locator(".hero-scene").evaluate(r"""el => {
          const rect = r => ({left:r.left, top:r.top, right:r.right, bottom:r.bottom,
            width:r.width, height:r.height});
          const textRects = [];
          const walker = document.createTreeWalker(document.querySelector('.hero h1'), NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            if (!walker.currentNode.textContent.trim()) continue;
            const range = document.createRange(); range.selectNodeContents(walker.currentNode);
            for (const r of range.getClientRects()) if (r.width && r.height) textRects.push(rect(r));
          }
          const animations = el.getAnimations().map(a => ({a, time:a.currentTime,
            state:a.playState, timing:a.effect.getTiming(), computed:a.effect.getComputedTiming()}));
          const offsets = new Set([0, .25, .5, .75, .999999]);
          animations.forEach(({a}) => a.effect.getKeyframes().forEach(k => {
            if (typeof k.computedOffset === 'number') offsets.add(Math.min(k.computedOffset,.999999));
          }));
          const images = [], overlaps = [];
          try {
            animations.forEach(({a}) => a.pause());
            for (const offset of offsets) {
              animations.forEach(({a,timing,computed}) => {
                if (Number.isFinite(computed.duration)) a.currentTime = timing.delay + computed.duration * offset;
              });
              const image = rect(el.getBoundingClientRect()); images.push(image);
              for (const text of textRects) {
                const width = Math.min(image.right,text.right)-Math.max(image.left,text.left);
                const height = Math.min(image.bottom,text.bottom)-Math.max(image.top,text.top);
                if (width > 1 && height > 1) overlaps.push({offset,width,height,image,text});
              }
            }
          } finally {
            animations.forEach(({a,time,state}) => {
              a.currentTime = time;
              if (state === 'running') a.play();
            });
          }
          return {images, overlaps, textRects, currentSrc:el.currentSrc, dpr:devicePixelRatio,
            clippedHeadline:textRects.filter(r=>r.left < -1 || r.right > innerWidth+1)};
        }"""))
    if pointer_extremes:
        page.mouse.move(0, 0)
    return {
        "currentSrc": probes[0]["currentSrc"], "dpr": probes[0]["dpr"],
        "maxWidth": max(image["width"] for probe in probes for image in probe["images"]),
        "maxHeight": max(image["height"] for probe in probes for image in probe["images"]),
        "samples": sum(len(probe["images"]) for probe in probes),
        "overlaps": [overlap for probe in probes for overlap in probe["overlaps"]],
        "clippedHeadline": [item for probe in probes for item in probe["clippedHeadline"]],
    }


def assert_hero_quality(page, inventory, pointer_extremes=False):
    metrics = hero_geometry(page, pointer_extremes=pointer_extremes)
    assert not metrics["overlaps"], ("Hero image overlaps actual headline text", metrics)
    assert not metrics["clippedHeadline"], ("Hero headline is clipped by the viewport", metrics)
    selected = next((item for item in inventory["candidates"] if item["url"] == metrics["currentSrc"]), None)
    assert selected, ("Browser selected a hero outside the declared responsive candidates", metrics)
    # Both axes matter for object-fit: cover: cropping can demand more pixels
    # than comparing only the container width. Two pixels allow rounding only.
    assert selected["width"] + 2 >= metrics["maxWidth"] * metrics["dpr"], ("Hero is upscaled horizontally", selected, metrics)
    assert selected["height"] + 2 >= metrics["maxHeight"] * metrics["dpr"], ("Hero is upscaled vertically", selected, metrics)
    return {"selected": selected, **metrics}

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

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



def assert_tonal_continuity(page):
    """The dark hero and light workspace share a real responsive transition."""
    # Keep hover/focus styling from contaminating the default-state comparison.
    page.mouse.move(2, 2)
    page.wait_for_timeout(30)
    assert page.locator(".ps-tone-bridge").count() == 1
    metrics = page.evaluate("""() => {
      const hero = document.querySelector('.hero.hero-cinematic').getBoundingClientRect();
      const bridge = document.querySelector('.ps-tone-bridge');
      const strip = document.querySelector('.steps-strip');
      const b = bridge.getBoundingClientRect(), s = strip.getBoundingClientRect();
      const links = [...strip.querySelectorAll('a')];
      const first = getComputedStyle(links[0]), second = getComputedStyle(links[1]);
      const pageBg = getComputedStyle(document.body).backgroundColor;
      return {
        home: document.body.dataset.pandaPage === 'home',
        bridgeVisible: getComputedStyle(bridge).display !== 'none',
        gradient: getComputedStyle(bridge).backgroundImage,
        heroBottom: hero.bottom, bridgeTop: b.top, bridgeBottom: b.bottom,
        stripTop: s.top, stripBottom: s.bottom,
        cardCount: links.length,
        firstBg: first.backgroundImage, secondBg: second.backgroundImage,
        firstColor: first.color, secondColor: second.color,
        pageBg
      };
    }""")
    assert metrics["home"] and metrics["bridgeVisible"], metrics
    assert "linear-gradient" in metrics["gradient"], metrics
    assert abs(metrics["heroBottom"] - metrics["bridgeTop"]) <= 3, metrics
    assert metrics["bridgeTop"] <= metrics["stripTop"] < metrics["bridgeBottom"], metrics
    assert metrics["cardCount"] == 6, metrics
    assert metrics["firstBg"] == metrics["secondBg"], metrics
    assert metrics["firstColor"] == metrics["secondColor"], metrics
    assert metrics["pageBg"] == "rgb(242, 248, 245)", metrics
    return metrics

def main():
    assert (ROOT / "motion-ui.js").stat().st_size < 12_000, "motion-ui.js exceeds 12 KB guardrail"
    assert (ROOT / "motion-ui.css").stat().st_size < 24_000, "motion-ui.css exceeds 24 KB guardrail"
    server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    BASE = "http://127.0.0.1:" + str(server.server_address[1])
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

            assert page.locator('meta[name="pandastudy-ui-revision"]').get_attribute("content") == "2026-10-21-panda-float-v10"
            assert page.locator('link[href="/motion-ui.css?v=20261021c"]').count() == 1
            assert page.locator('script[src="/motion-ui.js?v=20261020f"]').count() == 1
            assert page.locator(".hero-cinematic").count() == 1
            assert page.locator(".hero-aura").count() == 2
            assert page.locator(".hero-scan").count() == 1
            assert page.locator(".hero-depth-grid").count() == 1
            assert page.locator(".hero-live-chip").count() == 1
            assert page.locator(".hero-proof span").count() == 3
            assert_tonal_continuity(page)

            image = page.locator(".hero-scene")
            image.wait_for(state="visible")
            page.wait_for_function("document.querySelector('.hero-scene').complete && document.querySelector('.hero-scene').naturalWidth > 0")
            inventory = hero_asset_inventory(page)
            desktop_quality = assert_hero_quality(page, inventory, pointer_extremes=True)
            (OUT / "hero-quality-desktop.json").write_text(json.dumps(desktop_quality, indent=2), encoding="utf-8")
            average_luma = image.evaluate("""el => {
              const c=document.createElement('canvas'); c.width=30; c.height=17;
              const x=c.getContext('2d'); x.drawImage(el,0,0,c.width,c.height);
              const d=x.getImageData(0,0,c.width,c.height).data;
              let sum=0; for(let i=0;i<d.length;i+=4) sum += (d[i]+d[i+1]+d[i+2])/3;
              return sum/(d.length/4);
            }""")
            assert average_luma > 35, ("hero appears blank/dark", average_luma)

            scene_animation = image.evaluate("el => getComputedStyle(el).animationName")
            assert scene_animation == "none", scene_animation
            assert page.locator(".hero-panda-float").count() == 1
            assert page.locator(".hero-panda-erase").count() == 1
            panda_animation = page.locator(".hero-panda-float").evaluate("el => getComputedStyle(el).animationName")
            assert "psPandaFloatV10" in panda_animation, panda_animation
            erase_bg = page.locator(".hero-panda-erase").evaluate("el => getComputedStyle(el).backgroundImage")
            assert "hero-panda-erase-v10.jpg" in erase_bg, erase_bg
            # Keep the high-resolution scene static while the duplicated mascot floats independently.
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
            assert "gradient(" in image_mask, ("Hero needs an edge-blending mask", image_mask)
            assert page.locator(".hero-nowrap-desktop").evaluate("el => getComputedStyle(el).whiteSpace") == "nowrap"

            before = page.locator(".hero-art").evaluate("el => getComputedStyle(el).transform")
            box = page.locator(".hero-art").bounding_box()
            assert box
            page.mouse.move(box["x"] + box["width"] * .88, box["y"] + box["height"] * .2)
            page.wait_for_timeout(90)
            after = page.locator(".hero-art").evaluate("el => getComputedStyle(el).transform")
            assert before == "none" and after == "none", (before, after)

            # Original CTA semantics and navigation must remain intact.
            primary = page.get_by_role("link", name="Bắt đầu ngay", exact=True)
            secondary = page.get_by_role("link", name="Xem cách dùng")
            assert primary.get_attribute("href") == "#app"
            assert secondary.get_attribute("href") == "#how"
            primary.click()
            page.wait_for_function("location.hash === '#app'")
            page.wait_for_function("document.body.dataset.pandaPage === 'app'")
            assert page.locator("#app").is_visible()
            assert not page.locator(".ps-tone-bridge").is_visible(), "Bridge must disappear on tool tab"

            workspace = page.locator("#app")
            assert workspace.evaluate("el => el.classList.contains('motion-reveal')")
            workspace.scroll_into_view_if_needed()
            page.wait_for_function("document.getElementById('app').classList.contains('is-visible')")
            assert overflow(page)["delta"] <= 1, overflow(page)
            page.evaluate("location.hash='#home'")
            page.wait_for_function("document.body.dataset.pandaPage === 'home'")
            assert_tonal_continuity(page)
            page.screenshot(path=str(OUT / "cinematic_v4_desktop_1440.png"), full_page=False, animations="disabled")
            assert not errors, errors
            print("PASS cinematic desktop: static scene, panda-only vertical float, sharp responsive asset, reveal and CTAs preserved", flush=True)
            context.close()

            # DPR2 desktop/tablet and DPR3 phones cover the visible sharpness risk.
            # Keep fresh contexts so a cached large candidate cannot mask bad sizes.
            for width, height, dpr in [(1440, 900, 2), (1024, 860, 2), (768, 900, 2),
                                       (390, 844, 3), (360, 800, 3), (320, 800, 2)]:
                ctx = browser.new_context(viewport={"width": width, "height": height},
                                          device_scale_factor=dpr, is_mobile=width <= 650,
                                          has_touch=width <= 650)
                p = ctx.new_page()
                mock_page(p)
                p.goto(BASE + "/#home", wait_until="domcontentloaded")
                p.wait_for_function("document.body.dataset.authenticated === 'true'")
                p.wait_for_function("document.documentElement.classList.contains('motion-ready')")
                p.wait_for_function("document.querySelector('.hero-scene').complete && document.querySelector('.hero-scene').naturalWidth > 0")
                quality = assert_hero_quality(p, inventory, pointer_extremes=width >= 1024)
                (OUT / f"hero-quality-{width}-dpr{dpr}.json").write_text(json.dumps(quality, indent=2), encoding="utf-8")
                assert_tonal_continuity(p)
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
                    p.screenshot(path=str(OUT / f"cinematic_v4_mobile_{width}.png"), full_page=False, animations="disabled")
                print(f"PASS cinematic responsive: {width}px DPR{dpr}, full pixel coverage and no horizontal overflow", flush=True)
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

            reduced_animation = rp.locator(".hero-scene").evaluate("el => getComputedStyle(el).animationName")
            assert reduced_animation == "none", reduced_animation
            assert rp.locator(".hero-panda-float").count() == 1
            assert rp.locator(".hero-panda-erase").count() == 1
            assert rp.locator(".hero-panda-float").evaluate("el => getComputedStyle(el).animationName") == "none"
            hidden_reveals = rp.locator(".motion-reveal").evaluate_all(
                "els => els.filter(el => { const s=getComputedStyle(el); return s.opacity==='0' || s.transform!=='none'; }).length"
            )
            assert hidden_reveals == 0, hidden_reveals
            rbox = rp.locator(".hero-art").bounding_box()
            assert rbox
            rp.mouse.move(rbox["x"] + rbox["width"] * .9, rbox["y"] + rbox["height"] * .1)
            rp.wait_for_timeout(90)
            reduced_transform = rp.locator(".hero-art").evaluate("el => getComputedStyle(el).transform")
            assert reduced_transform == "none", reduced_transform
            assert rp.get_by_role("link", name="Bắt đầu ngay", exact=True).is_visible()
            assert_hero_quality(rp, inventory)
            rp.screenshot(path=str(OUT / "cinematic_v4_reduced_1440.png"), full_page=False, animations="disabled")
            assert not reduced_errors, reduced_errors
            print("PASS cinematic accessibility: reduced-motion is static and fully usable", flush=True)
            reduced.close()
            browser.close()
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
