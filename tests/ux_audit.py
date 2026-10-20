#!/usr/bin/env python3
"""PandaStudy UX and responsive audit against the native Vercel app.

All Google/QA writes are mocked. Read-only local fixtures only.
P0/P1/P2 regressions fail CI; P3 observations and manual reviews are reported.
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
unexpected_writes=[]
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
    page.wait_for_function("(screen)=>document.body.dataset.pandaPage===screen",arg=screen,timeout=6000)
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
      const offenders=[...document.querySelectorAll('body *')]
        .filter(e=>{const rect=e.getBoundingClientRect(),style=getComputedStyle(e);
          return style.display!=='none' && rect.width>0&&rect.right>w+4
            && rect.left>=-1&&rect.left<w+15;})
        .map(e=>({element:e.tagName.toLowerCase()+'#'+(e.id||'')+'.'+
                    String(e.className||'').replace(/\\s+/g,'.').slice(0,35),
          left:Math.round(e.getBoundingClientRect().left),
          right:Math.round(e.getBoundingClientRect().right),
          width:Math.round(e.getBoundingClientRect().width)}))
        .sort((a,b)=>b.right-a.right).slice(0,6);
      return {viewport:w,viewportHeight:h,scrollWidth:root.scrollWidth,
        overflow:overflow,smallTargets:bad,offenders:offenders};
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

def text_contrast(locator):
    """Measure computed text against composed solid/gradient backgrounds.

    A transparent white-text promo CTA used to inherit no --pb-green at all.
    Checking only its backgroundColor, or the account bar, missed that case.
    Gradient stops and intermediate colors are included for a transparent CTA;
    an opaque button resets the backdrop, giving an exact solid-color ratio.
    """
    return locator.evaluate(r"""el => {
      const parse = value => {
        const values = value.match(/[\d.]+/g)?.map(Number);
        if (!/^rgba?\(/.test(value) || !values || values.length < 3) return null;
        return [values[0],values[1],values[2],values[3] ?? 1];
      };
      const over = (front,back) => [0,1,2].map(i=>front[i]*front[3]+back[i]*(1-front[3])).concat(1);
      const chain = []; for (let node=el;node;node=node.parentElement) chain.unshift(node);
      let backgrounds=[[255,255,255,1]], supported=true;
      for (const node of chain) {
        const style=getComputedStyle(node), color=parse(style.backgroundColor);
        if (!color) { supported=false; continue; }
        if (color[3] === 1) { backgrounds=[color]; supported=true; }
        else backgrounds=backgrounds.map(background=>over(color,background));
        if (style.backgroundImage !== 'none') {
          const colors=(style.backgroundImage.match(/rgba?\([^)]*\)/g)||[]).map(parse);
          if (!colors.length || colors.some(color=>!color) || style.backgroundImage.includes('url(')) supported=false;
          else {
            const samples=[...colors];
            for (let i=1;i<colors.length;i++) for (const t of [.25,.5,.75])
              samples.push(colors[i-1].map((v,k)=>v+(colors[i][k]-v)*t));
            backgrounds=backgrounds.flatMap(background=>samples.map(color=>over(color,background)));
          }
        }
      }
      const foreground=parse(getComputedStyle(el).color);
      if (!foreground) return {supported:false,minimum:0,reason:'Unrecognized foreground color'};
      const luminance=color=>color.slice(0,3).map(v=>v/255)
        .map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4)
        .reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
      const ratios=backgrounds.map(background=>{
        const fg=luminance(over(foreground,background)), bg=luminance(background);
        return (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);
      });
      return {supported,minimum:Math.min(...ratios),foreground,
        backgrounds:backgrounds.length,backgroundColor:getComputedStyle(el).backgroundColor};
    }""")

def wait_control_transitions(locator):
    locator.evaluate("""async el => {
      getComputedStyle(el).backgroundColor;
      await Promise.all(el.getAnimations().filter(a=>Number.isFinite(a.effect.getComputedTiming().endTime))
        .map(a=>a.finished.catch(()=>{})));
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
    # Stable full-page design evidence; the dedicated motion suite separately
    # exercises the real animations and pointer extremes.
    context=browser.new_context(viewport={"width":1440,"height":900},accept_downloads=True,
                                reduced_motion="reduce")
    def read_only(route):
        if route.request.method not in ("GET","HEAD"):
            route.abort()
        else:
            route.continue_()
    def track_writes(request):
        if request.method not in ("GET","HEAD"):
            unexpected_writes.append(request.method+" "+request.url)
    context.route("**/*",read_only)
    context.on("request",track_writes)
    page=context.new_page()
    page.set_default_timeout(8000)
    page.on("pageerror",lambda e:js_errors.append(str(e)))
    # Never invoke a production Form or external user account.
    page.route("**/api/auth/status",lambda r:r.fulfill(status=200,content_type="application/json",
         body=json.dumps({"configured":True,"signedIn":True,"email":"qa@example.test","isAdmin":True,"submissionEnabled":False})))
    page.route("**/api/qa-status**",lambda r:r.fulfill(status=200,content_type="application/json",
         body=json.dumps({"ok":True,"canSend":True,"configured":True,"signedIn":True,
           "formAllowed":True,"accessMode":"public","reasons":[]})))
    # Render the standalone promo with a deterministic profile. No order is
    # created; the local admin fixture only supports the existing blog checks.
    page.route("**/api/billing?action=profile",lambda r:r.fulfill(status=200,content_type="application/json",
         body=json.dumps({"ok":True,"billingEnabled":True,"configured":True,"purchasesEnabled":True,
           "signedIn":True,"user":{"id":"ux-fixture","email":"qa@example.test","isAdmin":True},
           "availableCredits":10,"reservedCredits":0,"unitPriceVnd":500,
           "minTopupCredits":1,"maxTopupCredits":100000,"bank":None,"warnings":[],
           "activePromotions":[],"promotionGrants":[],"topupPackages":[
             {"id":"starter","name":"Bắt đầu","credits":20,"priceVnd":10000,
              "listPriceVnd":10000,"discountPercent":0,"popular":False,"featured":False},
             {"id":"popular","name":"Phổ biến","credits":100,"priceVnd":45000,
              "listPriceVnd":50000,"discountPercent":10,"popular":True,"featured":True}
           ]})))
    page.route("**/api/admin-topups**",lambda r:r.fulfill(status=200,content_type="application/json",
         body=json.dumps({"ok":True,"orders":[],"pendingOperations":[]})))
    page.route("**/api/billing?action=orders",lambda r:r.fulfill(status=200,content_type="application/json",
         body=json.dumps({"ok":True,"orders":[]})))
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
    visible_h1=page.locator("h1:visible").count()
    check("UX-004","Nội dung","P2",visible_h1==1,
          "Trang chủ có 1 H1 hiển thị; thực tế="+str(visible_h1))
    promo_cta=page.locator(".pb-promo-strip .pb-button-primary")
    promo_cta.wait_for(state="visible")
    for state in ["default","hover","keyboard-focus"]:
        if state == "hover":
            promo_cta.hover()
        elif state == "keyboard-focus":
            page.mouse.move(0,0)
            promo_cta.focus()
            page.keyboard.press("Tab")
            page.keyboard.press("Shift+Tab")
        wait_control_transitions(promo_cta)
        contrast=text_contrast(promo_cta)
        check("PROMO-CONTRAST-"+state.upper(),"A11y","P1",
              contrast["supported"] and contrast["minimum"]>=4.5,
              "CTA ưu đãi "+state+": "+json.dumps(contrast,ensure_ascii=False))
        if state == "keyboard-focus":
            focus=promo_cta.evaluate("""el => ({visible:el.matches(':focus-visible'),
              outline:getComputedStyle(el).outlineStyle,width:parseFloat(getComputedStyle(el).outlineWidth)})""")
            check("PROMO-FOCUS","A11y","P1",focus["visible"] and focus["outline"]!="none" and focus["width"]>=1,
                  "Focus CTA ưu đãi: "+json.dumps(focus,ensure_ascii=False))
    page.mouse.move(0,0)
    snap(page,"home_desktop_1440")
    # Viewing package options is read-only. Stop before create-order controls.
    for modal_width in [1440,390]:
        page.set_viewport_size({"width":modal_width,"height":900 if modal_width==1440 else 844})
        page.locator(".pb-promo-strip .pb-button-primary").click()
        dialog=page.get_by_role("dialog",name="Mua thêm phiếu")
        dialog.wait_for(state="visible")
        page.get_by_text("Chưa có đơn mua phiếu.",exact=True).wait_for(state="visible")
        page.screenshot(path=str(OUT/f"promo_packages_{modal_width}.png"),full_page=False,animations="disabled")
        page.get_by_role("button",name="Đóng mua phiếu",exact=True).click()
        check("PROMO-MODAL-CLOSE-"+str(modal_width),"Điều hướng","P1",
              dialog.is_hidden() and page.evaluate("document.body.style.overflow !== 'hidden'"),
              "Xem gói/đóng modal không tạo đơn; cuộn trang được khôi phục",viewport=str(modal_width)+"px")
    page.set_viewport_size({"width":1440,"height":900})
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
    check("UX-024","Trạng thái","P2",page.locator("#qaRunCounters").is_hidden(),
          "Không hiển thị bộ đếm 0 trước lần gửi/đối chiếu đầu tiên")
    check("UX-025","Trạng thái","P2",page.locator("#qaRunMessage").is_hidden(),
          "Không hiển thị thông báo chưa gửi thừa thãi")
    check("UX-026","Trạng thái","P2",page.locator("#billingHint").is_hidden()
          and page.locator("#planMessage").is_hidden(),
          "Bước 5 chỉ có một thông báo khi chưa có dữ liệu")
    check("UX-027","Điều hướng","P2",page.locator(".steps-strip a").last.get_attribute("href")=="#qaRunStep",
          "Mốc 6 từ thanh điều hướng mở đúng bước gửi")
    step_links=page.locator(".steps-strip a").evaluate_all("""links=>links.map(a=>{
      const target=document.getElementById(a.hash.slice(1)), step=target?.closest('.step');
      return {label:Number(a.querySelector('b')?.textContent),href:a.getAttribute('href'),
        target:Number(step?.querySelector('.step-number')?.textContent),
        heading:step?.querySelector('h3')?.textContent.trim()||''};
    })""")
    check("STEPS-TARGETS","Câu chữ","P1",
          [item["label"] for item in step_links]==list(range(1,7)) and
          all(item["label"]==item["target"] and item["heading"] for item in step_links),
          "Mỗi mốc 1–6 trỏ tới section có cùng số và heading: "+json.dumps(step_links,ensure_ascii=False))
    form_step=page.locator("#formUrl").evaluate("el=>Number(el.closest('.step').querySelector('.step-number').textContent)")
    mapping_hint=page.locator("#questionEmpty").inner_text()
    mentioned_steps=[int(number) for number in re.findall(r"bước\s+(\d+)",mapping_hint,re.I)]
    check("MAPPING-HELPER-STEP","Câu chữ","P1",bool(mentioned_steps) and all(number==form_step for number in mentioned_steps),
          "Hướng dẫn mapping phải trỏ đúng bước nhập Form "+str(form_step)+": "+mapping_hint)
    optional_copy=page.locator("#fileStep h3").inner_text()+" "+page.locator(".steps-strip a").first.inner_text()
    check("FILE-OPTIONAL","Câu chữ","P1",bool(re.search(r"tùy chọn|bỏ qua",optional_copy,re.I)),
          "Bước nhập file thể hiện rõ có thể bỏ qua")
    action_steps=page.locator("#buildPlanBtn,#validatePlanBtn,#downloadPlanBtn,#qaRunStartOne,#qaRunStartAll,#qaRunVerify,#qaRunExport").evaluate_all("""buttons=>buttons.map(button=>({
      label:button.textContent.trim(),step:Number(button.closest('.step').querySelector('.step-number').textContent)
    }))""")
    action_mismatch=[item for item in action_steps if not re.match(r"^"+str(item["step"])+r"(?:[a-z])?\.",item["label"])]
    check("STEP-ACTION-NUMBERS","Câu chữ","P1",not action_mismatch,
          "Tiền tố nút khớp bước chứa nó: "+json.dumps(action_mismatch,ensure_ascii=False))

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
    for width in [320,360,375,390,768,1024,1440]:
        page.set_viewport_size({"width":width,"height":860})
        for tab,screen in [("home","home"),("app","app"),("blog","blog"),("faq","faq")]:
            navigate(page,tab,screen)
            result=geometry(page)
            ok=result["overflow"]<=4
            check("VIEW-%s-%s"%(tab.upper(),width),"Responsive","P2",ok,
                  "scrollWidth=%s; overflow=%spx; elements=%s"%(result["scrollWidth"],
                    result["overflow"],json.dumps(result["offenders"][:3],ensure_ascii=False)),
                  viewport=str(width)+"px")
            if not ok:
                snap(page,"overflow_%s_%s"%(tab,width))
        if width in [320,390,768,1440]:
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
    context.close()
    # Capture signed-out green-brand cohesion for human design review. Assert
    # legibility/geometry, not a hard-coded shade or implementation token.
    for auth_width in [320,390]:
        auth_context=browser.new_context(viewport={"width":auth_width,"height":844},reduced_motion="reduce")
        auth_context.route("**/*",read_only)
        auth_context.on("request",track_writes)
        auth_page=auth_context.new_page()
        auth_page.on("pageerror",lambda error:js_errors.append(str(error)))
        auth_page.route("**/api/**",lambda route:route.fulfill(status=200,content_type="application/json",
            body=json.dumps({"ok":True,"configured":True,"signedIn":False,"email":"",
              "isAdmin":False,"submissionEnabled":False,"billingEnabled":False,
              "purchasesEnabled":False,"canSend":False,"formAllowed":False,"reasons":[]})))
        auth_page.route("https://cdn.jsdelivr.net/**",lambda route:route.abort())
        auth_page.goto(BASE+"/#home",wait_until="domcontentloaded")
        auth_page.locator("#psAuthGate").wait_for(state="visible")
        auth_page.wait_for_function("document.body.dataset.authenticated === 'false'")
        auth_contrast=text_contrast(auth_page.locator(".ps-auth-google"))
        check("AUTH-CONTRAST-"+str(auth_width),"A11y","P1",
              auth_contrast["supported"] and auth_contrast["minimum"]>=4.5,
              "CTA đăng nhập: "+json.dumps(auth_contrast,ensure_ascii=False),viewport=str(auth_width)+"px")
        check("AUTH-OVERFLOW-"+str(auth_width),"Responsive","P1",geometry(auth_page)["overflow"]<=1,
              "Cổng đăng nhập không tràn ngang",viewport=str(auth_width)+"px")
        snap(auth_page,"auth_signed_out_"+str(auth_width))
        auth_context.close()
    check("UI-NO-WRITES","An toàn kiểm thử","P0",not unexpected_writes,
          "Không có request ghi từ audit: "+json.dumps(unexpected_writes,ensure_ascii=False))
    check("UI-FINAL-ERRORS","Tính ổn định","P1",not js_errors,
          "Uncaught JS errors sau cả kiểm signed-out: "+json.dumps(js_errors[:3],ensure_ascii=False))
    browser.close()
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
if sum(summary["by_priority"][p] for p in ["P0","P1","P2"]) > 0:
    raise SystemExit("UX regression detected (P0/P1/P2). See qa-artifacts/ux_audit.json")
