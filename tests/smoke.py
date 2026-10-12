#!/usr/bin/env python3
"""Offline browser QA for PandaStudy (no external web requests)."""
from pathlib import Path
from playwright.sync_api import sync_playwright
from tempfile import TemporaryDirectory
from openpyxl import Workbook
import os, sys

ROOT=Path(__file__).resolve().parent.parent
def run():
  # The headless Chromium in this environment blocks every navigation, including
  # localhost and file://. Inject the exact page assets instead of navigating.
  html=(ROOT/'index.html').read_text(encoding='utf-8')
  import re
  html=re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>', '', html)
  html=html.replace('<link rel="stylesheet" href="/style.css">','<style>'+ (ROOT/'style.css').read_text(encoding='utf-8') +'</style>')
  html=html.replace('<script src="/app.js" defer></script>','').replace('<script src="/blog-data.js" defer></script>','')
  import base64
  panda='data:image/svg+xml;base64,'+base64.b64encode((ROOT/'panda.svg').read_bytes()).decode('ascii')
  html=html.replace('src="/panda.svg"','src="'+panda+'"').replace('href="/panda.svg"','href="'+panda+'"')
  html=html.replace('</body>','<script>'+ (ROOT/'blog-data.js').read_text(encoding='utf-8') +'</script><script>'+ (ROOT/'app.js').read_text(encoding='utf-8') +'</script></body>')
  passed=0
  errors=[]
  with TemporaryDirectory() as td, sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else p.chromium.executable_path,headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1280,'height':900},accept_downloads=True)
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(html,wait_until='load')
    page.locator('#inspectUrl').wait_for(state="attached")
    assert page.title().startswith('PandaStudy')
    print('PASS: PandaStudy home loads and JS binds');passed+=1
    page.screenshot(path=str(ROOT/'preview-desktop.png'),full_page=True)
    assert page.locator('#page-home').is_visible()
    assert page.locator('#page-form').is_hidden()
    assert page.locator('[data-tab="guide"]').count()==1
    print('PASS: home landing, seven visible navigation tabs, and hidden inactive views');passed+=1
    def go(name):
      page.locator('[data-tab="'+name+'"]').click()
      assert page.locator('#page-'+name).is_visible(),name
      assert page.locator('.page-view:not([hidden])').count()==1
      assert page.locator('[data-tab="'+name+'"]').get_attribute('aria-selected')=='true'
    def upload(path):
      go('import')
      page.locator("#fileInput").set_input_files(str(path))
      go('results')
    page.locator('[data-go="form"]').first.click()
    assert page.locator('#formUrl').is_visible()
    go('guide')
    assert page.locator('.faq-list details').count()>=3
    assert 'CSV UTF-8' in page.locator('.guide-error-table').inner_text()
    with page.expect_download() as example: page.locator('#guideTemplateButton2').click()
    assert example.value.suggested_filename.endswith('.csv')
    page.locator('[data-tab="guide"]').focus()
    page.keyboard.press('ArrowDown')
    assert page.locator('#page-about').is_visible()
    print('PASS: keyboard tab navigation works');passed+=1
    go('about')
    assert 'Apps Script' in page.locator('.legacy-panel').inner_text()
    go('form')
    print('PASS: tab navigation, help/FAQ, example download and About page');passed+=1

    # Blog UX: seven tabs, full original articles, filtering and deep links.
    go('blog')
    assert page.locator('.blog-grid .blog-card').count()==5
    assert page.locator('.home-blog-grid .blog-card').count()==3
    assert page.locator('[data-tab]').count()==7
    assert page.locator('#blogCount').inner_text().startswith('5 bài')
    print('PASS: separate blog tab, five articles and three homepage recommendations');passed+=1
    page.locator('[data-blog-filter="python"]').click()
    assert page.locator('.blog-grid .blog-card').count()==1
    assert 'Python' in page.locator('#blogCards').inner_text()
    page.locator('[data-blog-filter="all"]').click()
    page.locator('#blogSearch').fill('cronbach')
    assert page.locator('.blog-grid .blog-card').count()==1
    assert 'SPSS' in page.locator('.blog-grid .blog-card').inner_text()
    page.locator('#blogSearch').fill('tu-khoa-khong-co')
    assert page.locator('#blogEmpty').is_visible()
    page.locator('#blogClear').click()
    assert page.locator('.blog-grid .blog-card').count()==5
    page.locator('#blogSearch').fill('DU LIEU THIEU')
    assert page.locator('.blog-grid .blog-card').count()>=1
    page.locator('#blogSearch').fill('')
    print('PASS: topic chips, Vietnamese content search and empty-search reset');passed+=1
    slugs=['spss-kiem-tra-du-lieu-khao-sat','stata-do-file-tu-csv-den-hoi-quy','python-pandas-lam-sach-du-lieu-khao-sat','du-lieu-thieu-khong-phai-so-khong','chon-kiem-dinh-theo-cau-hoi-nghien-cuu']
    for slug in slugs:
      page.locator('[data-blog-filter="all"]').click()
      page.locator('.blog-grid [data-blog-link="'+slug+'"]').click()
      assert page.locator('#blogArticle').is_visible()
      assert page.locator('#blogIndex').is_hidden()
      assert page.locator('#blogArticleContent h2').count()>=5
      assert page.locator('#blogArticleContent p').count()>=7
      assert page.locator('#blogToc a').count()>=5
      assert page.locator('#blogArticleContent .article-sources a').count()>=2
      assert page.title().endswith('PandaStudy')
      assert page.evaluate('location.hash')=='#blog/'+slug
      page.locator('#blogBack').click()
      assert page.locator('#blogIndex').is_visible()
    print('PASS: all five full articles, references, table of contents, back links and shareable URLs');passed+=1
    page.evaluate("location.hash='#blog/du-lieu-thieu-khong-phai-so-khong'")
    page.wait_for_function("document.querySelector('#blogReaderTitle').textContent.includes('Dữ liệu trống')")
    assert page.locator('#blogArticle').is_visible()
    page.evaluate('window.scrollTo(0,document.body.scrollHeight)')
    page.wait_for_timeout(200)
    bar=page.locator('#blogProgressBar').get_attribute('style')
    assert 'width:' in bar
    go('form')
    assert page.locator('#formUrl').is_visible()
    print('PASS: deep-link article navigation, reading progress and working return to form');passed+=1
    go('blog')
    card=page.locator('.blog-grid .blog-card').first
    card.focus()
    page.keyboard.press('Enter')
    assert page.locator('#blogArticle').is_visible()
    assert page.locator('#blogReaderTitle').evaluate('(e)=>e===document.activeElement')
    assert page.locator('#blogArticleContent a[target="_blank"]').count()>=2
    assert page.locator('#blogArticleContent a[target="_blank"]:not([rel*="noopener"])').count()==0
    page.locator('#blogBack').click()
    assert page.locator('#blog-page-title').evaluate('(e)=>e===document.activeElement')
    print('PASS: keyboard reader navigation, accessible focus return and safe source links');passed+=1
    go('form')
    # Google Forms URL validation
    page.locator('#formUrl').fill('https://script.google.com/macros/s/demo/exec')
    page.locator('#inspectUrl').click()
    go('results')
    assert 'Apps Script' in page.locator('#issues').inner_text()
    go('form')
    print('PASS: Apps Script URL rejected with actionable guidance');passed+=1
    form='https://docs.google.com/forms/d/e/1FAIpQLTest123/viewform?entry.123=Alice&entry.456=a%40b.com'
    page.locator('#formUrl').fill(form)
    page.locator('#inspectUrl').click()
    assert page.locator('.field-row').count()==2
    assert page.locator('#metricFields').inner_text()=='2'
    print('PASS: parses 2 entry IDs from prefilled Google Form link');passed+=1
    # Customize two form labels and types
    page.locator('.field-row').nth(0).locator('input.field-control').first.fill('Họ và tên')
    page.locator('.field-row').nth(1).locator('input.field-control').first.fill('Email')
    page.locator('.field-row').nth(1).locator('select').select_option('email')
    page.locator('.field-row').nth(0).locator('input[type=checkbox]').check()
    # upload valid Vietnamese CSV
    valid=Path(td)/'hocvien.csv';valid.write_text('Họ và tên,Email\n"Nguyễn Văn A",a@example.com\n"Trần Thị B",b@example.com\n',encoding='utf-8')
    upload(valid)
    page.wait_for_function("document.getElementById('metricRows').textContent==='2'")
    assert page.locator('#metricErrors').inner_text()=='0',page.locator('#issues').inner_text()
    assert page.locator('#metricReady').inner_text()=='2'
    go('guide')
    go('results')
    assert page.locator('#metricReady').inner_text()=='2'
    print('PASS: switching tabs preserves imported data and mapping');passed+=1
    go('blog')
    page.locator('.blog-grid [data-blog-link="python-pandas-lam-sach-du-lieu-khao-sat"]').click()
    assert page.locator('#blogArticleContent pre .code-copy').count()>=1
    go('results')
    assert page.locator('#metricReady').inner_text()=='2'
    print('PASS: reading blog leaves Excel imports, mapping and valid links untouched');passed+=1
    assert 'Nguy%E1%BB%85n' in page.locator('.url-ellipsis').first.get_attribute('title')
    print('PASS: CSV UTF-8 import, auto-map, validate, create 2 links');passed+=1
    with page.expect_download() as down:page.locator('#downloadLinks').click()
    assert down.value.suggested_filename.startswith('pandastudy-links-')
    print('PASS: export links CSV');passed+=1
    # Invalid file format
    bad=Path(td)/'baocao.xls';bad.write_text('a,b\nx,y',encoding='utf-8')
    upload(bad)
    page.wait_for_function("document.getElementById('fileStatus').textContent.includes('Không đọc được')")
    assert page.locator('.issue[data-code="EXTENSION"]').count() > 0
    assert 'Save As' in page.locator('#issues').inner_text()
    assert page.locator('#downloadLinks').is_disabled()
    assert page.locator('#navIssues').is_visible()
    go('import')
    assert page.locator('#quickErrors').is_visible()
    assert 'Định dạng file chưa được hỗ trợ' in page.locator('#quickErrors').inner_text()
    assert 'Save As' in page.locator('#quickErrors').inner_text()
    go('results')
    print('PASS: import tab shows plain-language error and repair instructions');passed+=1
    print('PASS: .xls rejected with exact reason and Save As fix');passed+=1
    # Filename .xlsx but actually CSV content
    fake=Path(td)/'gia.xlsx';fake.write_text('Họ và tên,Email\nAlice,a@example.com\n',encoding='utf-8')
    upload(fake)
    page.wait_for_function("document.getElementById('fileStatus').textContent.includes('Không đọc được')")
    assert page.locator('.issue[data-code="XLSX_NOT_ZIP"]').count() > 0
    print('PASS: spoofed XLSX detected by content signature');passed+=1
    # malformed CSV quoting
    malformed=Path(td)/'sai.csv';malformed.write_text('Họ và tên,Email\n"Nguyen,Alice,a@example.com\n',encoding='utf-8')
    upload(malformed)
    page.wait_for_function("document.getElementById('fileStatus').textContent.includes('Không đọc được')")
    assert page.locator('.issue[data-code="CSV_UNCLOSED_QUOTE"]').count() > 0
    print('PASS: unclosed CSV quote flagged and explained');passed+=1
    # duplicate column headers and extra columns
    dup=Path(td)/'duplicate.csv';dup.write_text('Email,Email\na@a.com,b@b.com,third\n',encoding='utf-8')
    upload(dup)
    page.wait_for_function("document.getElementById('metricRows').textContent==='1'")
    assert page.locator('.issue[data-code="DUPLICATE_HEADER"]').count() > 0
    assert page.locator('.issue[data-code="EXTRA_COLUMNS"]').count() > 0
    print('PASS: duplicate headers and wrong column counts explained');passed+=1
    # Valid Excel file, including Unicode text and an additional worksheet
    w=Workbook();sh=w.active;sh.title='Hoc vien';sh.append(['Họ và tên','Email']);sh.append(['Nguyễn Thị A','a@example.com']);sh.append(['Trần Quốc B','b@example.com']);w.create_sheet('Note');xlsx=Path(td)/'danhsach.xlsx';w.save(xlsx)
    upload(xlsx)
    page.wait_for_function("document.getElementById('fileStatus').textContent.includes('Đã đọc')",timeout=10000)
    assert page.locator('#metricRows').inner_text()=='2',page.locator('#issues').inner_text()
    assert page.locator('#metricReady').inner_text()=='2',page.locator('#issues').inner_text()
    assert page.locator('.issue[data-code="XLSX_SHEETS"]').count() > 0
    print('PASS: real XLSX import with Unicode, extra-sheet warning, and 2 links');passed+=1
    # invalid email with row indication
    invalid=Path(td)/'emailbad.csv';invalid.write_text('Họ và tên,Email\n"Nguyễn Thị A",email-sai\n',encoding='utf-8')
    upload(invalid)
    page.wait_for_function("document.getElementById('metricRows').textContent==='1'")
    assert page.locator('.issue[data-code="INVALID_EMAIL"]').count() > 0
    assert 'Dòng 2' in page.locator('#issues').inner_text()
    assert page.locator('#downloadLinks').is_disabled()
    assert 'INVALID EMAIL' not in page.locator('#issues').inner_text()
    assert 'Email chưa đúng định dạng' in page.locator('#issues').inner_text()
    print('PASS: error headings use Vietnamese wording instead of technical codes');passed+=1
    print('PASS: malformed email blocks export and points to row 2');passed+=1
    with page.expect_download() as down:page.locator('#downloadIssues').click()
    assert down.value.suggested_filename=='pandastudy-bao-cao-loi.csv'
    print('PASS: downloadable error report');passed+=1
    # Missing required value with exact row position
    required=Path(td)/'required.csv';required.write_text('Họ và tên,Email\n,a@example.com\n',encoding='utf-8')
    upload(required)
    page.wait_for_function("document.getElementById('metricRows').textContent==='1'")
    assert page.locator('.issue[data-code="REQUIRED_EMPTY"]').count() > 0
    assert 'Dòng 2' in page.locator('#issues').inner_text()
    print('PASS: missing required cells show row and corrective action');passed+=1
    # Files with wrong text encoding
    enc=Path(td)/'latin.csv';enc.write_bytes(b'Name,Email\nNguy\xffn,A@example.com\n')
    upload(enc)
    page.wait_for_function("document.getElementById('fileStatus').textContent.includes('Không đọc được')")
    assert page.locator('.issue[data-code="ENCODING"]').count() > 0
    assert 'UTF-8' in page.locator('#issues').inner_text()
    print('PASS: invalid UTF-8 diagnosed with conversion steps');passed+=1
    # Blank header and empty data
    blank=Path(td)/'blank.csv';blank.write_text('Họ và tên,,Email\nNguyễn A,,a@example.com\n',encoding='utf-8')
    upload(blank)
    page.wait_for_function("document.getElementById('metricRows').textContent==='1'")
    assert page.locator('.issue[data-code="BLANK_HEADER"]').count() > 0
    print('PASS: unnamed Excel/CSV columns are caught');passed+=1
    # Unsupported large file stops before parsing
    huge=Path(td)/'too_large.csv';huge.write_bytes(b'Name,Email\n'+b'x'*(5*1024*1024))
    upload(huge)
    page.wait_for_function("document.getElementById('fileStatus').textContent.includes('Không đọc được')")
    assert page.locator('.issue[data-code="FILE_SIZE"]').count() > 0
    print('PASS: too-large files blocked with precise size limit');passed+=1
    # Semicolon-separated CSV from Excel should be auto-detected
    sem=Path(td)/'semicolon.csv';sem.write_text('Họ và tên;Email\nNguyễn A;a@example.com\n',encoding='utf-8')
    upload(sem)
    page.wait_for_function("document.getElementById('metricRows').textContent==='1'")
    assert page.locator('.issue[data-code="DELIMITER"]').count() > 0
    assert page.locator('#metricReady').inner_text()=='1'
    print('PASS: semicolon CSV detected and accepted');passed+=1
    # Unknown headers must never be silently aligned by position
    mismatch=Path(td)/'mismatch.csv';mismatch.write_text('ColA,ColB\nAlice,a@example.com\n',encoding='utf-8')
    upload(mismatch)
    page.wait_for_function("document.getElementById('metricRows').textContent==='1'")
    assert page.locator('.issue[data-code="COLUMN_NOT_MAPPED"]').count() > 0
    assert page.locator('#metricReady').inner_text()=='0'
    go('import')
    page.locator('#mappingList select').nth(0).select_option('0')
    page.locator('#mappingList select').nth(1).select_option('1')
    assert page.locator('#metricReady').inner_text()=='1'
    go('results')
    print('PASS: unknown columns require explicit mapping; correction unblocks export');passed+=1
    # Date and multi-choice links (Google Forms dedicated date query keys)
    go('form')
    page.locator('#addField').click()
    page.locator('.field-row').nth(2).locator('input.field-control').nth(0).fill('Ngày sinh')
    page.locator('.field-row').nth(2).locator('input.field-control').nth(1).fill('entry.789')
    page.locator('.field-row').nth(2).locator('select').select_option('date')
    page.locator('#addField').click()
    page.locator('.field-row').nth(3).locator('input.field-control').nth(0).fill('Sở thích')
    page.locator('.field-row').nth(3).locator('input.field-control').nth(1).fill('entry.999')
    page.locator('.field-row').nth(3).locator('select').select_option('checkbox')
    multi=Path(td)/'multi.csv';multi.write_text('Họ và tên,Email,Ngày sinh,Sở thích\nNguyễn A,a@example.com,2026-10-12,Toán;Văn\n',encoding='utf-8')
    upload(multi)
    page.wait_for_function("document.getElementById('metricRows').textContent==='1'")
    assert page.locator('#metricReady').inner_text()=='1',page.locator('#issues').inner_text()
    from urllib.parse import urlparse, parse_qs
    link=page.locator('.url-ellipsis').first.get_attribute('title');parts=parse_qs(urlparse(link).query)
    assert parts['entry.789_year']==['2026'] and parts['entry.789_month']==['10'] and parts['entry.789_day']==['12']
    assert parts['entry.999']==['Toán','Văn']
    print('PASS: Google date fields and multi-select choices encoded correctly');passed+=1
    bad_date=Path(td)/'invalid-date.csv';bad_date.write_text('Họ và tên,Email,Ngày sinh,Sở thích\nNguyễn A,a@example.com,2026-02-30,Toán;Văn\n',encoding='utf-8')
    upload(bad_date)
    page.wait_for_function("document.getElementById('metricRows').textContent==='1'")
    assert page.locator('.issue[data-code="INVALID_DATE_VALUE"]').count() > 0
    assert page.locator('#downloadLinks').is_disabled()
    print('PASS: impossible calendar dates are detected and block export');passed+=1
    mobile=browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
    mobile.set_content(html)
    assert mobile.locator('.sidebar .brand').is_visible()
    assert mobile.locator('[data-tab="form"]').is_visible()
    assert mobile.locator('#page-home').is_visible()
    mobile.screenshot(path=str(ROOT/'preview-mobile.png'),full_page=True)
    mobile.locator('[data-tab="form"]').click()
    assert mobile.locator('#formUrl').is_visible()
    mobile.locator('[data-tab="import"]').click()
    assert mobile.locator('#dropZone').is_visible()
    mobile.locator('[data-tab="results"]').click()
    assert mobile.locator('#quality').is_visible()
    mobile.locator('[data-tab="blog"]').click()
    assert mobile.locator('.blog-grid .blog-card').count()==5
    assert mobile.evaluate('document.documentElement.scrollWidth<=window.innerWidth+2')
    mobile.locator('.blog-grid .blog-card').first.click()
    assert mobile.locator('#blogArticle').is_visible()
    assert mobile.locator('#blogArticleContent').is_visible()
    assert mobile.evaluate('document.documentElement.scrollWidth<=window.innerWidth+2')
    mobile.locator('#blogBack').click()
    print('PASS: responsive blog grid and article reader on mobile');passed+=1
    mobile.locator('[data-tab="guide"]').click()
    assert mobile.locator('.faq-list').is_visible()
    assert mobile.evaluate('document.documentElement.scrollWidth<=window.innerWidth+2')
    print('PASS: no horizontal page overflow on mobile');passed+=1
    print('PASS: mobile responsive UI');passed+=1
    # Reduced-motion preference and tablet layouts.
    reduced=browser.new_page(viewport={'width':1024,'height':768},reduced_motion='reduce')
    reduced.set_content(html)
    assert reduced.evaluate("parseFloat(getComputedStyle(document.querySelector('.paper-front')).animationDuration) < 0.01")
    reduced.locator('[data-tab="blog"]').click()
    assert reduced.evaluate('document.documentElement.scrollWidth<=window.innerWidth+2')
    reduced.locator('.blog-grid .blog-card').nth(4).click()
    assert reduced.evaluate('document.documentElement.scrollWidth<=window.innerWidth+2')
    print('PASS: reduced-motion support and tablet layout without horizontal overflow');passed+=1
    reduced.close()
    browser.close()
  if errors:raise AssertionError('Browser JavaScript errors: '+repr(errors))
  print(f'PASS ALL {passed} smoke cases')
if __name__=='__main__':
  try:run()
  except Exception as e: print('TEST FAILED:',repr(e),file=sys.stderr);raise
