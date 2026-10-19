/* PandaStudy manual top-ups. Does not alter or resume the six-step form workflow. */
(function () {
  'use strict';
  const state = { profile: null, order: null, orders: [], busy: false, open: false,
    intent: null, poll: null, refreshPromise: null, ordersLoaded: false, previousFocus: null,
    adminPending: null, selectedPackageId: 'popular' };
  const labels = { pending_payment: 'Chờ chuyển khoản', pending_review: 'Chờ duyệt', approved: 'Đã cộng phiếu', rejected: 'Cần xử lý' };
  let host, overlay, content, message, oldOverflow, promo;
  const number = value => Number(value || 0).toLocaleString('vi-VN');
  const money = value => number(value) + ' đ';
  const node = (tag, klass, text) => {
    const element = document.createElement(tag);
    if (klass) element.className = klass;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  function button(text, handler, primary = false) {
    const element = node('button', 'pb-button' + (primary ? ' pb-button-primary' : ''), text);
    element.type = 'button';
    element.addEventListener('click', handler);
    return element;
  }
  function key() { return window.crypto?.randomUUID?.() || 'pd-' + Date.now() + '-' + Math.random().toString(36).slice(2); }
  function stamp(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('vi-VN'); }
  async function request(action, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch('/api/billing' + (body ? '' : '?action=' + action), {
        method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }) } : {})
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) {
        const error = new Error(data.error || 'Chưa tải được thông tin. Vui lòng thử lại.');
        error.code = data.code;
        throw error;
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('Chưa nhận được phản hồi từ máy chủ. Kiểm tra kết nối rồi thử lại; không chuyển khoản thêm.');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  function say(text, kind = '') {
    if (!message) return;
    message.textContent = text || '';
    message.className = 'pb-status' + (text ? ' pb-notice' : '') + (kind ? ' pb-notice-' + kind : '');
    message.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  }
  function loginLink() {
    const link = node('a', 'pb-button pb-button-primary', 'Kết nối Google');
    link.href = '/api/auth/start'; link.target = '_blank'; link.rel = 'noopener';
    link.setAttribute('aria-label', 'Kết nối Google, mở trong thẻ mới');
    return link;
  }
  async function logout() {
    if (state.busy) return;
    state.busy = true;
    try {
      await fetch('/api/auth/logout', {method:'POST', credentials:'same-origin', cache:'no-store'});
    } finally {
      location.assign('/');
    }
  }
  function packages() {
    return Array.isArray(state.profile?.topupPackages) ? state.profile.topupPackages : [];
  }
  function packageById(id) { return packages().find(item => item.id === id) || null; }
  function popularPackage() { return packages().find(item => item.popular) || packages()[0] || null; }
  function renderPromo() {
    promo?.remove(); promo = null;
    const profile = state.profile;
    if (!profile?.signedIn) return;
    try { if (sessionStorage.getItem('pandastudy-topup-promo-dismissed') === '1') return; } catch (_) {}
    const activePromotion = Array.isArray(profile.activePromotions) ? profile.activePromotions[0] : null;
    const granted = activePromotion && Array.isArray(profile.promotionGrants)
      ? profile.promotionGrants.find(item => item.id === activePromotion.id)
      : null;
    const offer = profile.purchasesEnabled ? popularPackage() : null;
    if (!activePromotion && !offer) return;
    promo = node('aside', 'pb-promo-strip');
    promo.setAttribute('aria-label', activePromotion ? 'Ưu đãi trải nghiệm PandaStudy' : 'Ưu đãi nạp phiếu');
    const copy = node('div', 'pb-promo-copy');
    if (activePromotion) {
      copy.append(
        node('strong','',granted ? '🎁 Đã nhận +' + number(activePromotion.credits) + ' phiếu trải nghiệm' : '🎁 ' + activePromotion.name),
        node('span','',granted ? 'Ưu đãi đã được cộng một lần vào tài khoản của bạn.' : (activePromotion.description || 'Đăng nhập trong thời gian ưu đãi để nhận phiếu.'))
      );
    } else {
      copy.append(node('strong', '', '⭐ Gói ' + offer.name + ': ' + number(offer.credits) + ' phiếu · ' + money(offer.priceVnd)),
        node('span', '', offer.discountPercent ? 'Tiết kiệm ' + offer.discountPercent + '% so với mua lẻ.' : 'Nạp trước để không gián đoạn khi gửi dữ liệu.'));
    }
    const actions = node('div', 'pb-promo-actions');
    if (offer) actions.append(button('Xem các gói', () => openPurchase({packageId:offer.id}), true));
    const dismiss = button('×', () => {
      try { sessionStorage.setItem('pandastudy-topup-promo-dismissed','1'); } catch (_) {}
      promo?.remove(); promo = null;
    });
    dismiss.classList.add('pb-promo-dismiss'); dismiss.setAttribute('aria-label','Ẩn thông báo ưu đãi');
    actions.append(dismiss); promo.append(copy,actions);
    (document.querySelector('.topbar') || host)?.insertAdjacentElement('afterend',promo);
  }

  async function refreshAdminPending(profile) {
    if (!profile?.user?.isAdmin) { state.adminPending = null; return; }
    try {
      const response = await fetch('/api/admin-topups?status=pending_review', {
        credentials:'same-origin', cache:'no-store', headers:{'Accept':'application/json'}
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) throw new Error(data.error || 'admin');
      state.adminPending = Array.isArray(data.orders) ? data.orders.length : 0;
    } catch (_) {
      state.adminPending = null;
    }
  }
  function renderBar() {
    if (!host) return;
    const profile = state.profile;
    // The account bar is now part of the authenticated shell, not merely a
    // billing advertisement. It stays visible even while top-ups are paused.
    host.hidden = !profile?.signedIn;
    host.replaceChildren();
    if (host.hidden) return;
    const copy = node('div', 'pb-account-copy');
    const actions = node('div', 'pb-actions');
    copy.append(node('span', 'pb-account-email pb-small pb-muted', profile.user?.email || 'Đã đăng nhập Google'));

    if (!profile.billingEnabled) {
      copy.prepend(node('span', 'pb-account-title', 'Tài khoản PandaStudy'));
      copy.append(node('span', 'pb-account-email pb-small pb-muted', 'Hệ thống phiếu đang được quản trị viên chuẩn bị.'));
    } else if (!profile.configured) {
      copy.prepend(node('span', 'pb-account-title', 'Tài khoản PandaStudy'));
      copy.append(node('span', 'pb-account-email pb-small pb-muted', 'Số dư tạm thời chưa tải được. Chưa chuyển khoản lúc này.'));
      actions.append(button('Kiểm tra lại', () => refresh()));
    } else {
      copy.prepend(node('span', 'pb-account-title', number(profile.availableCredits) + ' phiếu khả dụng'));
      if (Number(profile.reservedCredits) > 0) copy.append(node('span', 'pb-small pb-muted', ' · ' + number(profile.reservedCredits) + ' phiếu đang chờ đối chiếu'));
      const activePromo = Array.isArray(profile.activePromotions) ? profile.activePromotions[0] : null;
      if (activePromo && Array.isArray(profile.promotionGrants) && profile.promotionGrants.some(item => item.id === activePromo.id))
        copy.append(node('span','pb-account-email pb-small pb-muted','🎁 Đã nhận +' + number(activePromo.credits) + ' phiếu · ' + activePromo.name));
      if (profile.purchasesEnabled === false) copy.append(node('span', 'pb-account-email pb-small pb-muted', 'Mua phiếu mới đang tạm dừng. Số phiếu hiện có được giữ nguyên.'));
      else actions.append(button('Nạp phiếu', openPurchase, true));
      actions.append(button('Lịch sử nạp', () => openPurchase({ showOrders: true })));
    }

    if (profile.user?.isAdmin) {
      copy.append(node('span', 'pb-account-email pb-small pb-muted', 'Quyền: quản trị viên PandaStudy'));
      const pending = Number.isInteger(state.adminPending) ? state.adminPending : null;
      const label = pending === null ? 'Quản trị nạp' : (pending > 0 ? 'Quản trị nạp · ' + pending + ' chờ duyệt' : 'Quản trị nạp · không có đơn chờ');
      const admin = node('a', 'pb-button', label);
      admin.href = '/admin-topups.html'; admin.target = '_blank'; admin.rel = 'noopener';
      actions.append(admin);
    }
    actions.append(button('Đăng xuất', logout));
    host.append(copy, actions);
    if (profile.purchasesEnabled) {
      const offer = popularPackage();
      if (offer) {
        const hint = node('div', 'pb-account-offer');
        const low = Number(profile.availableCredits) <= 10;
        hint.append(node('strong', '', low ? 'Sắp hết phiếu?' : 'Gợi ý tiết kiệm'),
          node('span', '', number(offer.credits) + ' phiếu · ' + money(offer.priceVnd) + (offer.discountPercent ? ' · giảm ' + offer.discountPercent + '%' : '')));
        const cta = button(low ? 'Nạp trước' : 'Xem gói', () => openPurchase({packageId:offer.id}), true);
        hint.append(cta); host.append(hint);
      }
    }
    renderPromo();
  }
  async function refresh() {
    if (state.refreshPromise) return state.refreshPromise;
    state.refreshPromise = (async () => {
      try {
        const previous = state.profile?.user?.id;
        const previousPurchases = state.profile?.purchasesEnabled;
        const profile = await request('profile');
        const changedUser = previous !== profile.user?.id;
        state.profile = profile;
        if (changedUser) { state.order = null; state.orders = []; state.ordersLoaded = false; state.intent = null; state.adminPending = null; stopPoll(); }
        await refreshAdminPending(profile);
        renderBar();
        if (!profile.billingEnabled && state.open) close();
        else if (state.open && (changedUser || !profile.configured || previousPurchases !== profile.purchasesEnabled)) renderModal();
        document.dispatchEvent(new CustomEvent('pandastudy:billing-profile', { detail: profile }));
        return profile;
      } catch (error) {
        if (state.open) say(error.message, 'error');
        return null;
      } finally { state.refreshPromise = null; }
    })();
    return state.refreshPromise;
  }
  function createModal() {
    if (overlay) return;
    overlay = node('div', 'pb-overlay'); overlay.hidden = true;
    const modal = node('section', 'pb-modal');
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'pbPurchaseTitle'); modal.tabIndex = -1;
    const head = node('div', 'pb-modal-head');
    const heading = node('div');
    const title = node('h2', '', 'Mua thêm phiếu'); title.id = 'pbPurchaseTitle'; title.tabIndex = -1;
    heading.append(title, node('p', 'pb-small pb-muted', 'Phiếu được cộng sau khi quản trị viên kiểm tra tiền vào ngân hàng.'));
    const closeButton = button('×', close); closeButton.classList.add('pb-close');
    closeButton.setAttribute('aria-label', 'Đóng mua phiếu');
    head.append(heading, closeButton);
    content = node('div', 'pb-modal-body');
    modal.append(head, content); overlay.append(modal); document.body.append(overlay);
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab') return;
      const candidates = [...modal.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]')]
        .filter(item => !item.hidden && item.getClientRects().length);
      const first = candidates[0], last = candidates[candidates.length - 1];
      if (!first) { event.preventDefault(); modal.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === modal)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  }
  async function openPurchase(options) {
    createModal();
    const profile = await refresh();
    if (!profile?.billingEnabled) return false;
    state.previousFocus = document.activeElement;
    if (!state.open) { oldOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
    state.open = true; overlay.hidden = false;
    if (options?.showOrders) state.order = null;
    if (options?.packageId && packageById(options.packageId)) {
      state.selectedPackageId = options.packageId;
      state.intent = null;
      state.order = null;
    }
    renderModal();
    overlay.querySelector('.pb-close').focus();
    if (profile.configured && profile.signedIn) {
      await loadOrders();
      if (options?.showOrders) document.getElementById('pbOrderHistory')?.scrollIntoView({ block: 'nearest' });
    }
    return true;
  }
  function close() {
    state.open = false; stopPoll();
    if (overlay) overlay.hidden = true;
    document.body.style.overflow = oldOverflow || '';
    if (state.previousFocus?.isConnected) state.previousFocus.focus();
  }
  function renderModal() {
    if (!state.open) return;
    const restoreFocus = content.contains(document.activeElement) || document.activeElement === document.body;
    content.replaceChildren();
    const profile = state.profile;
    const body = node('div');
    if (!profile?.configured) {
      body.append(node('p', 'pb-notice pb-notice-warning', 'Mua phiếu hiện chưa sẵn sàng. Vui lòng quay lại sau; chưa chuyển khoản lúc này.'),
        button('Kiểm tra lại', async () => { await refresh(); renderModal(); }));
    } else if (!profile.signedIn) {
      body.append(node('p', '', 'Kết nối Google để phiếu được cộng vào đúng tài khoản PandaStudy của bạn.'), loginLink(),
        node('p', 'pb-small pb-muted', 'Kết nối mở trong thẻ mới để giữ dữ liệu đang nhập. Sau khi kết nối, quay lại đây.'),
        button('Tôi đã kết nối · Kiểm tra lại', async () => { await refresh(); renderModal(); if (state.profile?.signedIn) await loadOrders(); }));
    } else {
      const account = node('div', 'pb-notice');
      account.append(node('strong', '', number(profile.availableCredits) + ' phiếu khả dụng'), node('div', 'pb-small', profile.user?.email || ''));
      if (Number(profile.reservedCredits) > 0) account.append(node('div', 'pb-small', number(profile.reservedCredits) + ' phiếu đang chờ đối chiếu kết quả gửi.'));
      body.append(account);
      if (state.order) renderOrder(body, state.order);
      else if (profile.purchasesEnabled === false) body.append(node('p', 'pb-notice pb-notice-warning', 'Mua phiếu mới đang tạm dừng. Chưa chuyển khoản lúc này. Bạn vẫn có thể xem đơn và sử dụng số phiếu hiện có.'));
      else renderCreate(body);
      renderOrders(body);
    }
    message = node('div', 'pb-status'); message.setAttribute('aria-live', 'polite'); message.setAttribute('aria-atomic', 'true');
    content.append(body, message);
    if (restoreFocus) document.getElementById('pbPurchaseTitle')?.focus({ preventScroll: true });
    schedulePoll();
  }
  function renderCreate(parent) {
    const section = node('section', 'pb-section');
    section.append(node('h3', '', 'Chọn gói phiếu phù hợp'),
      node('p', 'pb-small pb-muted', 'Gói lớn có giá tốt hơn. Bạn vẫn có thể nhập số lượng khác ở bên dưới.'));

    const catalog = packages();
    let selectedId = packageById(state.selectedPackageId)?.id || popularPackage()?.id || null;
    const cardMap = new Map();
    if (catalog.length) {
      const grid = node('div', 'pb-package-grid');
      for (const pkg of catalog) {
        const card = node('button', 'pb-package-card');
        card.type = 'button';
        card.dataset.packageId = pkg.id;
        card.setAttribute('aria-pressed', pkg.id === selectedId ? 'true' : 'false');
        if (pkg.featured || pkg.popular) card.classList.add('pb-package-popular');
        const top = node('div', 'pb-package-top');
        top.append(node('strong', '', pkg.name));
        if (pkg.featured || pkg.popular || pkg.badge) top.append(node('span', 'pb-package-badge', pkg.badge || 'Nổi bật'));
        card.append(top,node('div','pb-package-credits',number(pkg.credits)+' phiếu'));
        const priceRow = node('div','pb-package-price');
        priceRow.append(node('strong','',money(pkg.priceVnd)));
        if (pkg.listPriceVnd > pkg.priceVnd) priceRow.append(node('s','',money(pkg.listPriceVnd)));
        card.append(priceRow);
        if (pkg.discountPercent) card.append(node('span','pb-package-save','Tiết kiệm '+pkg.discountPercent+'%'));
        else card.append(node('span','pb-package-save','Giá tiêu chuẩn'));
        grid.append(card); cardMap.set(pkg.id,card);
      }
      section.append(grid);
    }

    const form = node('form');
    const field = node('label', 'pb-field', 'Hoặc nhập số phiếu khác');
    const input = node('input'); input.type = 'number'; input.inputMode = 'numeric'; input.id = 'pbQuantity';
    input.min = String(state.profile.minTopupCredits || 1); input.max = String(state.profile.maxTopupCredits || 100000); input.step = '1';
    input.value = selectedId ? '' : String(state.intent?.quantity || 20);
    input.placeholder = 'Ví dụ: 50'; field.htmlFor = input.id; field.append(input);

    const note = node('p', 'pb-small pb-muted', money(Number(state.profile.unitPriceVnd)) + ' / phiếu nếu mua số lượng tùy chọn.');
    const total = node('div', 'pb-total'); total.append(node('span', '', 'Tổng chuyển khoản'));
    const amount = node('strong'); total.append(amount);
    const saving = node('p','pb-package-summary pb-small');
    const submit = node('button', 'pb-button pb-button-primary', 'Tạo yêu cầu nạp'); submit.type = 'submit'; submit.disabled = state.busy;

    function update() {
      for (const [id,card] of cardMap) {
        const active = id === selectedId;
        card.classList.toggle('is-selected',active);
        card.setAttribute('aria-pressed',active ? 'true' : 'false');
      }
      const pkg = selectedId ? packageById(selectedId) : null;
      if (pkg) {
        amount.textContent = money(pkg.priceVnd);
        saving.textContent = pkg.discountPercent
          ? 'Bạn nhận ' + number(pkg.credits) + ' phiếu · tiết kiệm ' + money(pkg.listPriceVnd-pkg.priceVnd) + ' (' + pkg.discountPercent + '%).'
          : 'Bạn nhận ' + number(pkg.credits) + ' phiếu.';
        submit.textContent = 'Chọn gói ' + pkg.name + ' · ' + money(pkg.priceVnd);
      } else {
        const quantity = Number(input.value);
        const valid = Number.isSafeInteger(quantity) && quantity >= Number(input.min) && quantity <= Number(input.max);
        amount.textContent = valid ? money(quantity * Number(state.profile.unitPriceVnd)) : '—';
        saving.textContent = valid ? number(quantity) + ' phiếu theo giá tiêu chuẩn.' : 'Nhập số phiếu để xem tổng tiền.';
        submit.textContent = 'Tạo yêu cầu nạp';
      }
    }
    for (const [id,card] of cardMap) card.addEventListener('click', () => {
      selectedId = id; state.selectedPackageId = id; state.intent = null; input.value = ''; update();
    });
    input.addEventListener('input', () => {
      selectedId = null; state.selectedPackageId = null; state.intent = null; update();
    });
    update();

    form.append(field,note,total,saving,submit);
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (state.busy || !form.reportValidity()) return;
      const pkg = selectedId ? packageById(selectedId) : null;
      let offerKey, payload;
      if (pkg) {
        offerKey = 'package:' + pkg.id;
        payload = {packageId:pkg.id,quantity:pkg.credits};
      } else {
        const quantity = Number(input.value);
        if (!Number.isSafeInteger(quantity) || quantity < Number(input.min) || quantity > Number(input.max))
          return say('Nhập số phiếu nguyên trong khoảng ' + number(input.min) + '–' + number(input.max) + '.', 'error');
        offerKey = 'custom:' + quantity;
        payload = {quantity};
      }
      if (!state.intent || state.intent.offerKey !== offerKey)
        state.intent = {...payload,offerKey,idempotencyKey:key()};
      const requestUser = state.profile.user?.id;
      state.busy = true; submit.disabled = true; input.disabled = true; submit.textContent = 'Đang tạo yêu cầu…'; say('');
      for (const card of cardMap.values()) card.disabled = true;
      document.getElementById('pbPurchaseTitle')?.focus({ preventScroll: true });
      try {
        const {offerKey:_,...requestPayload} = state.intent;
        const result = await request('create', requestPayload);
        if (requestUser !== state.profile.user?.id) return;
        if (!result.order) throw new Error('Chưa nhận được thông tin đơn. Vui lòng kiểm tra lại trước khi chuyển khoản.');
        state.order = result.order; state.intent = null; state.ordersLoaded = false; state.busy = false;
        renderModal(); await loadOrders();
      } catch (error) { say(error.message, 'error'); }
      finally {
        state.busy = false; submit.disabled = false; input.disabled = false;
        for (const card of cardMap.values()) card.disabled = false;
        update();
      }
    });
    section.append(form); parent.append(section);
  }

  async function copy(text) {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(String(text));
      else {
        const area = node('textarea'); area.value = String(text); area.style.position = 'fixed'; area.style.opacity = '0'; content.append(area); area.select();
        const copied = document.execCommand('copy'); area.remove(); if (!copied) throw new Error('copy');
      }
      say('Đã sao chép.');
    } catch { say('Chưa sao chép được. Bạn có thể chọn và sao chép trực tiếp nội dung hiển thị.', 'error'); }
  }
  function detail(list, title, value, copyable = false) {
    const row = node('div', 'pb-detail-row'); row.append(node('dt', '', title), node('dd', '', String(value ?? '—')));
    if (copyable) { const b = button('Sao chép', () => copy(value)); b.classList.add('pb-copy'); b.setAttribute('aria-label', 'Sao chép ' + title.toLowerCase()); row.append(b); }
    list.append(row);
  }
  function renderOrder(parent, order) {
    const section = node('section', 'pb-section');
    const heading = node('h3', '', 'Đơn ' + (order.orderCode || order.id));
    const badge = node('span', 'pb-badge pb-badge-' + order.status, labels[order.status] || 'Đang xử lý');
    section.append(heading, badge);
    if (order.status === 'approved') {
      section.append(node('p', 'pb-notice pb-notice-success', 'Đã cộng ' + number(order.quantity) + ' phiếu vào tài khoản. Bạn có thể đóng cửa sổ này và chủ động tiếp tục ở bước gửi.'));
    } else if (order.status === 'pending_review') {
      section.append(node('p', 'pb-notice pb-notice-warning', 'Đã nhận thông báo bạn chuyển khoản. Quản trị viên đang kiểm tra tiền vào ngân hàng; phiếu chưa được cộng. Không chuyển khoản thêm cho đơn này.'));
    } else if (order.status === 'rejected') {
      section.append(node('p', 'pb-notice pb-notice-warning', 'Đơn chưa được duyệt. Nếu bạn đã chuyển tiền, giữ mã đơn và chứng từ để quản trị viên kiểm tra; chưa chuyển khoản lại.'));
      if (order.adminNote) section.append(node('p', '', 'Ghi chú: ' + order.adminNote));
    }
    const summary = node('dl', 'pb-details');
    if (order.package) detail(summary, 'Gói', order.package.name + (order.package.popular ? ' · Phổ biến nhất' : ''));
    detail(summary, 'Số phiếu', number(order.quantity) + ' phiếu');
    if (Number(order.discountPercent) > 0) detail(summary, 'Ưu đãi', 'Giảm ' + number(order.discountPercent) + '% · tiết kiệm ' + money(Number(order.listPriceVnd)-Number(order.amountVnd)));
    detail(summary, 'Số tiền', money(order.amountVnd), order.status === 'pending_payment' && state.profile.purchasesEnabled !== false);
    detail(summary, 'Tài khoản nhận phiếu', state.profile.user?.email || '');
    if (order.createdAt) detail(summary, 'Tạo lúc', stamp(order.createdAt));
    section.append(summary);
    if (order.status === 'pending_payment') {
      const bank = order.bank;
      const paused = state.profile.purchasesEnabled === false;
      const ready = state.profile.configured && !paused && bank?.accountNumber && bank?.accountName && order.paymentMemo && Number(order.amountVnd) > 0;
      if (ready) {
        const list = node('dl', 'pb-details');
        detail(list, 'Ngân hàng', bank.bankName || 'Techcombank');
        detail(list, 'Số tài khoản', bank.accountNumber, true);
        detail(list, 'Người thụ hưởng', bank.accountName);
        detail(list, 'Nội dung chuyển khoản', order.paymentMemo, true);
        section.append(list);
        if (order.qrImageUrl) {
          try {
            const url = new URL(order.qrImageUrl, location.origin);
            if (url.origin === location.origin) {
              const figure = node('figure', 'pb-qr');
              const image = node('img'); image.src = url.href; image.alt = 'QR chuyển khoản ' + (bank.bankName || 'Techcombank') + ', tài khoản ' + bank.accountNumber;
              image.addEventListener('error', () => { image.hidden = true; });
              figure.append(image, node('figcaption', '', order.qrHasAmountAndMemo
                 ? 'QR đã gồm đúng số tiền và nội dung chuyển khoản của đơn này. Vẫn kiểm tra người thụ hưởng trước khi xác nhận trong ứng dụng ngân hàng.'
                 : 'QR chưa có sẵn số tiền và nội dung chuyển khoản. Sau khi quét, nhập đúng số tiền và nội dung của đơn ở trên.'));
              const openQr = node('a', 'pb-button', 'Mở QR để lưu');
              openQr.href = url.href; openQr.target = '_blank'; openQr.rel = 'noopener'; openQr.style.marginTop = '10px';
              openQr.setAttribute('aria-label', 'Mở ảnh QR trong thẻ mới để lưu'); figure.append(openQr);
              section.append(figure);
            }
          } catch { /* The account and payment memo remain available if the QR URL is invalid. */ }
        }
        section.append(node('p', 'pb-small pb-muted', 'Chỉ chuyển đúng số tiền của đơn vào người thụ hưởng hiển thị trên đây. Bấm xác nhận bên dưới sau khi đã chuyển.'));
      } else if (paused) section.append(node('p', 'pb-notice pb-notice-warning', 'Mua phiếu mới đang tạm dừng. Chưa chuyển khoản lúc này. Nếu bạn đã chuyển tiền cho đơn này, xác nhận bên dưới để quản trị viên kiểm tra.'));
      else section.append(node('p', 'pb-notice pb-notice-error', 'Chưa có đủ thông tin thanh toán. Không chuyển khoản; hãy kiểm tra lại trạng thái.'));
      if (ready || paused) {
        const paid = button('Tôi đã chuyển khoản', async () => {
          if (state.busy) return; state.busy = true; paid.disabled = true; say('');
          document.getElementById('pbPurchaseTitle')?.focus({ preventScroll: true });
          const requestUser = state.profile.user?.id;
          try { const result = await request('submitPaid', { orderId: order.id }); if (requestUser !== state.profile.user?.id) return; if (result.order) state.order = result.order; renderModal(); await loadOrders(); }
          catch (error) { say(error.message, 'error'); }
          finally { state.busy = false; paid.disabled = false; }
        }, true);
        paid.disabled = state.busy; section.append(paid);
      }
    }
    const actions = node('div', 'pb-actions'); actions.style.marginTop = '14px';
    actions.append(button('Kiểm tra trạng thái', () => checkOrder(true)));
    actions.append(button('Quay lại danh sách', () => { state.order = null; stopPoll(); renderModal(); }));
    section.append(actions); parent.append(section);
  }
  function renderOrders(parent) {
    const section = node('section', 'pb-section'); section.id = 'pbOrderHistory';
    section.append(node('h3', '', 'Đơn mua của bạn'));
    if (!state.ordersLoaded) section.append(node('p', 'pb-muted pb-small', 'Đang tải đơn mua…'));
    else if (!state.orders.length) section.append(node('p', 'pb-muted pb-small', 'Chưa có đơn mua phiếu.'));
    else {
      const list = node('ul', 'pb-order-list');
      for (const order of state.orders) {
        const item = node('li');
        const open = button('', () => { state.order = order; renderModal(); content.scrollTop = 0; checkOrder(false); }); open.classList.add('pb-order-button');
        const text = node('span', '', (order.package ? order.package.name + ' · ' : '') + number(order.quantity) + ' phiếu · ' + money(order.amountVnd));
        text.append(node('span', 'pb-order-meta', (order.orderCode || order.id) + (order.createdAt ? ' · ' + stamp(order.createdAt) : '')));
        open.append(text, node('span', 'pb-badge pb-badge-' + order.status, labels[order.status] || 'Đang xử lý')); item.append(open); list.append(item);
      }
      section.append(list);
    }
    parent.append(section);
  }
  async function loadOrders() {
    if (!state.profile?.configured || !state.profile?.signedIn) return;
    try {
      const userId = state.profile.user?.id;
      const result = await request('orders');
      if (userId !== state.profile.user?.id) return;
      state.orders = Array.isArray(result.orders) ? result.orders : []; state.ordersLoaded = true;
      const section = document.getElementById('pbOrderHistory');
      if (state.open && section) {
        const restoreFocus = section.contains(document.activeElement);
        const wrapper = node('div'); renderOrders(wrapper); section.replaceWith(wrapper.firstChild);
        if (restoreFocus) document.getElementById('pbPurchaseTitle')?.focus({ preventScroll: true });
      }
    } catch (error) {
      state.ordersLoaded = true;
      const section = document.getElementById('pbOrderHistory');
      if (state.open && section) { section.replaceChildren(node('h3', '', 'Đơn mua của bạn'), node('p', 'pb-notice pb-notice-error', error.message), button('Tải lại đơn mua', loadOrders)); }
    }
  }
  async function checkOrder(explicit = false) {
    const current = state.order; if (!current || !state.profile?.configured) return;
    try {
      const result = await request('status&orderId=' + encodeURIComponent(current.id));
      if (!result.order || state.order?.id !== current.id) return;
      const changed = result.order.status !== current.status;
      state.order = result.order;
      if (changed) { await refresh(); renderModal(); await loadOrders(); }
      else if (explicit) say('Đã cập nhật: ' + (labels[result.order.status] || 'Đang xử lý') + '.');
      schedulePoll();
    } catch (error) { if (explicit || state.open) say(error.message, 'error'); schedulePoll(); }
  }
  function stopPoll() { clearTimeout(state.poll); state.poll = null; }
  function schedulePoll() {
    stopPoll();
    if (state.open && state.order && ['pending_payment', 'pending_review'].includes(state.order.status) && !document.hidden) {
      state.poll = setTimeout(() => checkOrder(false), 10000);
    }
  }
  function init() {
    host = document.getElementById('pandaBillingRoot'); if (!host) return;
    refresh();
    window.addEventListener('focus', async () => { await refresh(); if (state.open && state.profile?.signedIn) { await loadOrders(); await checkOrder(false); } });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopPoll(); else { refresh(); schedulePoll(); } });
    document.addEventListener('pandastudy:billing-refresh', refresh);
    window.addEventListener('pandastudy:billing-refresh', refresh);
  }
  window.PandaBilling = { refresh, openPurchase, getProfile: () => state.profile };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
