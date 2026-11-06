/* 塔罗抽牌 · 牌桌页逻辑
   牌桌是绝对定位画布：牌阵数据里每个位置给 x/y（以「一格 = 一张牌宽」为单位，1 起算），
   渲染时换算成像素 left=(x-1)*(cw+gap)、top=(y-1)*(cardH+labelH+gap)。
   公共部分（移动菜单、reveal、tagline）在 common.js。 */
(function () {
  'use strict';

  var LS_KEY = 'tarot.settings.v1';
  var DECK = TAROT_CARDS.slice();
  var DATA = {}; TAROT_CARDS.forEach(function (c) { DATA[c.id] = c; });
  var CARD_RATIO = 0.573;   // 韦特牌宽高比
  var LABEL_H = 34;         // 牌位名预留高度（可能换两行）

  var state = {
    spreadId: 'three',
    cards: [],           // [{ id, reversed, flipped }]
    settings: { apiKey: '', model: 'deepseek-chat', reversed: true },
    reading: null,
    streamText: null,   // 流式过程中的半成品，null 表示还没开始
    loading: false,
    error: ''
  };

  /* ── 工具 ───────────────────────── */
  var el = window.TAROT.el;
  var escapeHtml = window.TAROT.escapeHtml;

  function rand(n) {
    var buf = new Uint32Array(1);
    var limit = Math.floor(4294967296 / n) * n;
    var v;
    do {
      if (window.crypto && window.crypto.getRandomValues) {
        window.crypto.getRandomValues(buf);
        v = buf[0];
      } else {
        v = Math.floor(Math.random() * 4294967296);
      }
    } while (v >= limit);
    return v % n;
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = rand(i + 1);
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function count(s) { return s.positions.length; }

  function spread() {
    for (var i = 0; i < SPREADS.length; i++) if (SPREADS[i].id === state.spreadId) return SPREADS[i];
    return SPREADS[0];
  }

  function loadSettings() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      var s = JSON.parse(raw);
      if (typeof s.apiKey === 'string') state.settings.apiKey = s.apiKey;
      if (typeof s.model === 'string') state.settings.model = s.model;
      if (typeof s.reversed === 'boolean') state.settings.reversed = s.reversed;
    } catch (e) { /* 读不到就用默认 */ }
  }

  function saveSettings() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state.settings)); } catch (e) { /* 隐私模式忽略 */ }
  }

  /* ── 牌阵下拉 ───────────────────────── */
  var pickerTrigger = document.getElementById('pickerTrigger');
  var pickerMenu = document.getElementById('pickerMenu');
  var pickerName = document.getElementById('pickerName');
  var pickerCount = document.getElementById('pickerCount');

  function renderPicker() {
    pickerMenu.innerHTML = '';
    SPREADS.forEach(function (s) {
      var b = el('button', 'picker-item');
      b.type = 'button';
      b.appendChild(el('span', null, s.name));
      b.appendChild(el('span', null, count(s) + ' 张'));
      b.dataset.id = s.id;
      b.setAttribute('aria-current', String(s.id === state.spreadId));
      b.addEventListener('click', function () {
        selectSpread(s.id);
        closePicker();
      });
      pickerMenu.appendChild(b);
    });
  }

  function openPicker() {
    pickerMenu.hidden = false;
    pickerTrigger.setAttribute('aria-expanded', 'true');
    var cur = pickerMenu.querySelector('[aria-current="true"]');
    if (cur) cur.focus();
  }
  function closePicker() {
    pickerMenu.hidden = true;
    pickerTrigger.setAttribute('aria-expanded', 'false');
  }
  pickerTrigger.addEventListener('click', function () {
    if (pickerMenu.hidden) openPicker(); else closePicker();
  });
  document.addEventListener('click', function (e) {
    if (pickerMenu.hidden) return;
    if (pickerMenu.contains(e.target) || pickerTrigger.contains(e.target)) return;
    closePicker();
  });

  function selectSpread(id) {
    if (id === state.spreadId) return;
    state.spreadId = id;
    state.cards = [];
    state.reading = null;
    state.error = '';
    Array.prototype.forEach.call(pickerMenu.children, function (b) {
      b.setAttribute('aria-current', String(b.dataset.id === id));
    });
    syncSpreadMeta();
    renderCanvas();
    renderReading();
    syncButtons();
  }

  function syncSpreadMeta() {
    var s = spread();
    pickerName.textContent = s.name;
    pickerCount.textContent = count(s) + ' 张';
    document.getElementById('clothTitle').textContent = s.name;
    var names = s.positions.map(function (p) { return p.name; });
    document.getElementById('clothSub').textContent =
      names.length > 4 ? names.slice(0, 4).join(' · ') + ' 等 ' + names.length + ' 个位置' : names.join(' · ');
  }

  /* ── 画布 ───────────────────────── */
  var canvas = document.getElementById('canvas');
  var cloth = document.querySelector('.cloth');
  var clothScroll = document.getElementById('clothScroll');
  var tableHint = document.getElementById('tableHint');

  function bounds(s) {
    var cols = 1, rows = 1;
    s.positions.forEach(function (p) {
      if (p.x > cols) cols = p.x;
      if (p.y > rows) rows = p.y;
    });
    return { cols: Math.ceil(cols), rows: Math.ceil(rows) };
  }

  function metrics(s) {
    var narrow = window.matchMedia('(max-width: 640px)').matches;
    var gap = narrow ? 10 : 16;
    var b = bounds(s);
    var cs = window.getComputedStyle(clothScroll);
    var avail = clothScroll.clientWidth
      - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
    var base = narrow ? 86 : 124;
    var cw = base * (s.scale || 1);
    var fit = (avail - gap * (b.cols - 1)) / b.cols;
    if (cw > fit) cw = fit;
    var min = narrow ? 44 : 56;
    if (cw < min) cw = min;
    cw = Math.floor(cw);
    var cardH = Math.round(cw / CARD_RATIO);
    var stepX = cw + gap;
    var stepY = cardH + LABEL_H + gap;
    return {
      cw: cw, gap: gap, cardH: cardH,
      cols: b.cols, rows: b.rows, stepX: stepX, stepY: stepY,
      width: (b.cols - 1) * stepX + cw,
      height: (b.rows - 1) * stepY + cardH + LABEL_H
    };
  }

  function renderCanvas() {
    var s = spread();
    var m = metrics(s);
    canvas.innerHTML = '';
    canvas.style.width = m.width + 'px';
    canvas.style.height = m.height + 'px';

    s.positions.forEach(function (p, i) {
      var slot = el('div', 'slot');
      var left = Math.round((p.x - 1) * m.stepX);
      var top = Math.round((p.y - 1) * m.stepY);
      slot.style.left = left + 'px';
      slot.style.top = top + 'px';
      slot.style.width = m.cw + 'px';
      if (p.rot === 90) slot.classList.add('slot-cross');

      // 入场轨迹：从画布中心那一叠牌飞到自己的落点
      slot.style.setProperty('--dx', Math.round(m.width / 2 - m.cw / 2 - left) + 'px');
      slot.style.setProperty('--dy', Math.round(m.height / 2 - m.cardH / 2 - top) + 'px');
      slot.style.setProperty('--dr', ((i % 2 ? 1 : -1) * (4 + (i % 3) * 2)) + 'deg');
      slot.style.setProperty('--dd', (i * 55) + 'ms');

      var card = el('button', 'card');
      card.type = 'button';
      if (p.rot === 90) card.classList.add('is-rotated');
      if (p.scale && p.scale !== 1) card.style.width = Math.round(m.cw * p.scale) + 'px';
      card.dataset.index = String(i);

      var inner = el('div', 'card-inner');
      var back = el('div', 'card-face card-back');
      back.innerHTML = '<svg viewBox="0 0 24 32" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true"><rect x="2" y="2" width="20" height="28" rx="3"/><path d="M12 9l1.7 4.3L18 15l-4.3 1.7L12 21l-1.7-4.3L6 15l4.3-1.7z"/></svg>';
      var front = el('div', 'card-face card-front');
      inner.appendChild(back);
      inner.appendChild(front);
      card.appendChild(inner);

      var drawn = state.cards[i];
      if (drawn) {
        var data = DATA[drawn.id];
        var img = document.createElement('img');
        img.src = 'assets/cards/' + drawn.id + '.jpg';
        img.alt = data.name + '（' + (drawn.reversed ? '逆位' : '正位') + '）';
        img.loading = 'lazy';
        if (drawn.reversed) front.classList.add('is-rev');
        front.appendChild(img);
        if (drawn.flipped) card.classList.add('is-flipped');
        card.setAttribute('aria-label', p.name + '：' +
          (drawn.flipped ? data.name + '，' + (drawn.reversed ? '逆位' : '正位') : '已抽到，未翻开'));
        card.addEventListener('click', function () { flip(i); });
      } else {
        card.classList.add('is-empty');
        card.disabled = true;
        card.setAttribute('aria-label', p.name + '：空位');
      }

      slot.appendChild(card);
      slot.appendChild(el('div', 'slot-label', p.name));
      slot.classList.add('is-dealt');
      slot.style.animationDelay = (i * 40) + 'ms';
      canvas.appendChild(slot);
    });
  }

  function renderDrawDown() {
    var s = spread();
    var picked = shuffle(DECK).slice(0, count(s));
    state.cards = picked.map(function (c) {
      return { id: c.id, reversed: state.settings.reversed ? (rand(2) === 1) : false, flipped: false };
    });
    state.reading = null;
    state.streamText = null;
    state.error = '';
    shownBefore = 0;
    renderCanvas();
    renderReading();
    syncButtons();
    tableHint.textContent = '点卡片翻开';
    cloth.classList.add('is-drawing');
    setTimeout(function () { cloth.classList.remove('is-drawing'); }, 900);
  }

  function flip(i) {
    var c = state.cards[i];
    if (!c) return;
    c.flipped = !c.flipped;
    var slot = canvas.children[i];
    var card = slot && slot.querySelector('.card');
    if (card) {
      card.classList.toggle('is-flipped', c.flipped);
      var p = spread().positions[i];
      var d = DATA[c.id];
      card.setAttribute('aria-label', p.name + '：' + d.name + '，' + (c.reversed ? '逆位' : '正位'));
    }
    renderReading();
    syncButtons();
  }

  function flipAll() {
    state.cards.forEach(function (c) { c.flipped = true; });
    Array.prototype.forEach.call(canvas.querySelectorAll('.card'), function (card, i) {
      var c = state.cards[i];
      if (!c) return;
      card.classList.add('is-flipped');
      var p = spread().positions[i];
      var d = DATA[c.id];
      card.setAttribute('aria-label', p.name + '：' + d.name + '，' + (c.reversed ? '逆位' : '正位'));
      card.style.transitionDelay = (i * 60) + 'ms';
    });
    setTimeout(function () {
      Array.prototype.forEach.call(canvas.querySelectorAll('.card'), function (card) {
        card.style.transitionDelay = '';
      });
    }, 900);
    renderReading();
    syncButtons();
    tableHint.textContent = '读牌面，再点生成解读';
  }

  /* ── 解读区 ───────────────────────── */
  var body = document.getElementById('readingBody');
  var readingHint = document.getElementById('readingHint');
  var aiBtn = document.getElementById('aiBtn');
  var aiNote = document.getElementById('aiNote');
  var drawBtn = document.getElementById('drawBtn');
  var flipAllBtn = document.getElementById('flipAllBtn');
  var resetBtn = document.getElementById('resetBtn');

  function syncButtons() {
    var has = state.cards.length > 0;
    var flipped = state.cards.filter(function (c) { return c.flipped; }).length;
    drawBtn.textContent = has ? '重新抽牌' : '抽牌';
    flipAllBtn.disabled = !has || flipped === state.cards.length;
    resetBtn.disabled = !has;
    aiBtn.disabled = !has || flipped === 0 || state.loading;
    aiBtn.textContent = state.loading ? '生成中…' : (state.reading ? '重新生成' : '生成解读');
    readingHint.textContent = !has ? '先抽牌'
      : flipped === 0 ? '翻开任意一张'
      : flipped + ' / ' + state.cards.length + ' 张已翻开';
    aiNote.textContent = state.settings.apiKey
      ? '解读由 DeepSeek 生成，约 400–600 字'
      : '需要在设置里填 DeepSeek 的 API key';
  }

  var streamTarget = null;
  var streamCursor = null;
  var shownBefore = 0;   // 上一轮已经出现的牌面行数，用来避免重复播入场

  function renderReading() {
    body.innerHTML = '';
    streamTarget = null;

    if (state.loading) {
      if (state.streamText === null) { body.appendChild(skeleton()); return; }
      var live = el('div', 'reading-block');
      live.appendChild(el('h4', null, '综合解读'));
      var liveP = el('p', 'body-3');
      liveP.textContent = state.streamText;
      streamCursor = el('span', 'ai-cursor');
      liveP.appendChild(streamCursor);
      live.appendChild(liveP);
      body.appendChild(live);
      streamTarget = liveP;
    } else if (state.reading) {
      var ai = el('div', 'reading-block');
      ai.appendChild(el('h4', null, '综合解读'));
      state.reading.split(/\n{2,}/).forEach(function (para) {
        ai.appendChild(el('p', 'body-3', para.trim()));
      });
      body.appendChild(ai);
    }

    if (!state.cards.length) {
      var empty = el('div', 'empty-state');
      empty.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 5h16v14H4z"/><path d="M8 10h8M8 14h5"/></svg>' +
        '<p class="body-3">抽完牌，这里按位置逐张列出义项。填了 key 之后，还能让 AI 结合你的问题讲一遍。</p>';
      body.appendChild(empty);
      return;
    }

    if (state.error) {
      var err = el('div', 'reading-block');
      err.innerHTML = '<div class="notice notice-error"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16v1"/></svg><p class="body-6">' +
        escapeHtml(state.error) + '</p></div>';
      body.appendChild(err);
    }

    var s = spread();
    var shown = 0;
    var list = el('div', 'reading-block');
    state.cards.forEach(function (c, i) {
      if (!c.flipped) return;
      var d = DATA[c.id];
      var p = s.positions[i];
      var line = el('div', 'card-line');
      if (shown < shownBefore) line.style.animation = 'none';
      else line.style.setProperty('--i', ((shown - shownBefore) * 60) + 'ms');
      shown++;
      line.appendChild(el('div', 'card-line-pos', p.name));
      var wrap = el('div', 'card-line-body');
      var title = el('div', 'card-line-title');
      title.appendChild(document.createTextNode(d.name + ' '));
      title.appendChild(el('span', 'card-line-tag', c.reversed ? '逆位' : '正位'));
      wrap.appendChild(title);
      var meaning = c.reversed ? d.rev : d.up;
      wrap.appendChild(el('div', 'card-line-text', meaning.key + '：' + meaning.text));
      if (p.hint) wrap.appendChild(el('div', 'caption-5 muted', p.hint));
      line.appendChild(wrap);
      list.appendChild(line);
    });

    shownBefore = shown;

    if (shown === 0) {
      var tip = el('div', 'empty-state');
      tip.innerHTML = '<p class="body-3">牌已经抽好了。点任意一张翻开，或者点「全翻」。</p>';
      body.appendChild(tip);
    } else {
      list.insertBefore(el('h4', null, '牌面逐张'), list.firstChild);
      body.appendChild(list);
    }
  }

  function skeleton() {
    var box = el('div', 'reading-block');
    var sk = el('div', 'skeleton');
    sk.innerHTML = '<span class="skeleton-title"></span><span></span><span></span><span></span><span></span><span></span>';
    box.appendChild(sk);
    return box;
  }

  /* ── AI 解读 ───────────────────────── */
  function buildPrompt() {
    var s = spread();
    var q = document.getElementById('question').value.trim();
    var lines = [];
    lines.push('牌阵：' + s.name + '（' + count(s) + ' 张）');
    lines.push('问题：' + (q || '（没有写具体问题，按整体状态解读）'));
    lines.push('');
    lines.push('牌面：');
    state.cards.forEach(function (c, i) {
      var d = DATA[c.id];
      var p = s.positions[i];
      var m = c.reversed ? d.rev : d.up;
      lines.push('- 位置「' + p.name + '」（' + (p.hint || '') + '）：' + d.name + '，' +
        (c.reversed ? '逆位' : '正位') + '，关键词' + m.key);
    });
    return lines.join('\n');
  }

  var SYSTEM = [
    '你是一位读韦特塔罗的解读师。中文写作，语气冷静、具体，不用夸张的玄学术语。',
    '规则：',
    '1. 开头用两句话直接回答对方现在最该看清的是什么，不要寒暄、不要「亲爱的」。',
    '2. 按牌阵位置依次讲，每张牌结合它所在的位置说，别把牌义照抄一遍。',
    '3. 正逆位的差异要讲出来，逆位通常是同一股力量受阻、过头或向内。',
    '4. 结尾给一句可操作的提示，落到对方能做的具体动作上，不要许愿式鼓励。',
    '5. 全文 400 到 600 字，用短段落，不要用列表符号以外的排版。',
    '6. 不做医疗、法律、投资的具体建议，不预言生死、疾病、他人的隐私。涉及这些就点明牌面只反映心态。',
    '7. 不确定就说牌面有歧义，不要编造对方的处境。'
  ].join('\n');

  function generate() {
    if (state.loading) return;
    var key = state.settings.apiKey.trim();
    if (!key) {
      state.error = '还没填 API key。点右上角「设置」填入 DeepSeek 的 key，只存在浏览器本地。';
      renderReading();
      openDrawer();
      return;
    }

    state.loading = true;
    state.error = '';
    state.reading = null;
    state.streamText = '';
    renderReading();
    syncButtons();

    var text = '';

    function finish(msg) {
      state.loading = false;
      state.streamText = null;
      if (msg) {
        state.error = msg;
      } else {
        state.reading = text.trim() || '接口返回了空内容，再点一次试试。';
      }
      renderReading();
      syncButtons();
    }

    function fail(status, data, err) {
      state.loading = false;
      state.streamText = null;
      var msg;
      if (status) {
        msg = (data && data.error && data.error.message) || ('请求失败（HTTP ' + status + '）');
        if (status === 401) msg = 'key 不对或已失效，检查一下再试。';
        if (status === 402) msg = '账户余额不足，先去 DeepSeek 控制台充值。';
        if (status === 429) msg = '请求太频繁，等一会儿再点。';
      } else {
        msg = '连不上接口：' + (err && err.message ? err.message : '未知错误') +
          '。确认页面是从 http:// 打开的（浏览器会拦 file:// 的跨域请求）。';
      }
      state.error = msg;
      renderReading();
      syncButtons();
    }

    fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model: state.settings.model || 'deepseek-chat',
        temperature: 0.8,
        stream: true,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: buildPrompt() }
        ]
      })
    }).then(function (res) {
      if (!res.ok) {
        return res.json().then(function (data) { fail(res.status, data); }, function () { fail(res.status, null); });
      }
      if (!res.body || !res.body.getReader) {   // 老浏览器没有流，退回整段
        return res.json().then(function (data) {
          text = data && data.choices && data.choices[0] && data.choices[0].message
            ? data.choices[0].message.content : '';
          finish();
        }, function (err) { fail(0, null, err); });
      }

      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buf = '';

      function pump() {
        return reader.read().then(function (chunk) {
          if (chunk.done) { finish(); return; }
          buf += decoder.decode(chunk.value, { stream: true });
          var lines = buf.split('\n');
          buf = lines.pop();
          lines.forEach(function (line) {
            line = line.trim();
            if (line.indexOf('data:') !== 0) return;
            var payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') return;
            try {
              var json = JSON.parse(payload);
              var delta = json.choices && json.choices[0] && json.choices[0].delta;
              if (delta && delta.content) {
                text += delta.content;
                state.streamText = text;
                if (streamTarget) {
                  streamTarget.textContent = text;
                  if (streamCursor) streamTarget.appendChild(streamCursor);
                }
              }
            } catch (e) { /* 半截 JSON 跳过 */ }
          });
          return pump();
        });
      }

      return pump().catch(function (err) { fail(0, null, err); });
    }).catch(function (err) { fail(0, null, err); });
  }

  /* ── 设置抽屉 ───────────────────────── */
  var drawer = document.getElementById('drawer');
  var backdrop = document.getElementById('drawerBackdrop');
  var apiInput = document.getElementById('apiKey');
  var modelInput = document.getElementById('model');
  var revToggle = document.getElementById('reversedToggle');
  var settingsBtn = document.getElementById('settingsBtn');

  function openDrawer() {
    window.TAROT.closeMobile();
    apiInput.value = state.settings.apiKey;
    modelInput.value = state.settings.model;
    revToggle.checked = state.settings.reversed;
    drawer.classList.add('open');
    backdrop.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    setTimeout(function () { apiInput.focus(); }, 320);
  }

  function closeDrawer() {
    drawer.classList.remove('open');
    backdrop.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
  }

  settingsBtn.addEventListener('click', openDrawer);
  document.getElementById('mobileSettings').addEventListener('click', openDrawer);
  document.getElementById('closeDrawer').addEventListener('click', closeDrawer);
  backdrop.addEventListener('click', closeDrawer);
  document.getElementById('saveSettings').addEventListener('click', function () {
    state.settings.apiKey = apiInput.value.trim();
    state.settings.model = modelInput.value;
    state.settings.reversed = revToggle.checked;
    saveSettings();
    renderReading();
    syncButtons();
    closeDrawer();
  });
  document.getElementById('clearKey').addEventListener('click', function () {
    state.settings.apiKey = '';
    apiInput.value = '';
    saveSettings();
    state.reading = null;
    state.error = '';
    renderReading();
    syncButtons();
  });
  revToggle.addEventListener('change', function () {
    state.settings.reversed = revToggle.checked;
    saveSettings();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!pickerMenu.hidden) { closePicker(); pickerTrigger.focus(); return; }
    if (drawer.classList.contains('open')) closeDrawer();
  });

  /* ── 绑定 ───────────────────────── */
  drawBtn.addEventListener('click', renderDrawDown);
  flipAllBtn.addEventListener('click', flipAll);
  resetBtn.addEventListener('click', function () {
    state.cards = [];
    state.reading = null;
    state.error = '';
    document.getElementById('question').value = '';
    renderCanvas();
    renderReading();
    syncButtons();
    tableHint.textContent = '选好牌阵，点抽牌';
  });
  aiBtn.addEventListener('click', generate);

  // 容器宽度变化时重排画布（牌面状态不变）
  var lastWidth = 0;
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      var w = clothScroll.clientWidth;
      if (Math.abs(w - lastWidth) < 8) return;
      lastWidth = w;
      renderCanvas();
    }, 180);
  });

  /* ── 启动 ───────────────────────── */
  loadSettings();
  renderPicker();
  syncSpreadMeta();

  // 从牌阵总表跳过来的 ?spread=celtic 直接选中
  var wanted = new URLSearchParams(location.search).get('spread');
  if (wanted && SPREADS.some(function (s) { return s.id === wanted; })) {
    selectSpread(wanted);
  }

  renderCanvas();
  renderReading();
  syncButtons();

  // 进页面就把牌摆上：落地即有所见，点一下才翻
  if (!state.cards.length) renderDrawDown();

  lastWidth = clothScroll.clientWidth;
})();
