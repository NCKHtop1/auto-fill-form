#!/usr/bin/env python3
"""PandaStudy UX and responsive audit against the native Vercel app.

All Google/QA writes are mocked. Read-only local fixtures only.
P2/P3 UX findings are reported as FAIL/WARN without blocking a test-only PR;
P0/P1 technical failures fail CI.
"""
from __future__ import annotations
import functools
import json
import os
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent/"native"
OUT=Path(os.environ.get("PANDASTUDY_AUDIT_OUT",str(Path(__file__).resolve().parent.parent/"qa-artifacts")))
OUT.mkdir(parents=True,exist_ok=True)
records=[]
js_errors=[]
def check(case,group,severity,ok,detail="",viewport="",evidence=""):
    rec={"case":case,"group":group,"priority":severity,"status":"PASS" if ok else "FAIL",
         "detail":detail,"viewport":viewport,"evidence":evidence}
    records.append(rec)
    print("UX_CASE "+json.dumps(rec,ensure_ascii=False),flush=True)
    return bool(ok)
def note(case,group,detail,priority="P3"):
    rec={"case":case,"group":group,"priority":priority,"status":"REVIEW","detail":detail}
    records.append(rec)
    print("UX_CASE "+json.dumps(rec,ensure_ascii=False),flush=True)
def wait_hash(page,screen):
    page.wait_for_function("(page)=>document.body.dataset.pandaPage===page",screen,timeout=6000)
def navigate(page,hash_value,screen):
    page.evaluate("(hash)=>{window.location.hash=hash}",hash_value)
    wait_hash(page,screen)
def snap(page,name):
    filename=str(OUT/(name+".png"))
    page.screenshot(path=filename,full_page=True,animations="disabled",timeout=14000)
    return Path(filename).name
def geometry(page):
    return page.evaluate("""() => {
      const w=window.innerWidth;
      const h=window.innerHeight;
      const root=document.documentElement;
      const body=document.body;
      const overflow=Math.max(root.scrollWidth,body.scrollWidth)-w;
      const bad=[...document.querySelectorAll('main a, main button, #mainNav a, .nav-actions a')]
        .filter(e => !!(e.offsetWidth||e.offsetHeight||e.getClientRects().length))
        .map(e => ({name:(e.innerText||e.getAttribute('aria-label')||'').trim().slice(0,32),
           width:Math.round(e.getBoundingClientRect().width),
           height:Math.round(e.getBoundingClientRect().height)}))
        .filter(e => e.width>0&&e.height>0&&(e.height<32||e.width<24))
        .slice(0,10);
      return {viewport:w,viewportHeight:h,scrollWidth:root.scrollWidth,
        overflow:overflow,smallTargets:bad};
    }""")
def unnamed_inputs(page):
    return page.evaluate("""() => {
      const visible=e=>{
        const box=e.getBoundingClientRect();
        return box.width>0&&box.height>0&&!e.closest('[hidden],.hidden');
      };
      return [...document.querySelectorAll('input:not([type=hidden]),select,textarea')]
        .filter(visible)
        .filter(e=>!e.disabled)
        .filter(e=>{
          const label=!!e.labels?.length;
          return !label && !e.getAttribute('aria-label')
            && !e.getAttribute('aria-labelledby') && !e.getAttribute('title');
        })
        .map(e=>e.id||e.name||e.outerHTML.slice(0,90)).slice(0,20);
    }""")
class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*args):
        pass
