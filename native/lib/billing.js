'use strict';

const crypto = require('node:crypto');
const db = require('./billing-db');

const UNIT_PRICE_VND = 500;
const MAX_TOPUP_CREDITS = 100000;
const ADMIN_REVIEW_DELAY_MS = 5 * 60 * 1000;

class BillingError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function fail(status, code, message) { throw new BillingError(status, code, message); }
function enabled() { return process.env.BILLING_ENABLED === 'true'; }
function purchasesEnabled() { return enabled() && process.env.BILLING_TOPUPS_PAUSED !== 'true'; }
function validEmail(value) { return typeof value === 'string' && value.length <= 254 && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value); }
function notificationTransportConfigured() {
  const sender = String(process.env.BILLING_EMAIL_FROM || '').trim();
  const senderAddress = sender.match(/<([^<>]+)>$/)?.[1] || sender;
  return !!String(process.env.RESEND_API_KEY || '').trim() && !/[\r\n]/.test(sender) && validEmail(senderAddress);
}
function adminEmails() {
  return String(process.env.BILLING_ADMIN_EMAILS || '').toLowerCase().split(',').map(x => x.trim()).filter(validEmail);
}
function bankConfig() {
  return Object.freeze({
    bankId: String(process.env.BILLING_BANK_ID || '').trim(),
    bankName: String(process.env.BILLING_BANK_NAME || '').trim(),
    accountNumber: String(process.env.BILLING_BANK_ACCOUNT_NUMBER || '').trim(),
    accountName: String(process.env.BILLING_BANK_ACCOUNT_NAME || '').trim()
  });
}
function validBank(bank) {
  const name = (value,max) => value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f<>]/.test(value);
  return /^\d{6}$/.test(bank.bankId) && /^\d{6,34}$/.test(bank.accountNumber) &&
    name(bank.bankName,80) && name(bank.accountName,120);
}
function notificationRecipients() {
  const recipients = String(process.env.BILLING_NOTIFICATION_EMAILS || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
  // Recipients are persisted to the durable outbox even when the mail
  // provider is temporarily unconfigured. This keeps top-up alerts recoverable
  // and lets an admin retry delivery after the transport is restored.
  if (!recipients.length || recipients.length > 10 || !recipients.every(validEmail)) return Object.freeze([]);
  return Object.freeze([...new Set(recipients)]);
}
function siteOrigin() {
  const site = process.env.BILLING_PUBLIC_SITE_URL || process.env.PUBLIC_SITE_URL;
  if (!site) return null;
  try {
    const url = new URL(site);
    const localTest = process.env.NODE_ENV === 'test' && url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !localTest) || url.username || url.password) return null;
    return url.origin;
  } catch (_) { return null; }
}
function qrImageUrl() {
  const value = String(process.env.BILLING_QR_IMAGE_URL || '').trim();
  if (!value || /[\x00-\x20\x7f\\]/.test(value)) return null;
  const origin = siteOrigin();
  try {
    if (value.startsWith('/') && !value.startsWith('//')) {
      const parsed = new URL(value,origin || 'https://billing.invalid');
      return parsed.origin === (origin || 'https://billing.invalid') ? value : null;
    }
    const parsed = new URL(value);
    return origin && parsed.protocol === 'https:' && parsed.origin === origin && !parsed.username && !parsed.password ? value : null;
  } catch (_) { return null; }
}
function verifiedIdentity(identity) {
  if (!identity || typeof identity.sub !== 'string' || !identity.sub.trim() || identity.sub.length > 255 ||
      identity.email_verified !== true || !validEmail(identity.email))
    fail(401, 'BILLING_IDENTITY_REQUIRED', 'Hãy kết nối lại Google để xác minh tài khoản nhận số lượt.');
  return {sub: identity.sub, email: identity.email.toLowerCase(), email_verified: true};
}
function isAdmin(identity) {
  try { return adminEmails().includes(verifiedIdentity(identity).email); } catch (_) { return false; }
}
function requireAdmin(identity) {
  const current = verifiedIdentity(identity);
  if (!isAdmin(current)) fail(403, 'BILLING_ADMIN_REQUIRED', 'Tài khoản này không có quyền quản trị thanh toán.');
  return current;
}
function getConfigStatus() {
  const missing = [], warnings = [];
  if (!process.env.DATABASE_URL) missing.push('database');
  if (!adminEmails().length) missing.push('administrators');
  if (!validBank(bankConfig())) missing.push('bank');
  if (!qrImageUrl()) missing.push('payment_qr');
  const site = process.env.BILLING_PUBLIC_SITE_URL || process.env.PUBLIC_SITE_URL;
  if (!site || !siteOrigin()) missing.push('admin_url');

  // Email is useful but not financial authorization. Manual bank review and
  // the durable ledger must remain usable when a mail provider is unavailable.
  if (!notificationTransportConfigured()) warnings.push('email_notifications');
  if (!notificationRecipients().length) warnings.push('notification_recipients');
  if (![process.env.BILLING_CRON_SECRET,process.env.CRON_SECRET].some(value => String(value || '').length >= 32))
    warnings.push('notification_worker');

  return {billingEnabled: enabled(), configured: !enabled() || missing.length === 0, missing, warnings};
}
function assertReady() {
  const config = getConfigStatus();
  if (!config.billingEnabled) fail(503, 'BILLING_DISABLED', 'Chức năng mua lượt hiện chưa được bật.');
  if (!config.configured) fail(503, 'BILLING_UNAVAILABLE', 'Chức năng mua lượt chưa sẵn sàng. Vui lòng chưa chuyển khoản.');
}
function requestKey(value, field = 'idempotencyKey') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{7,127}$/.test(value))
    fail(400, 'INVALID_REQUEST_KEY', `Thiếu mã thao tác hợp lệ (${field}). Hãy tải lại trang và thử lại.`);
  return value;
}
function uuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    fail(400, 'INVALID_ID', 'Mã yêu cầu không hợp lệ.');
  return value;
}
function textNote(value, min = 0, max = 1000) {
  const note = typeof value === 'string' ? value.trim() : '';
  if (note.length < min || note.length > max) fail(400, 'INVALID_NOTE', `Ghi chú cần từ ${min} đến ${max} ký tự.`);
  return note;
}
function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  fail(400, 'INVALID_PAYLOAD', 'Dữ liệu thao tác không hợp lệ.');
}
function hash(value) { return crypto.createHash('sha256').update(canonical(value)).digest('hex'); }
function number(value) { return Number(value || 0); }
function asDate(value) { return value ? new Date(value).toISOString() : null; }
function customerView(row, identity) { return {id: row.id, email: row.email, isAdmin: isAdmin(identity)}; }
function identityView(identity) {
  const current = verifiedIdentity(identity);
  const digest = crypto.createHash('sha256').update(current.sub).digest('hex').slice(0,24);
  return {id: 'google-' + digest, email: current.email, isAdmin: isAdmin(current)};
}
function accountBank(row) {
  return {bankId: row.bank_id, bankName: row.bank_name, accountNumber: row.account_number, accountName: row.account_name};
}
function orderView(row) {
  const bank = accountBank(row);
  const currentBank = bankConfig();
  const sameBank = Object.keys(bank).every(key => bank[key] === currentBank[key]);
  return {
    id: row.id, orderCode: row.order_code, quantity: row.quantity,
    unitPriceVnd: row.unit_price_vnd, amountVnd: number(row.amount_vnd),
    status: row.status, paymentMemo: row.payment_memo, bank,
    qrImageUrl: purchasesEnabled() && sameBank && ['pending_payment','pending_review'].includes(row.status)
      ? (qrImageUrl() === '/api/payment-qr' ? '/api/payment-qr?orderId=' + encodeURIComponent(row.id) : qrImageUrl()) : null,
    qrHasAmountAndMemo: qrImageUrl() === '/api/payment-qr',
    createdAt: asDate(row.created_at), submittedAt: asDate(row.submitted_at),
    reviewedAt: asDate(row.reviewed_at), adminNote: row.review_note || '',
    ...(row.customer_email ? {customer: {id: row.customer_id, email: row.customer_email}} : {}),
    ...(row.reference_original ? {bankReference: row.reference_original, receivedAmountVnd: number(row.received_amount_vnd)} : {})
  };
}

