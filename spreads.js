/* 塔罗抽牌 · 牌阵总表
   把 data/spreads.js 里的 14 种牌阵渲染成表，每行可从名字跳到牌桌。 */
(function () {
  'use strict';

  var table = document.getElementById('spreadTable');
  if (!table || typeof SPREADS === 'undefined') return;

  var el = window.TAROT.el;

  var head = el('div', 'spread-row head');
  head.innerHTML = '<span>牌阵</span><span>牌数</span><span>适合与布局</span>';
  table.appendChild(head);

  SPREADS.forEach(function (s) {
    var row = el('a', 'spread-row');
    row.href = 'table.html?spread=' + encodeURIComponent(s.id);
    row.appendChild(el('strong', null, s.name));
    row.appendChild(el('span', null, s.positions.length + ' 张'));
    row.appendChild(el('span', null, s.fit + ' · ' + s.desc));
    table.appendChild(row);
  });
})();
