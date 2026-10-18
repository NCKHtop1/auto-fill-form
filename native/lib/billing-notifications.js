'use strict';

const crypto = require('node:crypto');
const db = require('./billing-db');
const billing = require('./billing');
const LEASE_SECONDS = 120;
// Resend retains idempotency keys for 24 hours. Stop uncertain delivery before
// that window ends; an old ambiguous message must not be blindly sent again.
const IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1000;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
}
function siteOrigin() {
  const value = process.env.BILLING_PUBLIC_SITE_URL || process.env.PUBLIC_SITE_URL || 'https://auto-fill-form-liard.vercel.app';
  let url;
  try { url = new URL(value); } catch (_) { throw new billing.BillingError(503,'BILLING_SITE_UNAVAILABLE','Đường dẫn quản trị chưa được cấu hình.'); }
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV === 'test' && url.hostname === 'localhost'))
    throw new billing.BillingError(503,'BILLING_SITE_UNAVAILABLE','Đường dẫn quản trị chưa được cấu hình.');
  return url.origin;
}
function renderMessage(row) {
  const payload = row.payload_json;
  const adminUrl = new URL('/admin-topups.html',siteOrigin());
  adminUrl.searchParams.set('orderId',row.order_id);
  const amount = Number(payload.amountVnd).toLocaleString('vi-VN') + ' VND';
  const subject = `[PandaStudy] Yêu cầu nạp ${payload.orderCode} chờ đối soát`;
  const lines = [
    'Người dùng báo đã chuyển khoản. Hãy kiểm tra khoản tiền thực nhận tại ngân hàng trước khi duyệt.',
    `Mã yêu cầu: ${payload.orderCode}`,
    `Tài khoản PandaStudy: ${payload.customerEmail}`,
    `Số tiền cần đối soát: ${amount}`,
    `Số lượt sẽ cộng khi được duyệt: ${payload.quantity}`,
    `Nội dung chuyển khoản: ${payload.paymentMemo}`,
    `Tài khoản nhận: ${payload.bank.bankName} ${payload.bank.accountNumber} - ${payload.bank.accountName}`,
    `Mở trang quản trị: ${adminUrl.toString()}`,
    'Email này chưa xác nhận tiền đã về. Mở liên kết không tự duyệt hoặc cộng lượt.'
  ];
  return {from:process.env.BILLING_EMAIL_FROM,to:[row.recipient],subject,text:lines.join('\n\n'),
    html:'<div style="font-family:Arial,sans-serif;max-width:640px;line-height:1.6">'+
      '<h2>PandaStudy · Chờ đối soát chuyển khoản</h2>'+lines.slice(0,7).map(line=>'<p>'+escapeHtml(line)+'</p>').join('')+
      '<p><a href="'+escapeHtml(adminUrl.toString())+'">Mở yêu cầu trong trang quản trị</a></p><p>'+escapeHtml(lines[8])+'</p></div>'};
}

async function claimOne() {
  return db.transaction(async client => {
    const selected = await client.query(`SELECT * FROM ps_billing_outbox WHERE
      (status IN ('pending','retry') AND next_attempt_at<=now()) OR
      (status='sending' AND lease_expires_at<now())
      ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`);
    if (!selected.rowCount) return null;
    const row = selected.rows[0];
    const uncertain = row.delivery_uncertain || row.status === 'sending';
    if (uncertain && row.first_attempt_at && Date.now()-new Date(row.first_attempt_at).getTime()>=IDEMPOTENCY_WINDOW_MS) {
      await client.query(`UPDATE ps_billing_outbox SET status='failed',failure_code='DELIVERY_UNCERTAIN_EXPIRED',
        delivery_uncertain=true,lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1`,[row.id]);
      return {skipped:true};
    }
    const leaseToken = crypto.randomUUID();
    // Freeze the exact provider payload on first dispatch so retries have the
    // same idempotency key AND body, even after config or application changes.
    const message = row.message_json || renderMessage(row);
    const updated = await client.query(`UPDATE ps_billing_outbox SET status='sending',attempts=attempts+1,
      lease_token=$2,lease_expires_at=now()+($3::text||' seconds')::interval,
      first_attempt_at=COALESCE(first_attempt_at,now()),last_attempt_at=now(),
      message_json=$4::jsonb,delivery_uncertain=$5,updated_at=now() WHERE id=$1 RETURNING *`,
    [row.id,leaseToken,LEASE_SECONDS,JSON.stringify(message),uncertain]);
    return updated.rows[0];
  });
}