async function ensureAccount(identity) {
  const current = verifiedIdentity(identity);
  const result = await db.query(`INSERT INTO ps_billing_customers(id,google_sub,email)
    VALUES($1,$2,$3) ON CONFLICT(google_sub) DO UPDATE SET email=EXCLUDED.email,updated_at=now()
    RETURNING *`, [crypto.randomUUID(), current.sub, current.email]);
  return result.rows[0];
}
async function ensureCustomer(identity) {
  assertReady();
  return ensureAccount(identity);
}

async function getProfile(identity = null) {
  const config = getConfigStatus();
  let account = null;
  try { if (identity) account = verifiedIdentity(identity); }
  catch (error) {
    if (!(error instanceof BillingError) || error.status !== 401) throw error;
  }
  let persisted = null;
  if (account && process.env.DATABASE_URL) {
    try {
      const readiness = await db.query('SELECT version FROM ps_billing_schema_migrations WHERE version=1');
      if (readiness.rowCount) persisted = await ensureAccount(account);
    } catch (error) {
      console.error('[PandaStudy account persistence]', error.code || 'UNAVAILABLE');
    }
  }
  const base = {
    billingEnabled: config.billingEnabled, configured: config.configured,
    purchasesEnabled: purchasesEnabled() && config.configured,
    signedIn: !!account, user: persisted ? customerView(persisted, account) : (account ? identityView(account) : null),
    availableCredits: persisted ? number(persisted.available_credits) : 0,
    reservedCredits: persisted ? number(persisted.reserved_credits) : 0,
    unitPriceVnd: UNIT_PRICE_VND, minTopupCredits: 1, maxTopupCredits: MAX_TOPUP_CREDITS,
    bank: null, warnings: config.warnings || []
  };
  if (!config.billingEnabled) return base;
  if (!config.configured) return {...base, message: 'Chức năng mua lượt đang được cấu hình. Vui lòng chưa chuyển khoản.'};
  try {
    const readiness = await db.query('SELECT version FROM ps_billing_schema_migrations WHERE version=1');
    if (!readiness.rowCount) throw new Error('SCHEMA_NOT_READY');
    if (!account) return base;
    const customer = persisted || await ensureAccount(account);
    return {...base, signedIn: true, user: customerView(customer, account),
      availableCredits: number(customer.available_credits), reservedCredits: number(customer.reserved_credits), bank: {...bankConfig()}};
  } catch (error) {
    if (error instanceof BillingError && error.status === 401) return {...base, message: error.message};
    console.error('[PandaStudy billing readiness]', error.code || 'UNAVAILABLE');
    return {...base, configured: false, purchasesEnabled:false, message: 'Dịch vụ số lượt đang tạm gián đoạn. Vui lòng chưa chuyển khoản.'};
  }
}

