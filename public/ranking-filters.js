'use strict';

(function installRankingFilters() {
  if (!document.querySelector('link[href="/ranking-filters.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/ranking-filters.css';
    document.head.appendChild(link);
  }

  const ranking = document.getElementById('homeRanking');
  const panel = ranking?.closest('.panel');
  const header = panel?.querySelector('.panel-header');
  if (!ranking || !panel || !header) return;

  const title = header.querySelector('h2');
  const subtitle = header.querySelector('p');
  if (title) title.textContent = '强弱排行';
  if (subtitle) { subtitle.id = 'rankingSubtitle'; subtitle.textContent = '按最近1个月复权收益排序'; }

  if (!document.getElementById('rankingFilter')) {
    header.insertAdjacentHTML('afterend', `<div id="rankingFilter" class="ranking-filter" aria-label="排行周期">
      <button data-ranking-range="MTD">本月</button>
      <button data-ranking-range="1M" class="active">最近1个月</button>
      <button data-ranking-range="3M">最近3个月</button>
      <button data-ranking-range="YTD">今年</button>
      <button data-ranking-range="1Y">最近1年</button>
    </div>`);
  }
})();

const RANKING_RANGES = {
  MTD: { field: 'changeMtd', label: '本月' },
  '1M': { field: 'change1m', label: '最近1个月' },
  '3M': { field: 'change3m', label: '最近3个月' },
  YTD: { field: 'changeYtd', label: '今年' },
  '1Y': { field: 'change1y', label: '最近1年' }
};

state.rankingRange = state.rankingRange || '1M';

const rankingFilter = document.getElementById('rankingFilter');
rankingFilter?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-ranking-range]');
  if (!button) return;
  const range = button.dataset.rankingRange;
  if (!RANKING_RANGES[range]) return;
  state.rankingRange = range;
  rankingFilter.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
  renderHomeRanking(Array.isArray(state.overview?.items) ? state.overview.items : []);
});

renderHomeRanking = function renderHomeRankingWithRange(items) {
  const config = RANKING_RANGES[state.rankingRange] || RANKING_RANGES['1M'];
  const subtitle = document.getElementById('rankingSubtitle');
  if (subtitle) subtitle.textContent = `按${config.label}复权收益排序`;

  const valid = items
    .filter((item) => item.initialized && Number.isFinite(Number(item[config.field])))
    .sort((a, b) => Number(b[config.field]) - Number(a[config.field]));

  if (!valid.length) {
    els.homeRanking.innerHTML = `<div class="home-placeholder">当前没有足够的${config.label}历史数据。</div>`;
    return;
  }

  const maxAbs = Math.max(...valid.map((item) => Math.abs(Number(item[config.field]))), 0.01);
  els.homeRanking.innerHTML = valid.slice(0, 12).map((item, index) => {
    const value = Number(item[config.field]);
    const width = Math.max(4, Math.abs(value) / maxAbs * 100);
    return `<button class="home-ranking-row" data-home-symbol="${escapeHtml(item.symbol)}"><span>${index + 1}</span><strong>${escapeHtml(item.symbol)}</strong><div><i class="${value >= 0 ? 'up' : 'down'}" style="width:${width}%"></i></div><em class="${value >= 0 ? 'positive' : 'negative'}">${formatPercent(value)}</em></button>`;
  }).join('');
};