async function sendViaResend(row, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl('https://api.resend.com/emails',{
      method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type':'application/json','Idempotency-Key':`pandastudy-topup-${row.id}`},
      body:JSON.stringify(row.message_json),signal:AbortSignal.timeout(8000)
    });
  } catch (_) { return {ok:false,retryable:true,uncertain:true,code:'PROVIDER_CONNECTION_UNKNOWN'}; }
  if (!response.ok) {
    const retryable = response.status===429 || response.status>=500;
    return {ok:false,retryable,uncertain:response.status>=500 || response.status===409,code:`PROVIDER_HTTP_${response.status}`};
  }
  const body = await response.json().catch(()=>null);
  if (!body || typeof body.id !== 'string') return {ok:false,retryable:true,uncertain:true,code:'PROVIDER_RESULT_UNKNOWN'};
  return {ok:true,messageId:body.id};
}

async function finishClaim(row, result) {
  if (result.ok) {
    await db.query(`UPDATE ps_billing_outbox SET status='sent',provider_message_id=$3,sent_at=now(),
      failure_code=NULL,delivery_uncertain=false,lease_token=NULL,lease_expires_at=NULL,updated_at=now()
      WHERE id=$1 AND lease_token=$2 AND status='sending'`,[row.id,row.lease_token,result.messageId]);
    return;
  }
  const delay = Math.min(3600,15*2**Math.min(row.attempts,8));
  await db.query(`UPDATE ps_billing_outbox SET status=$3,failure_code=$4,delivery_uncertain=delivery_uncertain OR $5,
    next_attempt_at=now()+($6::text||' seconds')::interval,lease_token=NULL,lease_expires_at=NULL,updated_at=now()
    WHERE id=$1 AND lease_token=$2 AND status='sending'`,
  [row.id,row.lease_token,result.retryable?'retry':'failed',result.code,!!result.uncertain,delay]);
}

async function drainOutbox(options = {}) {
  billing.assertReady();
  const limit = Math.min(10,Math.max(1,Number.isInteger(options.limit)?options.limit:2));
  if (options.send && process.env.NODE_ENV !== 'test') throw new Error('Notification test senders are disabled outside tests.');
  const send = options.send || sendViaResend;
  const summary = {claimed:0,sent:0,retry:0,failed:0};
  for (let index=0;index<limit;index++) {
    const row = await claimOne();
    if (!row) break;
    if (row.skipped) { summary.failed++; continue; }
    summary.claimed++;
    let outcome;
    try { outcome = await send(row); }
    catch (_) { outcome = {ok:false,retryable:true,uncertain:true,code:'PROVIDER_CONNECTION_UNKNOWN'}; }
    await finishClaim(row,outcome);
    if (outcome.ok) summary.sent++;
    else if (outcome.retryable) summary.retry++;
    else summary.failed++;
  }
  return summary;
}

async function retryNotifications(identity) {
  billing.requireAdmin(identity); billing.assertReady();
  const result = await db.query(`UPDATE ps_billing_outbox SET status='retry',next_attempt_at=now(),updated_at=now()
    WHERE status IN ('failed','retry') AND
      (NOT delivery_uncertain OR first_attempt_at>now()-interval '23 hours') RETURNING id`);
  return {requeued:result.rowCount};
}

function cronAuthorized(req) {
  const supplied = Buffer.from(String(req.headers.authorization || ''));
  return [process.env.BILLING_CRON_SECRET,process.env.CRON_SECRET].some(secret => {
    if (!secret || secret.length<32) return false;
    const expected = Buffer.from(`Bearer ${secret}`);
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied,expected);
  });
}

module.exports = {drainOutbox,retryNotifications,cronAuthorized,sendViaResend,renderMessage};
