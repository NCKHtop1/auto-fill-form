(function () {
  'use strict';

  const state = { checking: false, status: null };

  function elements() {
    return {
      gate: document.getElementById('psAuthGate'),
      status: document.getElementById('psAuthGateStatus'),
      retry: document.getElementById('psAuthRetry')
    };
  }

  function setStatus(text, error) {
    const {status} = elements();
    if (!status) return;
    status.textContent = text || '';
    status.classList.toggle('error', !!error);
  }

  function lock() {
    document.body.classList.add('ps-auth-pending');
    const {gate} = elements();
    if (gate) gate.hidden = false;
  }

  function unlock(data) {
    const {gate} = elements();
    if (gate) gate.hidden = true;
    document.body.classList.remove('ps-auth-pending');
    document.body.dataset.authenticated = 'true';
    window.dispatchEvent(new CustomEvent('pandastudy:auth-ready', {detail: data || {signedIn: true}}));
  }

  async function refresh() {
    if (state.checking) return state.status;
    state.checking = true;
    lock();
    setStatus('Đang kiểm tra phiên đăng nhập…');
    const {retry} = elements();
    if (retry) retry.hidden = true;
    try {
      const response = await fetch('/api/auth/status', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {'Accept': 'application/json'}
      });
      const data = await response.json().catch(() => ({}));
      state.status = data;
      if (!response.ok) throw new Error(data.error || 'Không kiểm tra được phiên đăng nhập.');
      if (data.configured && data.signedIn) {
        unlock(data);
        return data;
      }
      document.body.dataset.authenticated = 'false';
      if (!data.configured) {
        setStatus('Đăng nhập Google hiện chưa được cấu hình. Vui lòng liên hệ quản trị viên.', true);
      } else {
        setStatus('Bạn cần đăng nhập Google để vào PandaStudy.');
      }
      return data;
    } catch (error) {
      document.body.dataset.authenticated = 'false';
      setStatus(error?.message || 'Không kiểm tra được phiên đăng nhập. Hãy thử lại.', true);
      if (retry) retry.hidden = false;
      return null;
    } finally {
      state.checking = false;
    }
  }

  function init() {
    const {retry} = elements();
    if (retry) retry.addEventListener('click', refresh);
    refresh();
  }

  window.PandaAuthGate = {refresh, getStatus: () => state.status};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();