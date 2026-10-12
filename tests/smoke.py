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
  html=html.replace('<script src="/app.js" defer></script>','')
  import base64
  panda='data:image/svg+xml;base64,'+base64.b64encode((ROOT/'panda.svg').read_bytes()).decode('ascii')
  html=html.replace('src="/panda.svg"','src="'+panda+'"').replace('href="/panda.svg"','href="'+panda+'"')
  html=html.replace('</body>','<script>'+ (ROOT/'app.js').read_text(encoding='utf-8') +'</script></body>')
  passed=0
  errors=[]
  with TemporaryDirectory() as td, sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else p.chromium.executable_path,headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1280,'height':900},accept_downloads=True)
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(html,wait_until='load')
    page.locator('#inspectUrl').wait_for()
    assert page.title().startswith('PandaStudy')
    print('PASS: PandaStudy home loads and JS binds');passed+=1
    page.screenshot(path=str(ROOT/'preview-desktop.png'),full_page=True)
    # Google Forms URL validation
    page.locator('#formUrl').fill('https://script.google.com/macros/s/demo/exec')
    page.locator('#inspectUrl').click()
    assert 'Apps Script' in page.locator('#issues').inner_text()
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
    page.locator('#fileInput').set_input_files(str(valid))
    page.wait_for_function("document.getElementById('metricRows').textContent==='2'")
    assert page.locator('#metricErrors').inner_text()=='0',page.locator('#issues').inner_text()
    assert page.locator('#metricReady').inner_text()=='2'
    assert 'Nguy%E1%BB%85n' in page.locator('.url-ellipsis').first.get_attribute('title')
    print('PASS: CSV UTF-8 import, auto-map, validate, create 2 links');passed+=1
    with page.expect_download() as down:page.locator('#downloadLinks').click()
    assert down.value.suggested_filename.startswith('pandastudy-links-')
    print('PASS: export links CSV');passed+=1
    # Invalid file format
    bad=Path(td)/'baocao.xls';bad.write_text('a,b\nx,y',encoding='utf-8')
    page.locator('#fileInput').set_input_files(str(bad))
    page.wait_for_function("document.getElementById('fileStatus').textContent.includes('Không đọc được')")
    assert 'EXTENSION' in page.locator('#issues').inner_text()
    assert 'Save As' in page.locator('#issues').inner_text()
    assert page.locator('#downloadLinks').is_disabled()
    print('PASS: .xls rejected with exact reason and Save As fix');passed+=1
    # Filename .xlsx but actually CSV content
    fake=Path(td)/'gia.xlsx';fake.write_text('Họ và tên,Email\nAlice,a@example.com\n',encoding='utf-8')
    page.locator('#fileInput').set_input_files(str(fake))
    page.wait_for_function("document.getElementById('fileStatus').textContent.includes('Không đọc được')")
    assert 'XLSX NOT ZIP' in page.locator('#issues').inner_text()
    print('PASS: spoofed XLSX detected by content signature');passed+=1
    # malformed CSV quoting
    malformed=Path(td)/'sai.csv';malformed.write_text('Họ và tên,Email\n"Nguyen,Alice,a@example.com\n',encoding='utf-8')
    page.locator('#fileInput').set_input_files(str(malformed))
    page.wait_for_function("document.getElementById('fileStatus').textContent.includes('Không đọc được')")
    assert 'CSV UNCLOSED QUOTE' in page.locator('#issues').inner_text()
    print('PASS: unclosed CSV quote flagged and explained');passed+=1
    # duplicate column headers and extra columns
    dup=Path(td)/'duplicate.csv';dup.write_text('Email,Email\na@a.com,b@b.com,third\n',encoding='utf-8')
    page.locator('#fileInput').set_input_files(str(dup))
    page.wait_for_function("document.getElementById('metricRows').textContent==='1'")
    assert 'DUPLICATE HEADER' in page.locator('#issues').inner_text()
    assert 'EXTRA COLUMNS' in page.locator('#issues').inner_text()
    print('PASS: duplicate headers and wrong column counts explained');passed+=1
    # Valid Excel file, including Unicode text and an additional worksheet
    w=Workbook();sh=w.active;sh.title='Hoc vien';sh.append(['Họ và tên','Email']);sh.append(['Nguyễn Thị A','a@example.com']);sh.append(['Trần Quốc B','b@example.com']);w.create_sheet('Note');xlsx=Path(td)/'danhsach.xlsx';w.save(xlsx)
    page.locator('#fileInput').set_input_files(str(xlsx))
    page.wait_for_function("document.getElementById('fileStatus').textContent.includes('Đã đọc')",timeout=10000)
    assert page.locator('#metricRows').inner_text()=='2',page.locator('#issues').inner_text()
    assert page.locator('#metricReady').inner_text()=='2',page.locator('#issues').inner_text()
    assert 'XLSX SHEETS' in page.locator('#issues').inner_text()
    print('PASS: real XLSX import with Unicode, extra-sheet warning, and 2 links');passed+=1
    # invalid email with row indication
    invalid=Path(td)/'emailbad.csv';invalid.write_text('Họ và tên,Email\n"Nguyễn Thị A",email-sai\n',encoding='utf-8')
    page.locator('#fileInput').set_input_files(str(invalid))
    page.wait_for_function("document.getElementById('metricRows').textContent==='1'")
    assert 'INVALID EMAIL' in page.locator('#issues').inner_text()
    assert 'Dòng 2' in page.locator('#issues').inner_text()
    assert page.locator('#downloadLinks').is_disabled()
    print('PASS: malformed email blocks export and points to row 2');passed+=1
    with page.expect_download() as down:page.locator('#downloadIssues').click()
    assert down.value.suggested_filename=='pandastudy-bao-cao-loi.csv'
    print('PASS: downloadable error report');passed+=1
    # Missing required value with exact row position
    required=Path(td)/'required.csv';required.write_text('Họ và tên,Email\n,a@example.com\n',encoding='utf-8')
    page.locator('#fileInput').set_input_files(str(required))
    page.wait_for_function("document.getElementById('metricRows').textContent==='1'")
    assert 'REQUIRED EMPTY' in page.locator('#issues').inner_text()
    assert 'Dòng 2' in page.locator('#issues').inner_text()
    print('PASS: missing required cells show row and corrective action');passed+=1
    # Files with wrong text encoding
    enc=Path(td)/'latin.csv';enc.write_bytes(b'Name,Email\nNguy\xffn,A@example.com\n')
    page.locator('#fileInput').set_input_files(str(enc))
    page.wait_for_function("document.getElementById('fileStatus').textContent.includes('Không đọc được')")
    assert 'ENCODING' in page.locator('#issues').inner_text()
    assert 'UTF-8' in page.locator('#issues').inner_text()
    print('PASS: invalid UTF-8 diagnosed with conversion steps');passed+=1
    # Blank header and empty data
    blank=Path(td)/'blank.csv';blank.write_text('Họ và tên,,Email\nNguyễn A,,a@example.com\n',encoding='utf-8')
    page.locator('#fileInput').set_input_files(str(blank))
    page.wait_for_function("document.getElementById('metricRows').textContent==='1'")
    assert 'BLANK HEADER' in page.locator('#issues').inner_text()
    print('PASS: unnamed Excel/CSV columns are caught');passed+=1
    # Unsupported large file stops before parsing
    huge=Path(td)/'too_large.csv';huge.write_bytes(b'Name,Email\n'+b'x'*(5*1024*1024))
    page.locator('#fileInput').set_input_files(str(huge))
    page.wait_for_function("document.getElementById('fileStatus').textContent.includes('Không đọc được')")
    assert 'FILE SIZE' in page.locator('#issues').inner_text()
    print('PASS: too-large files blocked with precise size limit');passed+=1
    # Semicolon-separated CSV from Excel should be auto-detected
    sem=Path(td)/'semicolon.csv';sem.write_text('Họ và tên;Email\nNguyễn A;a@example.com\n',encoding='utf-8')
    page.locator('#fileInput').set_input_files(str(sem))
    page.wait_for_function("document.getElementById('metricRows').textContent==='1'")
    assert 'DELIMITER' in page.locator('#issues').inner_text()
    assert page.locator('#metricReady').inner_text()=='1'
    print('PASS: semicolon CSV detected and accepted');passed+=1
    # Unknown headers must never be silently aligned by position
    mismatch=Path(td)/'mismatch.csv';mismatch.write_text('ColA,ColB\nAlice,a@example.com\n',encoding='utf-8')
    page.locator('#fileInput').set_input_files(str(mismatch))
    page.wait_for_function("document.getElementById('metricRows').textContent==='1'")
    assert 'COLUMN NOT MAPPED' in page.locator('#issues').inner_text()
    assert page.locator('#metricReady').inner_text()=='0'
    page.locator('#mappingList select').nth(0).select_option('0')
    page.locator('#mappingList select').nth(1).select_option('1')
    assert page.locator('#metricReady').inner_text()=='1'
    print('PASS: unknown columns require explicit mapping; correction unblocks export');passed+=1
    # Date and multi-choice links (Google Forms dedicated date query keys)
    page.locator('#addField').click()
    page.locator('.field-row').nth(2).locator('input.field-control').nth(0).fill('Ngày sinh')
    page.locator('.field-row').nth(2).locator('input.field-control').nth(1).fill('entry.789')
    page.locator('.field-row').nth(2).locator('select').select_option('date')
    page.locator('#addField').click()
    page.locator('.field-row').nth(3).locator('input.field-control').nth(0).fill('Sở thích')
    page.locator('.field-row').nth(3).locator('input.field-control').nth(1).fill('entry.999')
    page.locator('.field-row').nth(3).locator('select').select_option('checkbox')
    multi=Path(td)/'multi.csv';multi.write_text('Họ và tên,Email,Ngày sinh,Sở thích\nNguyễn A,a@example.com,2026-10-12,Toán;Văn\n',encoding='utf-8')
    page.locator('#fileInput').set_input_files(str(multi))
    page.wait_for_function("document.getElementById('metricRows').textContent==='1'")
    assert page.locator('#metricReady').inner_text()=='1',page.locator('#issues').inner_text()
    from urllib.parse import urlparse, parse_qs
    link=page.locator('.url-ellipsis').first.get_attribute('title');parts=parse_qs(urlparse(link).query)
    assert parts['entry.789_year']==['2026'] and parts['entry.789_month']==['10'] and parts['entry.789_day']==['12']
    assert parts['entry.999']==['Toán','Văn']
    print('PASS: Google date fields and multi-select choices encoded correctly');passed+=1
    bad_date=Path(td)/'invalid-date.csv';bad_date.write_text('Họ và tên,Email,Ngày sinh,Sở thích\nNguyễn A,a@example.com,2026-02-30,Toán;Văn\n',encoding='utf-8')
    page.locator('#fileInput').set_input_files(str(bad_date))
    page.wait_for_function("document.getElementById('metricRows').textContent==='1'")
    assert 'INVALID DATE VALUE' in page.locator('#issues').inner_text()
    assert page.locator('#downloadLinks').is_disabled()
    print('PASS: impossible calendar dates are detected and block export');passed+=1
    mobile=browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
    mobile.set_content(html)
    assert mobile.locator('.mobile-brand').is_visible()
    assert mobile.locator('#formUrl').is_visible()
    mobile.screenshot(path=str(ROOT/'preview-mobile.png'),full_page=True)
    print('PASS: mobile responsive UI');passed+=1
    browser.close()
  if errors:raise AssertionError('Browser JavaScript errors: '+repr(errors))
  print(f'PASS ALL {passed} smoke cases')
if __name__=='__main__':
  try:run()
  except Exception as e: print('TEST FAILED:',repr(e),file=sys.stderr);raise
