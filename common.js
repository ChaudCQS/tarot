/* 塔罗抽牌 · 公共交互
   每页都引用：移动菜单、滚动揭示、tagline 逐字点亮。
   页面上没有对应元素时自动跳过，不会报错。 */
(function () {
  'use strict';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  /* ── 移动菜单 ───────────────────────── */
  var mobilePanel = document.getElementById('mobilePanel');
  var menuToggle = document.getElementById('menuToggle');

  function closeMobile() {
    if (!mobilePanel) return;
    mobilePanel.classList.remove('open');
    if (menuToggle) menuToggle.setAttribute('aria-expanded', 'false');
  }

  if (mobilePanel && menuToggle) {
    menuToggle.addEventListener('click', function () {
      var open = !mobilePanel.classList.contains('open');
      mobilePanel.classList.toggle('open', open);
      menuToggle.setAttribute('aria-expanded', String(open));
    });
    Array.prototype.forEach.call(mobilePanel.querySelectorAll('a'), function (a) {
      a.addEventListener('click', closeMobile);
    });
    var btn = document.getElementById('mobileClose');
    if (btn) btn.addEventListener('click', closeMobile);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeMobile();
    });
  }

  /* ── 滚动揭示 ───────────────────────── */
  function setupReveal() {
    var prefers = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var targets = document.querySelectorAll('.reveal');
    if (!targets.length) return;
    if (prefers || !('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(targets, function (n) { n.classList.add('on'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('on'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });
    Array.prototype.forEach.call(targets, function (n) { io.observe(n); });
  }

  /* ── tagline 逐字点亮 ───────────────────────── */
  function setupTagline() {
    var p = document.getElementById('tagline');
    if (!p) return;
    var text = p.textContent;
    p.textContent = '';
    var units = [];
    text.split(/([，。、；：！？—]+)/).forEach(function (part) {
      if (!part) return;
      if (/^[，。、；：！？—]+$/.test(part)) {
        p.appendChild(document.createTextNode(part));
        return;
      }
      part.split('').forEach(function (ch) {
        var s = el('span', 'word', ch);
        p.appendChild(s);
        units.push(s);
      });
    });

    var prefers = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefers || !('IntersectionObserver' in window)) {
      units.forEach(function (u) { u.classList.add('on'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        units.forEach(function (u, i) { setTimeout(function () { u.classList.add('on'); }, i * 42); });
      });
    }, { threshold: 0.35 });
    io.observe(p);
  }

  /* ── 首页扇形三张牌：进到视口自己翻开一遍 ───────────────────────── */
  function setupFan() {
    var fan = document.getElementById('fan');
    if (!fan) return;
    var prefers = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefers || !('IntersectionObserver' in window)) { fan.classList.add('is-on'); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        io.disconnect();
        setTimeout(function () { fan.classList.add('is-on'); }, 450);
      });
    }, { threshold: 0.35 });
    io.observe(fan);
  }

  setupReveal();
  setupTagline();
  setupFan();

  window.TAROT = { el: el, escapeHtml: escapeHtml, closeMobile: closeMobile };
})();
