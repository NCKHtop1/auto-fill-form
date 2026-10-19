/* Authenticated manual review. All authorization and accounting are enforced by the API. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = { profile: null, orders: [], operations: [], users: [], metrics: null, commerce: null, selected: null,
    loading: false, usersLoading: false, metricsLoading: false, commerceLoading: false, busy: false,
    initialOrder: new URLSearchParams(location.search).get('orderId'), keys: new Map() };
  const labels = { pending_payment: 'Chờ chuyển khoản', pending_review: 'Chờ duyệt', approved: 'Đã cộng phiếu', rejected: 'Đã từ chối' };
  const number = value => Number(value || 0).toLocaleString('vi-VN');
  const money = value => number(value) + ' đ';
  const date = value => { if (!value) return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('vi-VN'); };
  function node(tag, klass, text) { const el = document.createElement(tag); if (klass) el.className = klass; if (text !== undefined) el.textContent = text; return el; }
  function button(text, fn, kind = '') { const el = node('button', 'pb-button' + (kind ? ' pb-button-' + kind : ''), text); el.type = 'button'; el.addEventListener('click', fn); return el; }
  function keyFor(action, id) {
    const name = action + ':' + id;
    if (!state.keys.has(name)) state.keys.set(name, window.crypto?.randomUUID?.() || 'pd-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    return state.keys.get(name);
  }
  async function request(path, body) {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true) {
        const error = new Error(result.error || 'Không tải được dữ liệu. Vui lòng thử lại.'); error.status = response.status; error.code = result.code; throw error;
      }
      return result;
    } catch (error) {
      if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('Chưa nhận được kết quả từ máy chủ. Làm mới để kiểm tra trước khi thao tác lại.');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  function say(text, kind = '') {
    const box = $('paMessage'); box.textContent = text || '';
    box.className = 'pb-status' + (text ? ' pb-notice' : '') + (kind ? ' pb-notice-' + kind : '');
    box.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  }
  function formSay(form, text, kind = 'error') {
    let box = form.querySelector('[data-form-message]');
    if (!box) { box = node('p'); box.dataset.formMessage = 'true'; box.setAttribute('role', 'alert'); form.append(box); }
    box.className = 'pb-notice pb-notice-' + kind; box.textContent = text;
  }
  function login() {
    const link = node('a', 'pb-button pb-button-primary', 'Kết nối Google');
    link.href = '/api/auth/start'; link.target = '_blank'; link.rel = 'noopener'; link.setAttribute('aria-label', 'Kết nối Google, mở trong thẻ mới'); return link;
  }
  async function checkSession() {
    try {
      const profile = await request('/api/billing?action=profile');
      state.profile = profile;
      const session = $('paSession'); session.replaceChildren();
      const allowed = profile.billingEnabled && profile.configured && profile.signedIn && profile.user?.isAdmin;
      $('paWorkspace').hidden = !allowed;
      if (!allowed) {
        state.orders = []; state.operations = []; state.users = []; state.metrics = null; state.commerce = null; state.selected = null;
        $('paOrders').replaceChildren(); $('paOperations').replaceChildren(); $('paDetail').replaceChildren();
        $('paUsers')?.replaceChildren(); if ($('paUsersSummary')) $('paUsersSummary').textContent = '';
        $('paRevenueSummary')?.replaceChildren(); $('paRevenueMonthly')?.replaceChildren(); $('paRevenuePackages')?.replaceChildren();
        $('paPackages')?.replaceChildren(); $('paPromotions')?.replaceChildren();
      }
      if (!profile.billingEnabled) {
        session.append(node('strong', '', 'Tính năng mua phiếu đang tắt.'), node('p', 'pb-small', 'Luồng công cụ hiện tại vẫn được giữ nguyên.'));
      } else if (!profile.configured) {
        session.append(node('strong', '', 'Hệ thống mua phiếu chưa sẵn sàng.'), node('p', 'pb-small', 'Chưa tạo hoặc duyệt đơn vào lúc này.'));
      } else if (!profile.signedIn) {
        session.append(node('p', '', 'Kết nối tài khoản Google đã được cấp quyền quản trị.'), login(),
          node('p', 'pb-small', 'Đăng nhập mở trong thẻ mới. Quay lại trang này sau khi kết nối.'), button('Tôi đã kết nối · Kiểm tra lại', init));
      } else if (!profile.user?.isAdmin) {
        session.append(node('strong', '', 'Tài khoản này không có quyền duyệt nạp.'), node('p', 'pb-small', profile.user?.email || ''),
          login(), node('p', 'pb-small', 'Nếu cần, kết nối lại bằng tài khoản quản trị đã được cấp quyền.'));
      } else {
        session.append(node('strong', '', 'Quản trị viên: ' + profile.user.email), node('p', 'pb-small', 'Mọi quyết định duyệt, từ chối và xử lý phiếu chờ đều được ghi lại.'));
      }
      return !!allowed;
    } catch (error) {
      $('paWorkspace').hidden = true; $('paSession').replaceChildren(node('p', '', 'Chưa kiểm tra được quyền quản trị.'), button('Thử lại', init));
      say(error.message, 'error'); return false;
    }
  }
  async function loadOrders(options = {}) {
    if (state.loading || !state.profile?.user?.isAdmin) return;
    state.loading = true; $('paRefresh').disabled = true;
    if (!options.quiet) say('Đang tải đơn…');
    try {
      const selectedId = state.selected?.id;
      const filter = $('paFilter').value;
      const result = await request('/api/admin-topups?status=' + encodeURIComponent(filter));
      state.orders = Array.isArray(result.orders) ? result.orders : [];
      state.operations = Array.isArray(result.pendingOperations) ? result.pendingOperations : [];
      if (selectedId) {
        state.selected = state.orders.find(order => order.id === selectedId) || null;
        if (!state.selected) {
          const current = await request('/api/admin-topups?status=all&orderId=' + encodeURIComponent(selectedId));
          state.selected = current.order || (current.orders || []).find(order => order.id === selectedId) || null;
        }
      }
      if (state.initialOrder) {
        const target = state.initialOrder; state.initialOrder = null;
        const existing = state.orders.find(order => order.id === target);
        if (existing) state.selected = existing;
        else {
          const detail = await request('/api/admin-topups?status=all&orderId=' + encodeURIComponent(target));
          state.selected = detail.order || (detail.orders || []).find(order => order.id === target) || null;
          if (!state.selected) say('Không tìm thấy đơn từ liên kết. Kiểm tra lại mã đơn.', 'error');
        }
      }
      renderOrders(); renderDetail(); renderOperations();
      const pendingVisible = filter === 'pending_review' ? state.orders.length : 0;
      document.title = (pendingVisible > 0 ? '(' + pendingVisible + ') ' : '') + 'Duyệt nạp phiếu · PandaStudy';
      if (!options.quiet) say('Đã tải ' + state.orders.length + ' đơn' + (state.orders.length >= 100 ? ' gần nhất. Dùng liên kết mã đơn để mở đơn cũ hơn.' : '.'));
    } catch (error) {
      say(error.message, 'error');
      if (error.status === 401 || error.status === 403) await checkSession();
    } finally { state.loading = false; $('paRefresh').disabled = false; }
  }
  async function loadUsers(options = {}) {
    if (state.usersLoading || !state.profile?.user?.isAdmin || !$('paUsers')) return;
    state.usersLoading = true;
    const search = $('paUserSearch')?.value?.trim() || '';
    if (!options.quiet) $('paUsersSummary').textContent = 'Đang tải tài khoản…';
    try {
      const result = await request('/api/admin-topups?resource=users&search=' + encodeURIComponent(search));
      state.users = Array.isArray(result.users) ? result.users : [];
      renderUsers();
      $('paUsersSummary').textContent = (search ? 'Kết quả tìm kiếm: ' : 'Danh sách gần nhất: ') +
        state.users.length + ' tài khoản' + (state.users.length >= 200 ? ' (giới hạn 200; dùng ô tìm kiếm để lọc).' : '.');
    } catch (error) {
      $('paUsersSummary').textContent = '';
      $('paUsers').replaceChildren(node('p', 'pb-notice pb-notice-error', error.message));
      if (error.status === 401 || error.status === 403) await checkSession();
    } finally {
      state.usersLoading = false;
    }
  }
  function monthLabel(value) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
    return match ? match[2] + '/' + match[1] : String(value || '—');
  }
  function metricCard(label, value, sub) {
    const card = node('div','pb-metric-card');
    card.append(node('span','pb-metric-label',label),node('strong','pb-metric-value',value));
    if (sub) card.append(node('span','pb-metric-sub',sub));
    return card;
  }
  async function loadMetrics(options = {}) {
    if (state.metricsLoading || !state.profile?.user?.isAdmin || !$('paRevenueSummary')) return;
    state.metricsLoading = true;
    if (!options.quiet) $('paRevenueSummary').replaceChildren(metricCard('Doanh thu','Đang tải…',''));
    try {
      const result = await request('/api/admin-topups?resource=metrics');
      state.metrics = result.metrics || null;
      renderMetrics();
    } catch (error) {
      $('paRevenueSummary').replaceChildren(node('p','pb-notice pb-notice-error',error.message));
      $('paRevenueMonthly').replaceChildren(); $('paRevenuePackages').replaceChildren();
      if (error.status === 401 || error.status === 403) await checkSession();
    } finally { state.metricsLoading = false; }
  }
  function renderMetrics() {
    const metrics = state.metrics;
    const summary = $('paRevenueSummary'), monthly = $('paRevenueMonthly'), packagesBox = $('paRevenuePackages');
    summary.replaceChildren(); monthly.replaceChildren(); packagesBox.replaceChildren();
    if (!metrics) { summary.append(node('p','pb-admin-empty','Chưa có dữ liệu doanh thu.')); return; }
    const current = metrics.currentMonth || {}, pending = metrics.pending || {}, all = metrics.allTime || {};
    summary.append(
      metricCard('Doanh thu tháng này',money(current.revenueVnd),number(current.approvedOrders)+' đơn đã duyệt · '+number(current.buyers)+' người mua'),
      metricCard('Phiếu bán tháng này',number(current.creditsSold)+' phiếu','Chỉ tính đơn đã duyệt'),
      metricCard('Đang chờ đối soát',money(pending.reviewAmountVnd),number(pending.reviewOrders)+' đơn chờ duyệt · '+number(pending.paymentOrders)+' đơn chờ chuyển'),
      metricCard('Doanh thu lũy kế',money(all.revenueVnd),number(all.approvedOrders)+' đơn đã duyệt'),
      metricCard('Phiếu bán lũy kế',number(all.creditsSold)+' phiếu',number(all.buyers)+' người mua duy nhất'),
      metricCard('Múi giờ báo cáo','Việt Nam','Asia/Ho_Chi_Minh')
    );

    const packageRows = Array.isArray(metrics.packages) ? metrics.packages : [];
    for (const item of packageRows) {
      const badge = node('div','pb-revenue-package');
      badge.append(node('strong','',item.name || item.id),node('span','', ' · '+number(item.approvedOrders)+' đơn · '+money(item.revenueVnd)+' · '+number(item.creditsSold)+' phiếu'));
      packagesBox.append(badge);
    }
    if (!packageRows.length) packagesBox.append(node('span','pb-small pb-muted','Chưa có gói nào được duyệt.'));

    const table = node('table','pb-revenue-table');
    const thead = node('thead'), head = node('tr');
    for (const title of ['Tháng','Doanh thu','Đơn duyệt','Phiếu bán','Người mua']) head.append(node('th','',title));
    thead.append(head); table.append(thead);
    const tbody = node('tbody');
    const rows = Array.isArray(metrics.monthly) ? [...metrics.monthly].reverse() : [];
    for (const item of rows) {
      const tr = node('tr');
      tr.append(node('td','',monthLabel(item.month)),node('td','',money(item.revenueVnd)),
        node('td','',number(item.approvedOrders)),node('td','',number(item.creditsSold)),node('td','',number(item.buyers)));
      tbody.append(tr);
    }
    table.append(tbody); monthly.append(table);
  }

  function dateTimeLocal(value) {
    if (!value) return '';
    const d=new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);
    return local.toISOString().slice(0,16);
  }
  function labeledInput(labelText,type,value,opts={}) {
    const label=node('label','pb-field',labelText);
    const input=node('input'); input.type=type; input.value=value ?? '';
    if (opts.min !== undefined) input.min=String(opts.min);
    if (opts.max !== undefined) input.max=String(opts.max);
    if (opts.step !== undefined) input.step=String(opts.step);
    if (opts.maxLength) input.maxLength=opts.maxLength;
    if (opts.placeholder) input.placeholder=opts.placeholder;
    label.append(input); return {label,input};
  }
  function labeledCheck(labelText,checked) {
    const label=node('label','pb-check');
    const input=node('input'); input.type='checkbox'; input.checked=!!checked;
    label.append(input,node('span','',labelText)); return {label,input};
  }
  async function loadCommerce(options={}) {
    if (state.commerceLoading || !state.profile?.user?.isAdmin || !$('paPackages')) return;
    state.commerceLoading=true;
    if (!options.quiet) $('paPackages').replaceChildren(node('p','pb-muted','Đang tải cấu hình gói…'));
    try {
      const result=await request('/api/admin-topups?resource=commerce');
      state.commerce=result.commerce || {packages:[],promotions:[]};
      renderCommerce();
    } catch (error) {
      $('paPackages').replaceChildren(node('p','pb-notice pb-notice-error',error.message));
      $('paPromotions').replaceChildren();
      if (error.status===401 || error.status===403) await checkSession();
    } finally { state.commerceLoading=false; }
  }
  function renderCommerce() {
    const data=state.commerce || {packages:[],promotions:[],audit:[]};
    const packagesBox=$('paPackages'),promotionsBox=$('paPromotions'),auditBox=$('paCommerceAudit');
    packagesBox.replaceChildren(); promotionsBox.replaceChildren(); auditBox?.replaceChildren();

    const packages=Array.isArray(data.packages)?data.packages:[];
    if (!packages.length) packagesBox.append(node('p','pb-admin-empty','Chưa có gói nạp.'));
    for (const pkg of packages) {
      const form=node('form','pb-commerce-card');
      const head=node('div','pb-commerce-card-head');
      head.append(node('strong','',pkg.name || pkg.id),
        node('span','pb-badge '+(pkg.enabled?'pb-badge-approved':''),pkg.enabled?'Đang bán':'Đã ẩn'));
      form.append(head);
      const grid=node('div','pb-commerce-form-grid');
      const name=labeledInput('Tên gói','text',pkg.name,{maxLength:80});
      const badge=labeledInput('Nhãn nổi bật','text',pkg.badge || '',{maxLength:80,placeholder:'Ví dụ: Phổ biến nhất'});
      const credits=labeledInput('Số phiếu','number',pkg.credits,{min:1,max:100000,step:1});
      const price=labeledInput('Giá bán (đồng)','number',pkg.priceVnd,{min:1,step:1});
      const list=labeledInput('Giá niêm yết (đồng)','number',pkg.listPriceVnd,{min:1,step:1});
      const order=labeledInput('Thứ tự hiển thị','number',pkg.sortOrder,{min:0,max:10000,step:1});
      grid.append(name.label,badge.label,credits.label,price.label,list.label,order.label);
      const enabled=labeledCheck('Hiển thị gói cho người dùng',pkg.enabled);
      const featured=labeledCheck('Đánh dấu là gói nổi bật mặc định',pkg.featured || pkg.popular);
      const status=node('p','pb-small pb-muted');
      const save=node('button','pb-button pb-button-primary','Lưu gói'); save.type='submit';
      form.append(grid,enabled.label,featured.label,save,status);
      form.addEventListener('submit',async event=>{
        event.preventDefault(); if(state.busy)return;
        const payload={
          action:'savePackage',id:pkg.id,name:name.input.value.trim(),badge:badge.input.value.trim(),
          credits:Number(credits.input.value),priceVnd:Number(price.input.value),listPriceVnd:Number(list.input.value),
          sortOrder:Number(order.input.value),enabled:enabled.input.checked,featured:featured.input.checked
        };
        state.busy=true; save.disabled=true; status.textContent='Đang lưu…';
        try {
          await request('/api/admin-topups',payload);
          status.textContent='Đã lưu cấu hình gói.';
          await Promise.all([loadCommerce({quiet:true}),loadMetrics({quiet:true})]);
        } catch(error){status.textContent=error.message;}
        finally{state.busy=false;save.disabled=false;}
      });
      packagesBox.append(form);
    }

    const promotions=Array.isArray(data.promotions)?data.promotions:[];
    if (!promotions.length) promotionsBox.append(node('p','pb-admin-empty','Chưa có chương trình ưu đãi.'));
    for (const promo of promotions) promotionsBox.append(promotionForm(promo));

    if (auditBox) {
      const audit=Array.isArray(data.audit)?data.audit:[];
      if (!audit.length) auditBox.append(node('p','pb-admin-empty','Chưa có thay đổi cấu hình được ghi nhận.'));
      else {
        const table=node('table','pb-revenue-table');
        const thead=node('thead'),hr=node('tr');
        for (const title of ['Thời điểm','Admin','Đối tượng','Thay đổi']) hr.append(node('th','',title));
        thead.append(hr); table.append(thead);
        const tbody=node('tbody');
        for (const item of audit) {
          const tr=node('tr');
          const action=item.action==='package_save'?'Lưu gói':item.action==='promotion_save'?'Lưu ưu đãi':item.action;
          tr.append(node('td','',date(item.createdAt)),node('td','',item.actorEmail || '—'),
            node('td','',(item.entityType==='package'?'Gói ':'Ưu đãi ')+(item.entityId || '')),
            node('td','',action));
          tbody.append(tr);
        }
        table.append(tbody); auditBox.append(table);
      }
    }
  }
  function promotionForm(promo={}) {
    const form=node('form','pb-commerce-card');
    const head=node('div','pb-commerce-card-head');
    head.append(node('strong','',promo.name || 'Ưu đãi mới'),
      node('span','pb-badge '+(promo.enabled?'pb-badge-approved':''),promo.enabled?'Đang bật':'Đã tắt'));
    form.append(head);
    const grid=node('div','pb-commerce-form-grid');
    const code=labeledInput('Mã ưu đãi','text',promo.code || '',{maxLength:48,placeholder:'WELCOME_2026'});
    const name=labeledInput('Tên ưu đãi','text',promo.name || '',{maxLength:120});
    const credits=labeledInput('Phiếu tặng','number',promo.credits || 10,{min:1,max:100000,step:1});
    const start=labeledInput('Bắt đầu','datetime-local',dateTimeLocal(promo.startsAt));
    const end=labeledInput('Kết thúc','datetime-local',dateTimeLocal(promo.endsAt));
    grid.append(code.label,name.label,credits.label,start.label,end.label);
    const descLabel=node('label','pb-field','Mô tả');
    const desc=node('textarea'); desc.maxLength=500; desc.value=promo.description || ''; descLabel.append(desc);
    const enabled=labeledCheck('Bật chương trình ưu đãi',promo.enabled !== false);
    const stats=node('p','pb-small pb-muted',
      promo.id ? ('Đã cấp cho '+number(promo.grantedCount)+' tài khoản. Mỗi tài khoản chỉ nhận một lần.') :
      'Chương trình mới chưa được lưu.');
    const status=node('p','pb-small pb-muted');
    const save=node('button','pb-button pb-button-primary',promo.id?'Lưu ưu đãi':'Tạo ưu đãi'); save.type='submit';
    form.append(grid,descLabel,enabled.label,stats,save,status);
    form.addEventListener('submit',async event=>{
      event.preventDefault(); if(state.busy)return;
      const starts=new Date(start.input.value),ends=new Date(end.input.value);
      if(Number.isNaN(starts.getTime())||Number.isNaN(ends.getTime())){status.textContent='Chọn đầy đủ thời gian bắt đầu và kết thúc.';return;}
      const payload={
        action:'savePromotion',...(promo.id?{id:promo.id}:{}),code:code.input.value.trim(),
        name:name.input.value.trim(),description:desc.value.trim(),credits:Number(credits.input.value),
        startsAt:starts.toISOString(),endsAt:ends.toISOString(),enabled:enabled.input.checked
      };
      state.busy=true;save.disabled=true;status.textContent='Đang lưu…';
      try{
        await request('/api/admin-topups',payload);
        status.textContent='Đã lưu ưu đãi.';
        await loadCommerce({quiet:true});
      }catch(error){status.textContent=error.message;}
      finally{state.busy=false;save.disabled=false;}
    });
    return form;
  }
  function newPromotion() {
    const box=$('paPromotions');
    const now=new Date(),end=new Date(now.getTime()+7*86400000);
    const form=promotionForm({
      code:'',name:'',description:'',credits:10,enabled:true,
      startsAt:now.toISOString(),endsAt:end.toISOString(),grantedCount:0
    });
    box.prepend(form);
    form.querySelector('input')?.focus();
  }

  function renderUsers() {
    const container = $('paUsers'); container.replaceChildren();
    if (!state.users.length) {
      container.append(node('p', 'pb-admin-empty', 'Chưa có tài khoản phù hợp.'));
      return;
    }
    const list = node('div', 'pb-user-grid');
    for (const user of state.users) {
      const card = node('article', 'pb-user-card');
      const head = node('div', 'pb-user-card-head');
      const identity = node('div');
      identity.append(node('strong', 'pb-user-email', user.email || 'Tài khoản chưa có email'));
      const role = node('span', 'pb-badge ' + (user.role === 'admin' ? 'pb-badge-approved' : ''), user.role === 'admin' ? 'Admin' : 'Người dùng');
      head.append(identity, role);
      const stats = node('dl', 'pb-user-stats');
      detail(stats, 'Mã tài khoản', user.id);
      detail(stats, 'Tạo tài khoản', date(user.createdAt));
      detail(stats, 'Hoạt động gần nhất', date(user.lastActivityAt));
      detail(stats, 'Phiếu khả dụng', number(user.availableCredits));
      detail(stats, 'Phiếu đang giữ', number(user.reservedCredits));
      detail(stats, 'Đơn đã duyệt', number(user.approvedOrders) + ' / ' + number(user.totalOrders));
      detail(stats, 'Đang chờ nạp', number(user.pendingOrders));
      detail(stats, 'Đã nạp', number(user.purchasedCredits) + ' phiếu · ' + money(user.paidAmountVnd));
      if (number(user.promotionGrants) > 0) detail(stats, 'Phiếu ưu đãi', '+' + number(user.promotionCredits) + ' phiếu · ' + number(user.promotionGrants) + ' chương trình');
      detail(stats, 'Lượt đã sử dụng', number(user.consumedOperations));
      if (number(user.unknownOperations) > 0) detail(stats, 'Lượt cần đối chiếu', number(user.unknownOperations));
      card.append(head, stats);
      list.append(card);
    }
    container.append(list);
  }

  function renderOrders() {
    const container = $('paOrders'); container.replaceChildren();
    if (!state.orders.length) { container.append(node('p', 'pb-admin-empty', 'Không có đơn ở trạng thái này.')); return; }
    const list = node('ul', 'pb-order-list');
    for (const order of state.orders) {
      const item = node('li');
      const open = button('', () => { if (state.busy) return; state.selected = order; renderOrders(); renderDetail(); $('paDetail').focus(); });
      open.classList.add('pb-order-button');
      if (order.id === state.selected?.id) { open.classList.add('pb-admin-order-active'); open.setAttribute('aria-current', 'true'); }
      const text = node('span', '', order.orderCode || order.id);
      text.append(node('span', 'pb-order-meta', order.customer?.email || 'Tài khoản chưa hiển thị'),
        node('span', 'pb-order-meta', (order.package ? order.package.name + ' · ' : '') + number(order.quantity) + ' phiếu · ' + money(order.amountVnd)),
        node('span', 'pb-order-meta', date(order.submittedAt || order.createdAt)));
      open.append(text, node('span', 'pb-badge pb-badge-' + order.status, labels[order.status] || order.status));
      item.append(open); list.append(item);
    }
    container.append(list);
  }
  function detail(list, label, value) { const row = node('div', 'pb-detail-row'); row.append(node('dt', '', label), node('dd', '', String(value ?? '—'))); list.append(row); }
  function field(text, type, id, placeholder) {
    const label = node('label', 'pb-field', text); label.htmlFor = id;
    const input = node(type === 'textarea' ? 'textarea' : 'input'); input.id = id;
    if (type !== 'textarea') input.type = type;
    input.required = true; if (placeholder) input.placeholder = placeholder;
    label.append(input); return { label, input };
  }
  function check(text, id) {
    const label = node('label', 'pb-check');
    const input = node('input'); input.type = 'checkbox'; input.id = id; input.required = true;
    label.htmlFor = id; label.append(input, node('span', '', text)); return { label, input };
  }
  function renderDetail() {
    const container = $('paDetail'); container.replaceChildren();
    const order = state.selected;
    if (!order) { container.append(node('p', 'pb-admin-empty', 'Chọn một đơn để xem và xử lý.')); return; }
    container.append(node('h2', '', 'Đơn ' + (order.orderCode || order.id)), node('span', 'pb-badge pb-badge-' + order.status, labels[order.status] || order.status));
    const data = node('dl', 'pb-details');
    detail(data, 'Tài khoản', order.customer?.email);
    if (order.package) detail(data, 'Gói nạp', order.package.name + (order.package.popular ? ' · Phổ biến nhất' : ''));
    detail(data, 'Số phiếu', number(order.quantity));
    if (Number(order.discountPercent) > 0) {
      detail(data, 'Giá niêm yết', money(order.listPriceVnd));
      detail(data, 'Ưu đãi', 'Giảm ' + number(order.discountPercent) + '% · tiết kiệm ' + money(Number(order.listPriceVnd)-Number(order.amountVnd)));
    }
    detail(data, 'Số tiền cần nhận', money(order.amountVnd));
    detail(data, 'Nội dung chuyển khoản', order.paymentMemo);
    detail(data, 'Ngân hàng', order.bank?.bankName); detail(data, 'Tài khoản nhận', order.bank?.accountNumber);
    detail(data, 'Người thụ hưởng', order.bank?.accountName);
    detail(data, 'Tạo lúc', date(order.createdAt));
    if (order.submittedAt) detail(data, 'Báo đã chuyển', date(order.submittedAt));
    if (order.reviewedAt) detail(data, 'Xử lý lúc', date(order.reviewedAt));
    if (order.reviewedBy) detail(data, 'Người xử lý', typeof order.reviewedBy === 'object' ? order.reviewedBy.email : order.reviewedBy);
    if (order.manualBankConfirmation) detail(data, 'Đối soát', 'Admin xác nhận thủ công bằng ô tick; không nhập số tiền/mã giao dịch.');
    if (order.bankReference) detail(data, 'Mã giao dịch ngân hàng', order.bankReference);
    if (order.receivedAmountVnd != null) detail(data, 'Tiền đã xác nhận', money(order.receivedAmountVnd));
    if (order.adminNote) detail(data, 'Ghi chú', order.adminNote);
    container.append(data);
    const notices = order.notifications;
    if (notices) {
      const parts = [];
      for (const [name, text] of [['sent', 'đã gửi'], ['pending', 'đang chờ'], ['sending', 'đang gửi'], ['retry', 'chờ thử lại'], ['failed', 'lỗi']]) if (Number(notices[name]) > 0) parts.push(number(notices[name]) + ' ' + text);
      container.append(node('p', 'pb-small pb-muted', 'Email thông báo: ' + (parts.join(' · ') || 'chưa có lượt gửi') + (notices.lastAttemptAt ? '. Lần gần nhất: ' + date(notices.lastAttemptAt) : '.')));
    }
    if (order.status === 'pending_review' || order.status === 'pending_payment') {
      if (order.status === 'pending_payment') container.append(node('p', 'pb-notice pb-notice-warning', 'Người dùng chưa báo đã chuyển khoản. Đơn sẽ vào hàng chờ duyệt sau khi người dùng xác nhận.'));
      const actions = node('div', 'pb-actions');
      if (order.status === 'pending_review') actions.append(button('Kiểm tra và duyệt', () => showApprove(container, order), 'primary'));
      actions.append(button('Từ chối đơn', () => showReject(container, order), 'danger'));
      container.append(actions);
    }
  }
  function clearForm(container) { container.querySelector('.pb-admin-confirm')?.remove(); }
  function showApprove(container, order) {
    if (state.busy) return; clearForm(container);
    const form = node('form', 'pb-admin-confirm');
    form.append(node('h3', '', 'Xác nhận tiền vào ngân hàng'), node('p', 'pb-notice', 'Duyệt đơn này sẽ cộng ' + number(order.quantity) + ' phiếu cho ' + (order.customer?.email || 'tài khoản của đơn') + '. Nếu nhập số tiền đối soát thì phải khớp ' + money(order.amountVnd) + '; ô tick xác nhận là bắt buộc.'));
    const amount = field('Số tiền thực nhận (đồng) · không bắt buộc', 'number', 'paReceivedAmount', 'Có thể để trống');
    amount.input.required = false; amount.input.min = '1'; amount.input.step = '1'; amount.input.inputMode = 'numeric';
    const reference = field('Mã giao dịch ngân hàng · không bắt buộc', 'text', 'paBankReference', 'Có thể để trống');
    reference.input.required = false; reference.input.minLength = 3; reference.input.maxLength = 120; reference.input.autocomplete = 'off';
    const note = field('Ghi chú (không bắt buộc)', 'textarea', 'paApproveNote'); note.input.required = false; note.input.maxLength = 2000;
    const confirmed = check('Bắt buộc: Tôi đã tự kiểm tra khoản tiền vào đúng tài khoản nhận và xác nhận đơn này được phép cộng phiếu.', 'paConfirmedBank');
    const submit = node('button', 'pb-button pb-button-primary', 'Xác nhận duyệt và cộng ' + number(order.quantity) + ' phiếu'); submit.type = 'submit';
    const actions = node('div', 'pb-actions'); actions.append(submit, button('Hủy', () => { if (!state.busy) clearForm(container); }));
    form.append(amount.label, reference.label, note.label, confirmed.label, actions);
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (state.busy || !form.reportValidity()) return;
      const amountText = amount.input.value.trim();
      const received = amountText === '' ? null : Number(amountText);
      if (received !== null && (!Number.isSafeInteger(received) || received !== Number(order.amountVnd)))
        return formSay(form, 'Nếu nhập số tiền thực nhận thì số tiền phải khớp đơn. Bạn cũng có thể để trống và chỉ xác nhận bằng ô tick bắt buộc.');
      const bankReference = reference.input.value.trim();
      if (bankReference && bankReference.length < 3) return formSay(form, 'Nếu nhập mã giao dịch thì cần ít nhất 3 ký tự.');
      await review(form, submit, { action: 'approve', orderId: order.id, receivedAmountVnd: received,
        bankReference, note: note.input.value.trim(), confirmedBankTransfer: confirmed.input.checked,
        idempotencyKey: keyFor('approve', order.id) }, 'Đã duyệt và cộng ' + number(order.quantity) + ' phiếu.');
    });
    container.append(form); amount.input.focus();
  }
  function showReject(container, order) {
    if (state.busy) return; clearForm(container);
    const form = node('form', 'pb-admin-confirm');
    form.append(node('h3', '', 'Từ chối đơn'), node('p', 'pb-small pb-muted', 'Lý do sẽ hiển thị cho người mua. Thao tác này không hoàn tiền ngân hàng.'));
    const note = field('Lý do từ chối', 'textarea', 'paRejectNote', 'Nêu rõ kết quả đối chiếu và cách xử lý tiếp theo'); note.input.minLength = 5; note.input.maxLength = 2000;
    const submit = node('button', 'pb-button pb-button-danger', 'Xác nhận từ chối'); submit.type = 'submit';
    const actions = node('div', 'pb-actions'); actions.append(submit, button('Hủy', () => { if (!state.busy) clearForm(container); }));
    form.append(note.label, actions);
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (state.busy || !form.reportValidity()) return;
      if (note.input.value.trim().length < 5) return formSay(form, 'Nhập lý do từ chối ít nhất 5 ký tự để người mua biết kết quả.');
      await review(form, submit, { action: 'reject', orderId: order.id, note: note.input.value.trim(), idempotencyKey: keyFor('reject', order.id) }, 'Đã từ chối đơn và lưu lý do.');
    });
    container.append(form); note.input.focus();
  }
  async function review(form, submit, payload, success) {
    state.busy = true; const original = submit.textContent; submit.disabled = true; submit.textContent = 'Đang lưu quyết định…';
    form.tabIndex = -1; form.focus({ preventScroll: true });
    $('paFilter').disabled = true; $('paRefresh').disabled = true;
    try {
      const result = await request('/api/admin-topups', payload);
      if (payload.orderId && result.order) state.selected = { ...state.selected, ...result.order };
      await loadOrders({ quiet: true }); say(success, 'success');
      if (payload.orderId) { renderDetail(); $('paDetail').focus(); }
      else $('paOperationsTitle').focus();
    } catch (error) {
      formSay(form, error.message); say(error.message, 'error');
      if (error.status === 401 || error.status === 403) await checkSession();
    } finally { state.busy = false; submit.disabled = false; submit.textContent = original; $('paFilter').disabled = false; $('paRefresh').disabled = false; }
  }
  function renderOperations() {
    const container = $('paOperations'); container.replaceChildren();
    if (!state.operations.length) { container.append(node('p', 'pb-muted', 'Không có phiếu chờ đối chiếu.')); return; }
    for (const operation of state.operations) {
      const section = node('div', 'pb-admin-operation');
      section.append(node('p', 'pb-admin-operation-title', (operation.customer?.email || 'Tài khoản chưa hiển thị') + ' · ' + number(operation.credits) + ' phiếu'),
        node('p', 'pb-small pb-muted', 'Mã lượt: ' + (operation.operationId || operation.id)),
        node('p', 'pb-small pb-muted', 'Form: ' + (operation.formId || '—') + ' · Bắt đầu: ' + date(operation.dispatchStartedAt || operation.createdAt)),
        node('p', 'pb-small', operation.resultNote || (operation.status === 'dispatching' ? 'Đang gửi hoặc đang chờ kết quả.' : 'Chưa xác định được kết quả gửi.')));
      const actions = node('div', 'pb-actions');
      const resolve = button('Đối chiếu và xử lý', () => showOperation(section, operation));
      resolve.disabled = !operation.canResolve;
      actions.append(resolve); section.append(actions);
      if (!operation.canResolve) section.append(node('p', 'pb-small pb-muted', 'Chưa thể xử lý để tránh trùng với yêu cầu đang gửi' + (operation.resolutionEligibleAt ? '. Có thể kiểm tra lại sau ' + date(operation.resolutionEligibleAt) : '') + '.'));
      container.append(section);
    }
  }
  function showOperation(container, operation) {
    if (state.busy || !operation.canResolve) return; clearForm(container);
    const form = node('form', 'pb-admin-confirm');
    form.append(node('h3', '', 'Kết quả đã đối chiếu'));
    const resolution = node('label', 'pb-field', 'Cách quyết toán');
    const select = node('select'); select.required = true;
    for (const [value, label] of [['', 'Chọn kết quả'], ['consume', 'Đã gửi thành công · Chốt trừ phiếu đang giữ'], ['release', 'Không gửi thành công · Trả phiếu đang giữ']]) {
      const option = node('option', '', label); option.value = value; select.append(option);
    }
    resolution.append(select);
    const evidence = field('Căn cứ đối chiếu (ít nhất 20 ký tự)', 'textarea', 'paEvidence-' + operation.id,
      'Ghi nguồn đối chiếu, thời điểm và thông tin xác định kết quả của lượt này'); evidence.input.minLength = 20; evidence.input.maxLength = 2000;
    const confirmed = check('Tôi đã kiểm tra được kết quả của đúng lượt này. Thao tác chỉ quyết toán phiếu và không gửi lại Form.', 'paResolve-' + operation.id);
    const submit = node('button', 'pb-button pb-button-primary', 'Xác nhận kết quả đối chiếu'); submit.type = 'submit';
    const actions = node('div', 'pb-actions'); actions.append(submit, button('Hủy', () => { if (!state.busy) clearForm(container); }));
    form.append(resolution, evidence.label, confirmed.label, actions);
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (state.busy || !form.reportValidity()) return;
      const note = evidence.input.value.trim(); if (note.length < 20) return formSay(form, 'Căn cứ đối chiếu cần ít nhất 20 ký tự.');
      await review(form, submit, { action: 'resolveOperation', operationId: operation.id, resolution: select.value, evidence: note,
        confirmedReview: confirmed.input.checked, idempotencyKey: keyFor('resolve-' + select.value, operation.id) },
        select.value === 'consume' ? 'Đã xác nhận gửi thành công và chốt trừ phiếu.' : 'Đã xác nhận không gửi thành công và trả phiếu đang giữ.');
    });
    container.append(form); select.focus();
  }
  async function retryEmail() {
    if (state.busy) return;
    const button = $('paRetryEmail'); button.disabled = true;
    try {
      await request('/api/billing-notifications', { action: 'retry' });
      say('Đã yêu cầu xử lý lại thông báo đang chờ hoặc bị lỗi. Xem trạng thái từng đơn sau khi làm mới.');
      await loadOrders({ quiet: true });
    } catch (error) { say(error.message, 'error'); }
    finally { button.disabled = false; }
  }
  function exportRevenueCsv() {
    if (!state.metrics) { say('Chưa có dữ liệu doanh thu để xuất.', 'error'); return; }
    const rows = [['month','revenue_vnd','approved_orders','credits_sold','buyers']];
    for (const item of state.metrics.monthly || []) rows.push([
      item.month,Number(item.revenueVnd||0),Number(item.approvedOrders||0),Number(item.creditsSold||0),Number(item.buyers||0)
    ]);
    const csv = rows.map(row => row.map(value => {
      const text = String(value ?? '');
      return /[",\n]/.test(text) ? '"' + text.replace(/"/g,'""') + '"' : text;
    }).join(',')).join('\n');
    const blob = new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'pandastudy-revenue-monthly.csv';
    document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    say('Đã tạo CSV doanh thu theo tháng.');
  }

  async function init() {
    if (await checkSession()) await Promise.all([loadOrders(), loadUsers(), loadMetrics(), loadCommerce()]);
  }
  $('paFilter').addEventListener('change', () => { if (!state.busy) { state.selected = null; loadOrders(); } });
  $('paRefresh').addEventListener('click', async () => {
    if (!state.busy && await checkSession()) await Promise.all([loadOrders(), loadUsers(), loadMetrics(), loadCommerce()]);
  });
  $('paRefreshMetrics')?.addEventListener('click', () => { if (!state.busy) loadMetrics(); });
  $('paExportRevenue')?.addEventListener('click', exportRevenueCsv);
  $('paRefreshCommerce')?.addEventListener('click', () => { if (!state.busy) loadCommerce(); });
  $('paNewPromotion')?.addEventListener('click', () => { if (!state.busy) newPromotion(); });
  $('paRetryEmail').addEventListener('click', retryEmail);
  $('paUserSearchForm')?.addEventListener('submit', event => {
    event.preventDefault();
    if (!state.busy) loadUsers();
  });
  $('paUserSearchClear')?.addEventListener('click', () => {
    if (!$('paUserSearch')) return;
    $('paUserSearch').value = '';
    if (!state.busy) loadUsers();
  });
  window.addEventListener('focus', () => {
    if (state.busy || $('paDetail').querySelector('form')) return;
    if (!state.profile?.user?.isAdmin) init();
    else Promise.all([loadOrders({quiet:true}), loadUsers({quiet:true}), loadMetrics({quiet:true}), loadCommerce({quiet:true})]);
  });
  setInterval(() => {
    if (!document.hidden && !state.busy && state.profile?.user?.isAdmin && !$('paDetail').querySelector('form'))
      Promise.all([loadOrders({quiet:true}), loadUsers({quiet:true}), loadMetrics({quiet:true}), loadCommerce({quiet:true})]);
  }, 30000);
  init();
})();
