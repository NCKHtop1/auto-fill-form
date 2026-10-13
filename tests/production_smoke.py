#!/usr/bin/env python3
"""Read-only post-merge smoke test against the active PandaStudy domain.

Invoked by GitHub Actions on main, after production has served the new UI marker.
All personal Google endpoints are mocked. No responses are posted to Google Forms.
"""
import json
import os
import time
from pathlib import Path
from urllib.request import Request, urlopen
from playwright.sync_api import sync_playwright

BASE="https://auto-fill-form-liard.vercel.app"
EXPECTED="2026-10-13-uxfix1"
OUT=Path("qa-artifacts")
OUT.mkdir(parents=True,exist_ok=True)
def wait_until_deployed():
    last="not requested"
    for attempt in range(36):
        try:
            request=Request(BASE+"/index.html?qa_revision="+EXPECTED+"&poll="+str(attempt),
                            headers={"User-Agent":"PandaStudy-readonly-postdeploy-smoke",
                                     "Cache-Control":"no-cache"})
            with urlopen(request,timeout=12) as response:
                html=response.read(240000).decode("utf-8","replace")
                status=response.status
            if status==200 and 'name="pandastudy-ui-revision" content="'+EXPECTED+'"' in html:
                print("PRODUCTION_READY revision="+EXPECTED+" attempt="+str(attempt+1),flush=True)
                return
            last="status="+str(status)+" marker="+str(EXPECTED in html)
        except Exception as exc:
            last=type(exc).__name__+": "+str(exc)[:120]
        print("WAIT_PRODUCTION attempt="+str(attempt+1)+" "+last,flush=True)
        time.sleep(6)
    raise AssertionError("Production deployment marker not served: "+last)
wait_until_deployed()
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    for width in [320,390,768,1440]:
        context=browser.new_context(viewport={"width":width,"height":860})
        page=context.new_page()
        errors=[]
        page.on("pageerror",lambda e:errors.append(str(e)))
        page.route("**/api/auth/status",lambda r:r.fulfill(status=200,
          content_type="application/json",
          body=json.dumps({"configured":True,"signedIn":True,
             "email":"qa@example.test","submissionEnabled":False})))
        page.route("**/api/qa-status**",lambda r:r.fulfill(status=200,
          content_type="application/json",
          body=json.dumps({"ok":True,"configured":True,"signedIn":True,
             "canSend":False,"formAllowed":False,"reasons":["Hãy nhập Google Form ở Bước 2."]})))
        page.route("https://cdn.jsdelivr.net/**",lambda r:r.abort())
        page.goto(BASE+"/index.html?qa_revision="+EXPECTED+"#home",wait_until="domcontentloaded",timeout=30000)
        page.locator("#qaRunStep").wait_for(state="attached",timeout=12000)
        assert page.locator('meta[name="pandastudy-ui-revision"]').get_attribute("content")==EXPECTED
        assert page.locator(".steps-strip a").count()==6
        assert page.locator("#formUrl").get_attribute("aria-label")=="Đường dẫn Google Form"
        assert page.locator("#qaRunCounters").is_hidden()
        assert page.locator("#qaRunMessage").is_hidden()
        assert page.locator("#billingHint").is_hidden()
        assert page.locator("#planMessage").is_hidden()
        for tab in ["home","app","blog","faq"]:
            page.evaluate("(tab)=>location.hash=tab",tab)
            page.wait_for_function("(tab)=>document.body.dataset.pandaPage===tab",arg=tab,timeout=9000)
            assert page.locator("#"+tab).is_visible(),tab
            overflow=page.evaluate(
              "()=>Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth")
            assert overflow<=4, "Production "+tab+" overflow "+str(overflow)+"px at "+str(width)
        page.evaluate("()=>location.hash='home'")
        page.wait_for_function("()=>document.body.dataset.pandaPage==='home'",timeout=8000)
        if width in (320,390):
            page.screenshot(path=str(OUT/("production-mobile-"+str(width)+".png")),full_page=True)
        assert not errors,"Uncaught JS errors: "+repr(errors)
        print("POST_DEPLOY_PASS viewport="+str(width)+" 6 steps, navigation, no overflow, idle UI, assets",flush=True)
        context.close()
    browser.close()
print("POST_DEPLOY_PASS domain="+BASE+" revision="+EXPECTED+" (no Google writes)",flush=True)