async function createOrder(identity, input) {
  assertReady();
  if (!purchasesEnabled()) fail(503,'TOPUPS_PAUSED','Mua thêm lượt đang tạm dừng. Các lượt đã mua vẫn được giữ nguyên.');
  const quantity = input?.quantity;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_TOPUP_CREDITS)
    fail(400, 'INVALID_QUANTITY', 'Số lượt cần mua phải là số nguyên từ 1 đến 100.000.');
  const key = requestKey(input.idempotencyKey);
  const customer = await ensureCustomer(identity);
  const bank = bankConfig();
  return db.transaction(async client => {
    await client.query('SELECT id FROM ps_billing_customers WHERE id=$1 FOR UPDATE', [customer.id]);
    const previous = await client.query('SELECT * FROM ps_billing_orders WHERE customer_id=$1 AND request_key=$2', [customer.id, key]);
    if (previous.rowCount) {
      if (previous.rows[0].quantity !== quantity) fail(409, 'IDEMPOTENCY_CONFLICT', 'Mã thao tác đã dùng cho số lượt khác.');
      return orderView(previous.rows[0]);
    }
    const active = await client.query(`SELECT count(*) AS count FROM ps_billing_orders
      WHERE customer_id=$1 AND status IN ('pending_payment','pending_review')`,[customer.id]);
    if (number(active.rows[0].count) >= 5) fail(429, 'TOO_MANY_OPEN_ORDERS', 'Bạn đang có 5 yêu cầu chưa xử lý. Hãy kiểm tra yêu cầu hiện có trước.');
    const recent = await client.query(`SELECT count(*) AS count FROM ps_billing_orders
      WHERE customer_id=$1 AND created_at > now()-interval '1 day'`, [customer.id]);
    if (number(recent.rows[0].count) >= 20) fail(429, 'TOPUP_RATE_LIMIT', 'Bạn đã tạo nhiều yêu cầu. Hãy dùng hoặc kiểm tra yêu cầu hiện có.');
    const id = crypto.randomUUID();
    const code = 'PS' + crypto.randomBytes(8).toString('hex').toUpperCase();
    const result = await client.query(`INSERT INTO ps_billing_orders(
      id,customer_id,order_code,request_key,quantity,unit_price_vnd,amount_vnd,
      bank_id,bank_name,account_number,account_name,payment_memo)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [id,customer.id,code,key,quantity,UNIT_PRICE_VND,quantity*UNIT_PRICE_VND,
      bank.bankId,bank.bankName,bank.accountNumber,bank.accountName,code]);
    return orderView(result.rows[0]);
  });
}

async function getOrder(identity, orderId) {
  const customer = await ensureCustomer(identity);
  const result = await db.query('SELECT * FROM ps_billing_orders WHERE id=$1 AND customer_id=$2', [uuid(orderId),customer.id]);
  if (!result.rowCount) fail(404, 'ORDER_NOT_FOUND', 'Không tìm thấy yêu cầu nạp của tài khoản này.');
  return orderView(result.rows[0]);
}
async function listMyOrders(identity) {
  const customer = await ensureCustomer(identity);
  const result = await db.query('SELECT * FROM ps_billing_orders WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 100', [customer.id]);
  return result.rows.map(orderView);
}
async function submitPaid(identity, input) {
  const customer = await ensureCustomer(identity);
  const orderId = uuid(input?.orderId);
  return db.transaction(async client => {
    const selected = await client.query('SELECT * FROM ps_billing_orders WHERE id=$1 AND customer_id=$2 FOR UPDATE', [orderId,customer.id]);
    if (!selected.rowCount) fail(404, 'ORDER_NOT_FOUND', 'Không tìm thấy yêu cầu nạp của tài khoản này.');
    const row = selected.rows[0];
    if (row.status === 'rejected') fail(409, 'ORDER_REJECTED', 'Yêu cầu đã bị từ chối. Hãy liên hệ quản trị viên để đối soát.');
    if (row.status !== 'pending_payment') return orderView(row);
    const result = await client.query(`UPDATE ps_billing_orders SET status='pending_review',submitted_at=now(),updated_at=now()
      WHERE id=$1 RETURNING *`, [orderId]);
    const order = orderView(result.rows[0]);
    const payload = {orderId,orderCode:order.orderCode,quantity:order.quantity,amountVnd:order.amountVnd,
      paymentMemo:order.paymentMemo,customerEmail:customer.email,bank:order.bank};
    for (const recipient of notificationRecipients()) {
      await client.query(`INSERT INTO ps_billing_outbox(id,order_id,dedupe_key,event_type,recipient,payload_json)
        VALUES($1,$2,$3,'topup_submitted',$4,$5::jsonb) ON CONFLICT DO NOTHING`,
      [crypto.randomUUID(),orderId,`topup-submitted:${orderId}:${recipient}`,recipient,JSON.stringify(payload)]);
    }
    return order;
  });
}

async function ledger(client, customerId, kind, sourceId, availableDelta, reservedDelta) {
  await client.query(`INSERT INTO ps_billing_ledger(id,customer_id,kind,source_id,dedupe_key,available_delta,reserved_delta)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,
  [crypto.randomUUID(),customerId,kind,sourceId,`${kind}:${sourceId}`,availableDelta,reservedDelta]);
}

async function beginAdminAction(client, actor, action, targetId, key, payload, evidence) {
  const payloadHash = hash(payload);
  const result = await client.query(`INSERT INTO ps_billing_admin_actions(id,actor_id,action,target_id,request_key,payload_hash,evidence)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(actor_id,request_key) DO NOTHING RETURNING id`,
  [crypto.randomUUID(),actor.id,action,targetId,key,payloadHash,evidence]);
  if (result.rowCount) return true;
  const previous = await client.query('SELECT payload_hash FROM ps_billing_admin_actions WHERE actor_id=$1 AND request_key=$2', [actor.id,key]);
  if (!previous.rowCount || previous.rows[0].payload_hash !== payloadHash)
    fail(409, 'IDEMPOTENCY_CONFLICT', 'Mã thao tác quản trị đã dùng cho nội dung khác.');
  return false;
}

async function approveOrder(identity, input) {
  requireAdmin(identity);
  const orderId = uuid(input?.orderId), key = requestKey(input?.idempotencyKey);
  const reference = textNote(input?.bankReference,3,120);
  const referenceNorm = reference.toUpperCase().replace(/\s+/g,'');
  if (referenceNorm.length < 3) fail(400,'INVALID_BANK_REFERENCE','Mã giao dịch ngân hàng không hợp lệ.');
  if (input.confirmedBankTransfer !== true) fail(400,'BANK_CONFIRMATION_REQUIRED','Hãy xác nhận đã kiểm tra khoản tiền thực nhận tại ngân hàng.');
  if (!Number.isSafeInteger(input.receivedAmountVnd) || input.receivedAmountVnd <= 0)
    fail(400,'INVALID_RECEIVED_AMOUNT','Hãy nhập số tiền thực nhận đã đối soát.');
  const note = textNote(input.note);
  const actor = await ensureCustomer(identity);
  try {
    return await db.transaction(async client => {
      await beginAdminAction(client,actor,'approve',orderId,key,
        {action:'approve',orderId,referenceNorm,receivedAmountVnd:input.receivedAmountVnd,note},note);
      const selected = await client.query('SELECT * FROM ps_billing_orders WHERE id=$1 FOR UPDATE', [orderId]);
      if (!selected.rowCount) fail(404,'ORDER_NOT_FOUND','Không tìm thấy yêu cầu nạp.');
      const order = selected.rows[0];
      if (number(order.amount_vnd) !== input.receivedAmountVnd)
        fail(409,'AMOUNT_MISMATCH','Số tiền thực nhận không khớp yêu cầu. Chưa cộng lượt; cần đối soát riêng.');
      if (order.status === 'approved') {
        const payment = await client.query('SELECT reference_norm FROM ps_billing_bank_payments WHERE order_id=$1',[orderId]);
        if (!payment.rowCount || payment.rows[0].reference_norm !== referenceNorm)
          fail(409,'ORDER_ALREADY_APPROVED','Yêu cầu đã được duyệt bằng một giao dịch khác.');
        return orderView(order);
      }
      if (order.status !== 'pending_review') fail(409,'ORDER_NOT_PENDING','Yêu cầu không còn ở trạng thái chờ đối soát.');
      await client.query('SELECT id FROM ps_billing_customers WHERE id=$1 FOR UPDATE',[order.customer_id]);
      await client.query(`INSERT INTO ps_billing_bank_payments(id,order_id,bank_id,account_number,reference_norm,reference_original,amount_vnd,verified_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [crypto.randomUUID(),orderId,order.bank_id,order.account_number,referenceNorm,reference,input.receivedAmountVnd,actor.id]);
      await client.query(`UPDATE ps_billing_customers SET available_credits=available_credits+$2,updated_at=now() WHERE id=$1`,[order.customer_id,order.quantity]);
      await ledger(client,order.customer_id,'topup',orderId,order.quantity,0);
      const updated = await client.query(`UPDATE ps_billing_orders SET status='approved',reviewed_at=now(),reviewed_by=$2,review_note=$3,updated_at=now()
        WHERE id=$1 RETURNING *`,[orderId,actor.id,note]);
      return orderView(updated.rows[0]);
    });
  } catch (error) {
    if (error.code === '23505' && String(error.constraint || '').includes('ps_billing_bank_payments'))
      fail(409,'BANK_REFERENCE_ALREADY_USED','Khoản chuyển này đã được dùng để duyệt một yêu cầu khác.');
    throw error;
  }
}

async function rejectOrder(identity, input) {
  requireAdmin(identity);
  const orderId = uuid(input?.orderId), key = requestKey(input?.idempotencyKey), note = textNote(input?.note,5);
  const actor = await ensureCustomer(identity);
  return db.transaction(async client => {
    await beginAdminAction(client,actor,'reject',orderId,key,{action:'reject',orderId,note},note);
    const selected = await client.query('SELECT * FROM ps_billing_orders WHERE id=$1 FOR UPDATE',[orderId]);
    if (!selected.rowCount) fail(404,'ORDER_NOT_FOUND','Không tìm thấy yêu cầu nạp.');
    if (selected.rows[0].status === 'rejected') return orderView(selected.rows[0]);
    if (selected.rows[0].status === 'approved') fail(409,'ORDER_ALREADY_APPROVED','Yêu cầu đã cộng lượt; không thể từ chối hoặc xóa lịch sử.');
    const updated = await client.query(`UPDATE ps_billing_orders SET status='rejected',reviewed_at=now(),reviewed_by=$2,review_note=$3,updated_at=now()
      WHERE id=$1 RETURNING *`,[orderId,actor.id,note]);
    return orderView(updated.rows[0]);
  });
}

function operationResult(operation) {
  return operation.result_json || {status:'unverified',delivery:'unknown',note:'Lượt này đã bắt đầu xử lý. Chưa xác minh được kết quả; hệ thống không tự gửi lại.'};
}
function operationView(row) {
  const eligible = new Date(row.dispatch_started_at).getTime() + ADMIN_REVIEW_DELAY_MS;
  return {id:row.id,operationId:row.operation_key,customer:{id:row.customer_id,email:row.customer_email || ''},
    credits:row.credits,status:row.status,formId:row.form_id,createdAt:asDate(row.created_at),
    dispatchStartedAt:asDate(row.dispatch_started_at),updatedAt:asDate(row.updated_at),
    resultNote:operationResult(row).note || '',canResolve:Date.now() >= eligible && ['unknown','dispatching'].includes(row.status),
    resolutionEligibleAt:new Date(eligible).toISOString()};
}

async function listAdminTopups(identity, input = {}) {
  requireAdmin(identity); assertReady();
  const status = input.orderId ? 'all' : input.status || 'pending_review';
  if (!['all','pending_payment','pending_review','approved','rejected'].includes(status)) fail(400,'INVALID_STATUS','Trạng thái yêu cầu không hợp lệ.');
  const orderId = input.orderId ? uuid(input.orderId) : null;
  const result = await db.query(`SELECT o.*,c.email AS customer_email,p.reference_original,p.amount_vnd AS received_amount_vnd,
      n.pending,n.sending,n.retry,n.sent,n.failed,n.last_attempt_at
    FROM ps_billing_orders o JOIN ps_billing_customers c ON c.id=o.customer_id
    LEFT JOIN ps_billing_bank_payments p ON p.order_id=o.id
    LEFT JOIN LATERAL (SELECT
      count(*) FILTER(WHERE status='pending') AS pending,count(*) FILTER(WHERE status='sending') AS sending,
      count(*) FILTER(WHERE status='retry') AS retry,count(*) FILTER(WHERE status='sent') AS sent,
      count(*) FILTER(WHERE status='failed') AS failed,max(last_attempt_at) AS last_attempt_at
      FROM ps_billing_outbox WHERE order_id=o.id) n ON true
    WHERE ($1='all' OR o.status=$1) AND ($2::uuid IS NULL OR o.id=$2::uuid)
    ORDER BY CASE WHEN o.status IN ('pending_payment','pending_review') THEN 0 ELSE 1 END,o.created_at DESC LIMIT 100`,[status,orderId]);
  const pending = await db.query(`SELECT op.*,c.email AS customer_email FROM ps_billing_operations op
    JOIN ps_billing_customers c ON c.id=op.customer_id WHERE op.status IN ('dispatching','unknown')
    ORDER BY op.dispatch_started_at ASC LIMIT 100`);
  return {orders:result.rows.map(row => ({...orderView(row),notifications:{pending:number(row.pending),sending:number(row.sending),
    retry:number(row.retry),sent:number(row.sent),failed:number(row.failed),lastAttemptAt:asDate(row.last_attempt_at)}})),
  pendingOperations:pending.rows.map(operationView)};
}

async function listAdminUsers(identity, input = {}) {
  requireAdmin(identity); assertReady();
  const search = typeof input.search === 'string' ? input.search.trim().toLowerCase() : '';
  if (search.length > 120) fail(400,'INVALID_SEARCH','Từ khóa tìm kiếm quá dài.');
  const result = await db.query(`SELECT c.id,c.email,c.available_credits,c.reserved_credits,c.created_at,c.updated_at,
      COALESCE(ord.total_orders,0) AS total_orders,
      COALESCE(ord.pending_orders,0) AS pending_orders,
      COALESCE(ord.approved_orders,0) AS approved_orders,
      COALESCE(ord.purchased_credits,0) AS purchased_credits,
      COALESCE(ord.paid_amount_vnd,0) AS paid_amount_vnd,
      ord.last_order_at,
      COALESCE(op.total_operations,0) AS total_operations,
      COALESCE(op.consumed_operations,0) AS consumed_operations,
      COALESCE(op.unknown_operations,0) AS unknown_operations,
      op.last_operation_at
    FROM ps_billing_customers c
    LEFT JOIN LATERAL (
      SELECT count(*) AS total_orders,
        count(*) FILTER (WHERE status IN ('pending_payment','pending_review')) AS pending_orders,
        count(*) FILTER (WHERE status='approved') AS approved_orders,
        COALESCE(sum(quantity) FILTER (WHERE status='approved'),0) AS purchased_credits,
        COALESCE(sum(amount_vnd) FILTER (WHERE status='approved'),0) AS paid_amount_vnd,
        max(created_at) AS last_order_at
      FROM ps_billing_orders WHERE customer_id=c.id
    ) ord ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS total_operations,
        count(*) FILTER (WHERE status='consumed') AS consumed_operations,
        count(*) FILTER (WHERE status IN ('unknown','dispatching')) AS unknown_operations,
        max(updated_at) AS last_operation_at
      FROM ps_billing_operations WHERE customer_id=c.id
    ) op ON true
    WHERE ($1='' OR lower(c.email) LIKE '%'||$1||'%' OR lower(c.id::text) LIKE '%'||$1||'%')
    ORDER BY GREATEST(c.updated_at,COALESCE(ord.last_order_at,c.updated_at),COALESCE(op.last_operation_at,c.updated_at)) DESC,
      c.created_at DESC
    LIMIT 200`,[search]);
  return result.rows.map(row => ({
    id: row.id,
    email: row.email,
    role: adminEmails().includes(String(row.email || '').toLowerCase()) ? 'admin' : 'user',
    availableCredits: number(row.available_credits),
    reservedCredits: number(row.reserved_credits),
    createdAt: asDate(row.created_at),
    lastActivityAt: asDate([row.updated_at,row.last_order_at,row.last_operation_at]
      .filter(Boolean).sort((a,b)=>new Date(b)-new Date(a))[0]),
    totalOrders: number(row.total_orders),
    pendingOrders: number(row.pending_orders),
    approvedOrders: number(row.approved_orders),
    purchasedCredits: number(row.purchased_credits),
    paidAmountVnd: number(row.paid_amount_vnd),
    totalOperations: number(row.total_operations),
    consumedOperations: number(row.consumed_operations),
    unknownOperations: number(row.unknown_operations)
  }));
}

// This single transaction reserves AND claims the dispatch. A crash after commit
// leaves a durable hold. No retry can obtain permission to dispatch the same key.
async function reserveSubmission(identity, input) {
  assertReady();
  const key = requestKey(input?.operationId,'operationId');
  const formId = typeof input.formId === 'string' ? input.formId : '';
  if (!/^[A-Za-z0-9_-]{3,200}$/.test(formId) || !input.answers || typeof input.answers !== 'object')
    fail(400,'INVALID_SUBMISSION','Thiếu Form hoặc câu trả lời cần xử lý.');
  const payloadHash = hash({formId,answers:input.answers});
  const customer = await ensureCustomer(identity);
  return db.transaction(async client => {
    const locked = await client.query('SELECT * FROM ps_billing_customers WHERE id=$1 FOR UPDATE',[customer.id]);
    const previous = await client.query('SELECT * FROM ps_billing_operations WHERE customer_id=$1 AND operation_key=$2',[customer.id,key]);
    if (previous.rowCount) {
      const operation = previous.rows[0];
      if (operation.payload_hash !== payloadHash) fail(409,'OPERATION_PAYLOAD_CONFLICT','Mã lượt gửi đã dùng cho dữ liệu khác. Không gửi lại.');
      return {dispatch:false,operationId:key,result:operationResult(operation),status:operation.status,
        availableCredits:number(locked.rows[0].available_credits),reservedCredits:number(locked.rows[0].reserved_credits)};
    }
    if (number(locked.rows[0].available_credits) < 1) fail(402,'INSUFFICIENT_CREDITS','Tài khoản đã hết lượt. Hãy mua thêm lượt trước khi gửi.');
    const id = crypto.randomUUID(),claimToken = crypto.randomUUID();
    await client.query(`INSERT INTO ps_billing_operations(id,customer_id,operation_key,form_id,payload_hash,claim_token,status)
      VALUES($1,$2,$3,$4,$5,$6,'dispatching')`,[id,customer.id,key,formId,payloadHash,claimToken]);
    const balance = await client.query(`UPDATE ps_billing_customers SET available_credits=available_credits-1,reserved_credits=reserved_credits+1,
      updated_at=now() WHERE id=$1 AND available_credits>=1 RETURNING *`,[customer.id]);
    if (!balance.rowCount) fail(402,'INSUFFICIENT_CREDITS','Tài khoản đã hết lượt.');
    await ledger(client,customer.id,'reserve',id,-1,1);
    return {dispatch:true,operationId:key,claimToken,availableCredits:number(balance.rows[0].available_credits),reservedCredits:number(balance.rows[0].reserved_credits)};
  });
}

function safeOutcome(result, outcome) {
  const expected = {confirmed:'page-confirmed',not_sent:'failed',unknown:'unverified'}[outcome];
  if (!expected) fail(400,'INVALID_OUTCOME','Kết quả xử lý lượt không hợp lệ.');
  if (outcome === 'confirmed' && result?.status !== 'page-confirmed') fail(400,'INVALID_OUTCOME','Chưa có kết quả xác nhận để trừ lượt.');
  return {status:expected,delivery:outcome,note:typeof result?.note === 'string' ? result.note.slice(0,2000) : '',
    ...(typeof result?.receivedAt === 'string' && !Number.isNaN(Date.parse(result.receivedAt)) ? {receivedAt:new Date(result.receivedAt).toISOString()} : {})};
}

async function settleSubmission(identity, input) {
  assertReady();
  const current = verifiedIdentity(identity), key = requestKey(input?.operationId,'operationId');
  const result = safeOutcome(input.result,input.outcome);
  const claimToken = uuid(input.claimToken);
  const customer = await ensureCustomer(current);
  return db.transaction(async client => {
    await client.query('SELECT id FROM ps_billing_customers WHERE id=$1 FOR UPDATE',[customer.id]);
    const selected = await client.query('SELECT * FROM ps_billing_operations WHERE customer_id=$1 AND operation_key=$2 FOR UPDATE',[customer.id,key]);
    if (!selected.rowCount) fail(404,'OPERATION_NOT_FOUND','Không tìm thấy lượt đang xử lý.');
    const operation = selected.rows[0];
    if (operation.claim_token !== claimToken) fail(403,'INVALID_CLAIM','Không có quyền kết thúc lượt này.');
    if (['consumed','released'].includes(operation.status)) return {result:operationResult(operation),status:operation.status};
    if (input.outcome === 'unknown') {
      await client.query(`UPDATE ps_billing_operations SET status='unknown',result_json=$2::jsonb,updated_at=now() WHERE id=$1`,[operation.id,JSON.stringify(result)]);
      return {result,status:'unknown'};
    }
    const release = input.outcome === 'not_sent';
    const balance = await client.query(`UPDATE ps_billing_customers SET available_credits=available_credits+$2,
      reserved_credits=reserved_credits-1,updated_at=now() WHERE id=$1 AND reserved_credits>=1 RETURNING *`,[customer.id,release?1:0]);
    if (!balance.rowCount) fail(503,'BILLING_INVARIANT','Không thể quyết toán lượt. Hệ thống giữ trạng thái để đối soát.');
    await ledger(client,customer.id,release?'release':'consume',operation.id,release?1:0,-1);
    const state = release?'released':'consumed';
    await client.query(`UPDATE ps_billing_operations SET status=$2,result_json=$3::jsonb,settled_at=now(),updated_at=now() WHERE id=$1`,[operation.id,state,JSON.stringify(result)]);
    return {result,status:state,availableCredits:number(balance.rows[0].available_credits),reservedCredits:number(balance.rows[0].reserved_credits)};
  });
}

async function resolveOperation(identity, input) {
  requireAdmin(identity);
  const operationId = uuid(input?.operationId),key = requestKey(input?.idempotencyKey),evidence = textNote(input?.evidence,20,2000);
  if (!['consume','release'].includes(input.resolution) || input.confirmedReview !== true)
    fail(400,'REVIEW_CONFIRMATION_REQUIRED','Hãy chọn cách đối soát và xác nhận đã kiểm tra bằng chứng.');
  const actor = await ensureCustomer(identity);
  return db.transaction(async client => {
    await beginAdminAction(client,actor,`resolve_${input.resolution}`,operationId,key,
      {operationId,resolution:input.resolution,evidence},evidence);
    const initial = await client.query('SELECT customer_id FROM ps_billing_operations WHERE id=$1',[operationId]);
    if (!initial.rowCount) fail(404,'OPERATION_NOT_FOUND','Không tìm thấy lượt cần đối soát.');
    const customerId = initial.rows[0].customer_id;
    await client.query('SELECT id FROM ps_billing_customers WHERE id=$1 FOR UPDATE',[customerId]);
    const selected = await client.query(`SELECT *,dispatch_started_at<=now()-interval '5 minutes' AS eligible
      FROM ps_billing_operations WHERE id=$1 FOR UPDATE`,[operationId]);
    const operation = selected.rows[0];
    const state = input.resolution === 'release'?'released':'consumed';
    if (['consumed','released'].includes(operation.status)) {
      if (operation.status !== state) fail(409,'OPERATION_ALREADY_RESOLVED','Lượt này đã được quyết toán theo cách khác.');
      return operationView(operation);
    }
    if (!operation.eligible) fail(409,'OPERATION_STILL_IN_FLIGHT','Chờ ít nhất 5 phút từ lúc gửi trước khi đối soát thủ công.');
    const release = state === 'released';
    const updated = await client.query(`UPDATE ps_billing_customers SET available_credits=available_credits+$2,
      reserved_credits=reserved_credits-1,updated_at=now() WHERE id=$1 AND reserved_credits>=1 RETURNING id`,[customerId,release?1:0]);
    if (!updated.rowCount) fail(503,'BILLING_INVARIANT','Số lượt đang giữ không khớp. Chưa thay đổi số dư.');
    await ledger(client,customerId,release?'release':'consume',operationId,release?1:0,-1);
    const prior = operationResult(operation);
    const result = {...prior,note:(prior.note+' Quản trị viên đã đối soát và '+(release?'hoàn':'trừ')+' lượt. Không tự gửi lại.').slice(0,2000),billingResolution:input.resolution};
    const saved = await client.query(`UPDATE ps_billing_operations SET status=$2,result_json=$3::jsonb,
      resolved_by=$4,resolution_evidence=$5,settled_at=now(),updated_at=now() WHERE id=$1 RETURNING *`,
    [operationId,state,JSON.stringify(result),actor.id,evidence]);
    return operationView(saved.rows[0]);
  });
}

module.exports = {BillingError,UNIT_PRICE_VND,MAX_TOPUP_CREDITS,
  get BANK() { return bankConfig(); }, get NOTIFICATION_RECIPIENTS() { return notificationRecipients(); },
  enabled,purchasesEnabled,getConfigStatus,assertReady,verifiedIdentity,isAdmin,requireAdmin,ensureAccount,ensureCustomer,getProfile,
  createOrder,getOrder,listMyOrders,submitPaid,approveOrder,rejectOrder,listAdminTopups,listAdminUsers,
  reserveSubmission,settleSubmission,resolveOperation};