server=ThreadingHTTPServer(("127.0.0.1",0),functools.partial(Handler,directory=str(ROOT)))
Thread(target=server.serve_forever,daemon=True).start()
BASE="http://127.0.0.1:"+str(server.server_address[1])
try:
 with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True)
    context=browser.new_context(viewport={"width":1440,"height":900},accept_downloads=True)
    page=context.new_page()
    page.set_default_timeout(8000)
    page.on("pageerror",lambda e:js_errors.append(str(e)))
    # Never invoke a production Form or external user account.
    page.route("**/api/auth/status",lambda r:r.fulfill(status=200,content_type="application/json",
         body=json.dumps({"configured":True,"signedIn":True,"email":"qa@example.test","submissionEnabled":False})))
    page.route("**/api/qa-status**",lambda r:r.fulfill(status=200,content_type="application/json",
         body=json.dumps({"ok":True,"canSend":True,"configured":True,"signedIn":True,
           "formAllowed":True,"accessMode":"public","reasons":[]})))
    page.route("https://cdn.jsdelivr.net/**",lambda r:r.abort())
    page.goto(BASE+"/#home",wait_until="domcontentloaded")
    page.locator("#qaRunStep").wait_for(state="attached")
    page.locator("#blogGrid .panda-blog-card").first.wait_for(state="attached",timeout=15000)
    check("UX-001","Điều hướng","P1",page.title()=="PandaStudy",
          "Document title: "+page.title())
    check("UX-002","Điều hướng","P1",page.locator("#app").is_visible() and
          page.locator("#blog").is_hidden() and page.locator("#how").is_hidden() and
          page.locator("#faq").is_hidden() and page.locator("#about").is_hidden(),
          "Trang chủ chỉ hiện hero + công cụ")
    check("UX-003","Điều hướng","P2",page.locator("#mainNav a").count()>=7,
          "Tab trên thanh điều hướng: "+str(page.locator("#mainNav a").count()))
    check("UX-004","Nội dung","P2",page.locator("h1").count()==1,
          "Trang chủ có 1 H1")
    snap(page,"home_desktop_1440")
    for tag,screen in [("app","app"),("blog","blog"),("how","how"),
                       ("faq","faq"),("about","about"),("previewSection","app"),
                       ("dropZone","app"),("formSetupStep","app")]:
        navigate(page,tag,screen)
        check("NAV-"+tag.upper(),"Điều hướng","P1",page.locator("#"+screen).is_visible(),
              "Deep-link #"+tag+" mở trang "+screen)
        if screen not in ["home","app"]:
            check("ISOLATE-"+screen.upper(),"Điều hướng","P2",
                page.locator("#app").is_hidden() and
                all(page.locator("#"+x).is_hidden() for x in ["blog","how","faq","about"] if x!=screen),
                "Chỉ hiển thị nội dung tab hiện tại")
    navigate(page,"blog","blog")
    check("UX-005","Blog","P1",page.locator("#blogGrid article").count()==5,
          "Hiển thị 5 bài blog")
    page.locator("#blogSearch").fill("khongcotukhoa_123456")
    check("UX-006","Blog","P2",page.locator("#blogEmpty").is_visible(),
          "Thông báo không có kết quả")
    page.locator("#blogClear").click()
    check("UX-007","Blog","P1",page.locator("#blogGrid article").count()==5,
          "Xoá bộ lọc hiển thị lại đủ bài")
    page.locator("#blogGrid article a").first.click()
    page.locator("#blogReader").wait_for(state="visible")
    check("UX-008","Blog","P1",page.locator("#articleTitle").inner_text().strip()!="",
          "Trang chi tiết hiển thị tiêu đề bài viết")
    page.locator("#blogReader a[href='#blog']").first.click()
    page.locator("#blogGrid article").first.wait_for(state="visible")
    page.locator("a[href='#blog-viet-bai']").first.click()
    page.locator("#blogEditor").wait_for(state="visible")
    page.locator("#postTitle").fill("Tiêu đề bản nháp kiểm thử PandaStudy")
    page.locator("#postSummary").fill("Kiểm thử khả năng lưu bản nháp cục bộ cho người dùng.")
    page.locator("#postBody").fill("# Nội dung\n"+"Bản nháp kiểm thử. "*9)
    page.locator("#saveBlogDraft").click()
    check("UX-009","Blog","P2","Đã lưu" in page.locator("#blogEditorStatus").inner_text(),
          "Lưu bản nháp báo trạng thái")
    page.reload(wait_until="domcontentloaded")
    page.locator("#postTitle").wait_for(state="visible")
    check("UX-010","Blog","P1",page.locator("#postTitle").input_value() ==
          "Tiêu đề bản nháp kiểm thử PandaStudy","Bản nháp vẫn còn sau tải lại")
    # Browser back / forward must preserve working navigation state.
    navigate(page,"app","app")
    navigate(page,"faq","faq")
    page.go_back(wait_until="domcontentloaded")
    wait_hash(page,"app")
    check("UX-011","Điều hướng","P2",page.locator("#app").is_visible() and
          page.locator("#faq").is_hidden(),"Lùi trình duyệt trở lại Công cụ")
    page.go_forward(wait_until="domcontentloaded")
    wait_hash(page,"faq")
    check("UX-012","Điều hướng","P2",page.locator("#faq").is_visible(),
          "Tiến trình duyệt sang FAQ")
    navigate(page,"home","home")
    steps=page.locator(".steps-strip a").count()
    last=int(page.locator("#qaRunStep .step-number").first.inner_text().strip())
    check("UX-013","Câu chữ","P2",steps==last,
          "Thanh nhanh có "+str(steps)+" bước; form hoàn chỉnh có bước "+str(last))
    check("UX-014","Câu chữ","P1",page.locator("#qaRunStep h3").first.inner_text().strip()
          =="Gửi Form và đối chiếu kết quả","Tên bước 6 thống nhất")
    check("UX-015","Câu chữ","P2",page.locator("#qaConsent").locator("..").inner_text().strip()
          =="Tôi xác nhận","Xác nhận được rút gọn")
    check("UX-016","Câu chữ","P2","Gửi Form thử" not in page.locator("#qaRunStep").inner_text(),
          "Bỏ chữ thử ở tiêu đề")
    check("UX-017","Câu chữ","P2","Chưa sẵn sàng gửi:" not in page.locator("#qaRunStep").inner_text(),
          "Không còn thông điệp khóa cũ")
    schedule_disabled=page.locator("#scheduleMode option[value='interval']").is_disabled()
    faq_copy=page.locator("#faq [data-i18n='faq_delay_a']").inner_text()
    check("UX-018","Câu chữ","P2",not(schedule_disabled and "lịch chạy nền" in faq_copy),
          "FAQ giới thiệu lịch chạy nền khi chức năng đang bị khóa="+str(schedule_disabled))
    check("UX-019","A11y","P2",bool(page.locator("#formUrl").evaluate(
          "e => !!e.labels?.length || !!e.getAttribute('aria-label') || !!e.getAttribute('aria-labelledby')")),
          "Ô nhập Form cần accessible name thay vì chỉ placeholder")
    all_unnamed=[]
    for hash_value,screen in [("app","app"),("blog","blog"),("faq","faq")]:
        navigate(page,hash_value,screen)
        missing=unnamed_inputs(page)
        all_unnamed.extend((hash_value,m) for m in missing)
    check("UX-020","A11y","P2",not all_unnamed,
          "Input thiếu tên: "+json.dumps(all_unnamed[:10],ensure_ascii=False))
    navigate(page,"app","app")
    form=page.locator("#formUrl")
    check("UX-021","A11y","P2",page.locator("#qaRunMessage").get_attribute("role")=="status",
          "Trạng thái gửi có role=status")
    page.keyboard.press("Tab")
    check("UX-022","A11y","P3",page.evaluate("document.activeElement!==document.body"),
          "Tab có thể điều hướng từ bàn phím")
    page.locator("#mobileMenu").count()  # Used at mobile breakpoints below.
    for width in [320,375,390,768,1024,1440]:
        page.set_viewport_size({"width":width,"height":860})
        for tab,screen in [("home","home"),("app","app"),("blog","blog"),("faq","faq")]:
            navigate(page,tab,screen)
            result=geometry(page)
            ok=result["overflow"]<=4
            check("VIEW-%s-%s"%(tab.upper(),width),"Responsive","P2",ok,
                  "scrollWidth=%s; overflow=%spx"%(result["scrollWidth"],result["overflow"]),
                  viewport=str(width)+"px")
            if not ok:
                snap(page,"overflow_%s_%s"%(tab,width))
        if width in [320,390,1440]:
            navigate(page,"home","home")
            snap(page,"home_%s"%(width))
        if width in [390]:
            navigate(page,"blog","blog");snap(page,"blog_mobile_390")
            navigate(page,"app","app");snap(page,"app_mobile_390")
            navigate(page,"faq","faq");snap(page,"faq_mobile_390")
        if width<=920:
            navigate(page,"home","home")
            visible=page.locator("#mobileMenu").is_visible()
            check("NAV-MOBILE-%s"%width,"Responsive","P1",visible,
                 "Nút mở menu ở viewport "+str(width),viewport=str(width)+"px")
            if visible:
                page.locator("#mobileMenu").click()
                check("MENU-OPEN-%s"%width,"Điều hướng","P1",
                      page.locator("#mainNav").is_visible(),"Menu mobile mở",viewport=str(width)+"px")
                page.keyboard.press("Escape")
                check("MENU-ESC-%s"%width,"A11y","P2",
                      page.locator("#mainNav").is_hidden(),"Escape đóng menu",viewport=str(width)+"px")
    page.set_viewport_size({"width":1440,"height":900})
    check("UX-023","Tính ổn định","P1",not js_errors,
          "Uncaught JS errors: "+json.dumps(js_errors[:3],ensure_ascii=False))
    # Deliberately do not send anything to the actual Google Forms service.
    note("MANUAL-001","OAuth","Chỉ có thể xác nhận đăng nhập OAuth thật bằng tài khoản chủ Form; bài test không sử dụng cookie người dùng.","P1")
    note("MANUAL-002","Gửi","6a/6b trên Google Form thật cần bản sao thử nghiệm có quyền, không tự gửi vào khảo sát đang chạy.","P1")
    note("MANUAL-003","Hiệu năng","Lighthouse/Core Web Vitals thực tế và phản hồi API production chưa được đo trong script cục bộ.","P2")
    context.close();browser.close()
finally:
 server.shutdown()
summary={
 "total":len(records),
 "pass":sum(x["status"]=="PASS" for x in records),
 "fail":sum(x["status"]=="FAIL" for x in records),
 "review":sum(x["status"]=="REVIEW" for x in records),
 "by_priority":{p:sum(x["status"]=="FAIL" and x["priority"]==p for x in records)
                for p in ["P0","P1","P2","P3"]}
}
(OUT/"ux_audit.json").write_text(json.dumps({"summary":summary,"cases":records},ensure_ascii=False,indent=2),encoding="utf-8")
print("UX_SUMMARY "+json.dumps(summary,ensure_ascii=False),flush=True)
if summary["by_priority"]["P0"] or summary["by_priority"]["P1"]:
    raise SystemExit("Blocking P0/P1 failures. See qa-artifacts/ux_audit.json")
