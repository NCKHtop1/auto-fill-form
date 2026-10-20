'use strict';

(() => {
  const root = document.documentElement;
  const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = reduceQuery.matches;

  root.classList.add('motion-ready');

  function revealImmediately(elements) {
    elements.forEach(el => el.classList.add('is-visible'));
  }

  function setupReveal() {
    const selectors = [
      '.workspace',
      '.step',
      '.blog-section',
      '.section-block',
      '.steps-strip',
      '.pb-account-bar',
      '.wallet-panel'
    ];
    const elements = Array.from(document.querySelectorAll(selectors.join(',')));
    elements.forEach((el, index) => {
      el.classList.add('motion-reveal');
      el.style.setProperty('--motion-delay', Math.min(index % 4, 3) * 55 + 'ms');
    });

    if (reduced || !('IntersectionObserver' in window)) {
      revealImmediately(elements);
      return null;
    }

    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }, {rootMargin: '0px 0px -8% 0px', threshold: 0.08});

    elements.forEach(el => observer.observe(el));
    return observer;
  }

  function revealHashTarget() {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;
    const target = document.getElementById(id);
    if (target) target.classList.add('is-visible');
  }

  function handleReducedMotion(event) {
    reduced = event.matches;
    if (reduced) document.querySelectorAll('.motion-reveal').forEach(el => el.classList.add('is-visible'));
  }

  if (typeof reduceQuery.addEventListener === 'function') reduceQuery.addEventListener('change', handleReducedMotion);
  else if (typeof reduceQuery.addListener === 'function') reduceQuery.addListener(handleReducedMotion);

  window.addEventListener('hashchange', revealHashTarget, {passive: true});

  function init() {
    setupReveal();
    revealHashTarget();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true});
  else init();
})();
