#!/usr/bin/env python3
"""Browser QA for the test-only submission flow. No real Google Forms are modified."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import functools
import csv
import json
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent / 'native'
class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
http = ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(root)))
Thread(target=http.serve_forever,daemon=True).start()
url = 'http://127.0.0.1:'+str(http.server_address[1])
form_url = 'https://docs.google.com/forms/d/AbCdEfG123456/edit'
form = {
    'id':'AbCdEfG123456','title':'Form thử nghiệm giả lập','description':'test',
    'accessMode':'public','collectsEmail':None,'responseCount':None,
    'acceptingResponses':True,'supportedCount':1,'unsupportedCount':0,
    'questions':[{'id':'1','index':0,'title':'Câu thử nghiệm','helpText':'',
        'required':True,'supported':True,'options':['Có','Không'],
        'type':'multiple_choice','entryIds':['400']}]
}
try:
  with sync_playwright() as engine:
    browser=engine.chromium.launch(headless=True)
    context=browser.new_context(viewport={'width':1200,'height':900},accept_downloads=True)
    page=context.new_page()
    errors=[]
    submitted=[]
    submitted_operations=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.route('**/api/auth/status',lambda r:r.fulfill(
        status=200,content_type='application/json',
        body=json.dumps({'configured':True,'signedIn':True,'email':'qa@example.test','submissionEnabled':False})))
    page.route('**/api/qa-status**',lambda r:r.fulfill(
        status=200,content_type='application/json',
        body=json.dumps({'ok':True,'canSend':True,'configured':True,'signedIn':True,
            'formAllowed':True,'admin':True,'reasons':[]})))
    def bridge(route):
      data=route.request.post_data_json
      name=data.get('name')
      if name=='importOwnedForm': response=form
      elif name=='validatePlan':
        batch=data['args'][1]
        response={'valid':True,'invalid':0,'total':len(batch),
                  'results':[{'index':i+1,'valid':True,'issues':[]} for i in range(len(batch))]}
      elif name=='getBillingProfile':response={'configured':True,'billingEnabled':False,'availableCredits':10000}
      elif name=='getScheduledQaRuns':response=[]
      else:
        route.fulfill(status=400,content_type='application/json',body='{"error":"not mocked"}')
        return
      route.fulfill(status=200,content_type='application/json',
                    body=json.dumps(response,ensure_ascii=False))
    page.route('**/api/bridge',bridge)
    def verify(route):
      route.fulfill(status=200,content_type='application/json',
                    body=json.dumps({'ok':True,'count':624+len(submitted),
                       'source':'google-sheet-public-csv','checkedAt':'2026-10-13T00:00:00Z',
                       'note':'Read-only mock'}))
    page.route('**/api/qa-verify',verify)
    def submit(route):
      request=route.request.post_data_json
      assert request['confirmedTestOnly'] is True
      assert request['formUrl']==form_url
      submitted.append(request['answers'])
      submitted_operations.append(request['operationId'])
      route.fulfill(status=200,content_type='application/json',
                    body=json.dumps({'ok':True,'status':'page-confirmed',
                      'receivedAt':'2026-10-13T00:00:00Z','note':'Fake Google confirmation'}))
    page.route('**/api/qa-submit',submit)
    page.goto(url+'/#home',wait_until='domcontentloaded')
    page.locator('#qaRunStep').wait_for()
    page.locator('#formUrl').fill(form_url)
    page.locator('#importFormBtn').click()
    page.locator('#questionList .question-card').first.wait_for(timeout=10000)
    page.locator('#responseCount').fill('2')
    page.locator('#buildPlanBtn').click()
    page.locator('#validatePlanBtn').click()
    page.locator('#planTableBody .status-chip.success').first.wait_for(timeout=15000)
    assert page.locator('#planTableBody .status-chip.success').count()==2
    page.locator('#qaSheetUrl').fill('https://docs.google.com/spreadsheets/d/1T_gGTt8xFY_-Jylbm_Di-90J69BdNsElyv2lLNaiks8/edit?gid=1197897507')
    page.locator('#qaConsent').check()
    assert page.locator('#qaRunStep .step-title h3').inner_text() == 'Gửi Form và đối chiếu kết quả'
    assert page.locator('#qaConsent').locator('..').inner_text().strip() == 'Tôi xác nhận'
    assert page.locator('#qaRunStartOne').inner_text() == '6a. Gửi 1 dòng'
    assert 'Chưa sẵn sàng gửi:' not in page.locator('#qaRunStep').inner_text()
    page.locator('#qaRunStartOne').wait_for(state='visible')
    page.wait_for_function("document.getElementById('qaRunStartOne').disabled===false")
    page.locator('#qaRunStartOne').click()
    page.wait_for_function("document.getElementById('qaRunCounters').textContent.includes('Đã nhận: 1')")
    page.wait_for_function("document.getElementById('qaRunStartAll').disabled===false")
    assert len(submitted)==1
    # Rechecking the plan must preserve its already-confirmed row as sent.
    page.locator('#validatePlanBtn').click()
    page.wait_for_function("document.querySelectorAll('#planTableBody tr')[0].innerText.includes('Đã gửi')",timeout=15000)
    assert '1 đã gửi' in page.locator('#workflowResult').inner_text()
    page.locator('#qaRunStartAll').click()
    page.wait_for_function("document.getElementById('qaRunCounters').textContent.includes('Đã nhận: 2')",timeout=15000)
    page.wait_for_function("document.getElementById('qaRunCounters').textContent.includes('Tăng: 2')",timeout=15000)
    assert len(submitted)==2
    assert 'Tăng: 2' in page.locator('#qaRunCounters').inner_text()
    assert 'Đối chiếu số lượng khớp' in page.locator('#qaRunMessage').inner_text()
    assert 'KHÔNG xác minh từng câu trả lời' in page.locator('#qaRunMessage').inner_text()
    assert page.locator('#qaRunExport').is_enabled()
    with page.expect_download(timeout=15000) as received:
      page.locator('#qaRunExport').click()
    with open(received.value.path(),encoding='utf-8-sig',newline='') as f:
      rows=list(csv.reader(f))
    assert len(rows)==3
    assert rows[0]==['STT','Kết quả Google','Thời điểm trang xác nhận','Ghi chú','Câu trả lời (JSON)']
    assert all(r[1]=='page-confirmed' for r in rows[1:])
    # Regression for a paid user with 70 verified rows and 30 historic attempts:
    # all 40 fresh rows must remain eligible, with arbitrary multi-selection.
    page.locator('.generator-mode[value="fixed"]').first.check()
    page.locator('.fixed-select').first.select_option(label='Có')
    page.locator('#responseCount').fill('70')
    page.locator('#buildPlanBtn').click()
    page.locator('#validatePlanBtn').click()
    page.wait_for_function("document.querySelectorAll('#planTableBody tr .status-chip.success').length===70",timeout=20000)
    # Simulate a saved session record from an earlier version (attempted IDs
    # were persisted, but individual result metadata was not).
    page.evaluate("""() => {
      const bridge=window.PandaStudyQA;
      const raw=JSON.stringify({url:bridge.getUrl(),rows:bridge.getRows().map(row=>row.answers)});
      let hash=2166136261;
      for(let i=0;i<raw.length;i++){
        hash^=raw.charCodeAt(i);hash=Math.imul(hash,16777619);
      }
      const key='pandastudy-qa-attempt:'+((hash>>>0).toString(16));
      const attempted=Array.from({length:30},(_,i)=>i+1);
      sessionStorage.setItem(key,JSON.stringify({
        attempted,operations:{},at:new Date().toISOString()
      }));
    }""")
    # Rebuild the same deterministic plan to trigger session restoration.
    page.locator('#buildPlanBtn').click()
    page.locator('#validatePlanBtn').click()
    page.wait_for_function("document.getElementById('validatePlanBtn').disabled===false",timeout=15000)
    debug = page.evaluate("""() => ({
      success:document.querySelectorAll('#planTableBody tr .status-chip.success').length,
      unknown:[...document.querySelectorAll('#planTableBody tr .status-chip')].filter(n=>n.textContent.includes('Cần đối chiếu')).length,
      summary:document.getElementById('workflowResult').textContent,
      warning:document.getElementById('qaRunMessage').textContent,
      selection:document.getElementById('qaRunStartAll').textContent,
      sessionKeys:Object.keys(sessionStorage).filter(k=>k.startsWith('pandastudy-qa-attempt:')).length
    })""")
    assert debug['success'] == 40 and debug['unknown'] == 30,debug
    assert page.locator('.plan-row-checkbox[data-row-index="1"]').is_disabled()
    assert page.locator('.plan-row-checkbox[data-row-index="30"]').is_disabled()
    assert page.locator('.plan-row-checkbox[data-row-index="31"]').is_checked()
    assert page.locator('.plan-row-checkbox[data-row-index="70"]').is_checked()
    assert '40 dòng' in page.locator('#qaRunStartAll').inner_text()
    assert '40 chưa gửi' in page.locator('#workflowResult').inner_text()
    page.locator('#planSelectAll').uncheck()
    assert 'Chưa chọn' not in page.locator('#qaRunStartAll').inner_text()
    page.locator('.plan-row-checkbox[data-row-index="31"]').check()
    page.locator('.plan-row-checkbox[data-row-index="32"]').check()
    assert '2 dòng đã chọn' in page.locator('#qaRunStartAll').inner_text()
    page.locator('#qaRunStartAll').click()
    page.wait_for_function("document.getElementById('qaRunCounters').textContent.includes('Đã nhận: 2')",timeout=20000)
    assert len(submitted)==4
    assert len(set(submitted_operations))==4,submitted_operations
    assert page.locator('.plan-row-checkbox[data-row-index="31"]').is_disabled()
    assert page.locator('.plan-row-checkbox[data-row-index="32"]').is_disabled()
    # Re-checking again must not offer the confirmed rows for re-submission.
    page.locator('#validatePlanBtn').click()
    page.wait_for_function("document.querySelectorAll('#planTableBody tr .status-chip.success').length===40",timeout=20000)
    assert page.locator('.plan-row-checkbox[data-row-index="31"]').is_disabled()
    assert 'Đã gửi' in page.locator('#planTableBody tr').nth(30).inner_text()
    page.locator('#planSelectAll').check()
    assert '38 dòng đã chọn' in page.locator('#qaRunStartAll').inner_text()
    assert len(submitted)==4,'Selecting remaining rows must not dispatch until clicked'
    assert not errors,errors
    browser.close()
    print('PASS: QA 1-row + remaining rows, Sheet count delta, CSV, confirmation, no real Google writes.')
finally:
  http.shutdown()
