import functools, json, re, sys, threading
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path('tests').resolve()))
from motion_ui_browser import mock_page
OUT=Path('release-audit'); OUT.mkdir(exist_ok=True)
AXE=Path('.audit-deps/node_modules/axe-core/axe.min.js')
results=[]
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(Path('native').resolve())))
threading.Thread(target=server.serve_forever,daemon=True).start()
BASE='http://127.0.0.1:'+str(server.server_port)
def record(name,status,detail=None):
    item={'case':name,'status':status,'detail':detail}; results.append(item)
    print(json.dumps(item,ensure_ascii=True),flush=True)
def audit_page(page,name):
    page.evaluate('() => document.fonts.ready')
    metrics=page.evaluate('''() => ({overflow:Math.max(document.body.scrollWidth,document.documentElement.scrollWidth)-innerWidth,
      brokenImages:[...document.images].filter(x=>x.getClientRects().length&&(!x.complete||!x.naturalWidth)).map(x=>x.getAttribute('src')),
      h1:[...document.querySelectorAll('h1')].filter(x=>x.getClientRects().length).map(x=>x.innerText),
      current:[...document.querySelectorAll('#mainNav [aria-current]')].map(x=>({text:x.textContent,href:x.getAttribute('href')})),
      bodyFont:getComputedStyle(document.body).fontFamily})''')
    record(name+'/layout','PASS' if metrics['overflow']<=1 and not metrics['brokenImages'] else 'FAIL',metrics)
    page.add_script_tag(path=str(AXE))
    axe=page.evaluate('''async () => {const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}});return {violations:r.violations.map(v=>({id:v.id,impact:v.impact,description:v.description,helpUrl:v.helpUrl,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary,html:n.html}))})),incomplete:r.incomplete.map(v=>({id:v.id,nodes:v.nodes.length})),passes:r.passes.length};}''')
    (OUT/(name.replace('/','-')+'-axe.json')).write_text(json.dumps(axe,ensure_ascii=False,indent=2))
    record(name+'/axe','FAIL' if axe['violations'] else 'PASS',{'rules':[(x['id'],x['impact'],len(x['nodes'])) for x in axe['violations']],'manual_review':axe['incomplete']})
    page.screenshot(path=str(OUT/(name.replace('/','-')+'.png')),animations='disabled')
try:
    with sync_playwright() as p:
        for engine in ('chromium','firefox','webkit'):
            browser=None
            try:
                browser=getattr(p,engine).launch()
                for width in (390,1440):
                    ctx=browser.new_context(viewport={'width':width,'height':900},reduced_motion='reduce')
                    ctx.route('**/*',lambda r:r.continue_() if r.request.method in ('GET','HEAD') else r.abort())
                    page=ctx.new_page(); errors=[]
                    page.on('pageerror',lambda e:errors.append(str(e)))
                    mock_page(page)
                    page.goto(BASE+'/#home',wait_until='networkidle')
                    page.wait_for_function("document.body.dataset.authenticated === 'true'")
                    for tab in ('home','app','blog','how','faq','about'):
                        name=f'{engine}/{width}/{tab}'
                        try:
                            page.evaluate('(t)=>location.hash=t',tab)
                            page.wait_for_function('(t)=>document.body.dataset.pandaPage===t',arg=tab)
                            audit_page(page,name)
                            if tab=='home':
                                page.locator('.steps-strip').scroll_into_view_if_needed()
                                page.screenshot(path=str(OUT/(name.replace('/','-')+'-seam.png')),animations='disabled')
                            else:
                                record(name+'/bridge-hidden','PASS' if page.locator('.ps-tone-bridge').is_hidden() else 'FAIL')
                        except Exception as exc:
                            record(name+'/execution','ERROR',str(exc)[:1000])
                    record(f'{engine}/{width}/uncaught','PASS' if not errors else 'FAIL',errors)
                    ctx.close()
                ctx=browser.new_context(viewport={'width':390,'height':844})
                page=ctx.new_page()
                page.route('**/api/**',lambda r:r.fulfill(status=200,content_type='application/json',body=json.dumps({'configured':True,'signedIn':False,'billingEnabled':True})))
                page.goto(BASE+'/',wait_until='networkidle')
                page.locator('#psAuthGate').wait_for(state='visible')
                audit_page(page,f'{engine}/390/signed-out')
                links=page.locator('#psAuthGate a').evaluate_all('(xs)=>xs.map(x=>({text:x.textContent,href:x.getAttribute("href")}))')
                record(f'{engine}/prelogin/policy-links','PASS' if any('bao-mat' in x['href'] for x in links) and any('dieu-khoan' in x['href'] for x in links) else 'FAIL',links)
                ctx.close()
            except Exception as exc:
                record(engine+'/execution','ERROR',str(exc)[:1000])
            finally:
                if browser: browser.close()
finally:
    server.shutdown()
    (OUT/'independent-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
    counts={s:sum(x['status']==s for x in results) for s in ('PASS','FAIL','ERROR')}
    print('AUDIT_SUMMARY '+json.dumps(counts),flush=True)
if any(x['status'] in ('FAIL','ERROR') for x in results): sys.exit(1)
