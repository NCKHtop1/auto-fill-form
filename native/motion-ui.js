'use strict';

(() => {
  const root = document.documentElement;
  const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  let reduced = reduceQuery.matches;
  let pageVisible = !document.hidden;
  let hero = null;
  let frame = 0;
  let pendingX = 0;
  let pendingY = 0;

  root.classList.add('motion-ready');

  function setHeroNeutral() {
    if (!hero) return;
    hero.style.setProperty('--parallax-x', '0px');
    hero.style.setProperty('--parallax-y', '0px');
    hero.style.setProperty('--parallax-rx', '0deg');
    hero.style.setProperty('--parallax-ry', '0deg');
  }

  function applyParallax() {
    frame = 0;
    if (!hero || reduced || !finePointer.matches || !pageVisible) {
      setHeroNeutral();
      return;
    }
    const x = Math.max(-1, Math.min(1, pendingX));
    const y = Math.max(-1, Math.min(1, pendingY));
    hero.style.setProperty('--parallax-x', (x * 7).toFixed(2) + 'px');
    hero.style.setProperty('--parallax-y', (y * 5).toFixed(2) + 'px');
    hero.style.setProperty('--parallax-rx', (-y * 1.6).toFixed(2) + 'deg');
    hero.style.setProperty('--parallax-ry', (x * 2.1).toFixed(2) + 'deg');
  }

  function scheduleParallax() {
    if (frame) return;
    frame = window.requestAnimationFrame(applyParallax);
  }

  function onHeroPointer(event) {
    if (!hero || reduced || !finePointer.matches) return;
    const rect = hero.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pendingX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    pendingY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    scheduleParallax();
  }

  function onHeroLeave() {
    pendingX = 0;
    pendingY = 0;
    scheduleParallax();
  }

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

  function setupHero() {
    hero = document.querySelector('.hero-art');
    if (!hero) return;
    hero.addEventListener('pointermove', onHeroPointer, {passive: true});
    hero.addEventListener('pointerleave', onHeroLeave, {passive: true});
    setHeroNeutral();
  }

  function handleReducedMotion(event) {
    reduced = event.matches;
    if (reduced) {
      document.querySelectorAll('.motion-reveal').forEach(el => el.classList.add('is-visible'));
      setHeroNeutral();
    }
  }

  document.addEventListener('visibilitychange', () => {
    pageVisible = !document.hidden;
    if (!pageVisible) setHeroNeutral();
  });

  if (typeof reduceQuery.addEventListener === 'function') reduceQuery.addEventListener('change', handleReducedMotion);
  else if (typeof reduceQuery.addListener === 'function') reduceQuery.addListener(handleReducedMotion);

  window.addEventListener('hashchange', revealHashTarget, {passive: true});

  function init() {
    setupHero();
    setupReveal();
    revealHashTarget();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true});
  else init();
})();
