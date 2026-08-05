'use strict';

function getSampledRows(rows, width, maxPoints = 900) {
  const target = Math.max(100, Math.min(maxPoints, Math.floor(width * 1.35)));
  if (rows.length <= target) return rows;
  const step = rows.length / target;
  const sampled = [];
  for (let i = 0; i < target; i += 1) sampled.push(rows[Math.min(rows.length - 1, Math.floor(i * step))]);
  if (sampled.at(-1) !== rows.at(-1)) sampled.push(rows.at(-1));
  return sampled;
}

function chartFrame(ctx, width, height, values, options = {}) {
  const logScale = Boolean(options.logScale) && values.every((value) => value > 0);
  const transform = (value) => logScale ? Math.log(value) : value;
  const inverse = (value) => logScale ? Math.exp(value) : value;
  const transformed = values.map(transform).filter(Number.isFinite);
  const pad = { left: 12, right: 58, top: 12, bottom: options.bottomPad || 28 };
  let min = Math.min(...transformed); let max = Math.max(...transformed);
  if (options.includeZero && !logScale) { min = Math.min(0, min); max = Math.max(0, max); }
  const span = Math.max(max - min, Math.abs(max) * .01, .0001);
  min -= span * .08; max += span * .08;
  const plotW = Math.max(1, width - pad.left - pad.right);
  const plotH = Math.max(1, height - pad.top - pad.bottom);
  const x = (index, count) => pad.left + (count <= 1 ? 0 : index / (count - 1)) * plotW;
  const y = (value) => pad.top + (max - transform(value)) / (max - min) * plotH;

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(255,255,255,.052)'; ctx.lineWidth = 1;
  ctx.fillStyle = '#687187'; ctx.font = '10px Inter, sans-serif'; ctx.textAlign = 'left';
  const ticks = 5;
  for (let i = 0; i <= ticks; i += 1) {
    const transformedValue = max - (max - min) * (i / ticks);
    const value = inverse(transformedValue);
    const py = pad.top + (transformedValue === max ? 0 : (max - transformedValue) / (max - min) * plotH);
    ctx.beginPath(); ctx.moveTo(pad.left, py); ctx.lineTo(width - pad.right, py); ctx.stroke();
    ctx.fillText(options.percentAxis ? formatPercent(value, 0) : formatAxisNumber(value), width - pad.right + 7, py + 3);
  }
  return { pad, min, max, plotW, plotH, x, y, logScale, plotBottom: pad.top + plotH };
}

function drawPriceChart() {
  if (!state.prices.length) return clearCanvas(els.priceChart);
  const { ctx, width, height } = canvasContext(els.priceChart);
  const enriched = enrichMovingAverages(state.prices);
  const rows = getSampledRows(enriched, width, state.chartMode === 'candle' ? 430 : 1050);
  const values = rows.flatMap((row) => state.chartMode === 'candle' ? [row.low, row.high] : [row.close]);
  const showVolume = els.volumeToggle.checked;
  const volumeBand = showVolume ? Math.min(78, Math.max(58, height * .18)) : 0;
  const frame = chartFrame(ctx, width, height, values, { logScale: els.logToggle.checked, bottomPad: 28 + volumeBand });

  drawXAxis(ctx, rows, frame, height);
  if (showVolume) drawVolume(ctx, rows, frame, height, volumeBand);
  if (state.chartMode === 'candle') drawCandles(ctx, rows, frame);
  else drawPriceLine(ctx, rows, frame);
  if (els.ma50Toggle.checked) drawMovingAverage(ctx, rows, frame, 'ma50', '#31d6b4');
  if (els.ma200Toggle.checked) drawMovingAverage(ctx, rows, frame, 'ma200', '#f7c66b');

  if (state.pointerIndex !== null && state.pointerIndex >= 0 && state.pointerIndex < rows.length) {
    const px = frame.x(state.pointerIndex, rows.length);
    ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.setLineDash([4,4]);
    ctx.beginPath(); ctx.moveTo(px, frame.pad.top); ctx.lineTo(px, height - 28); ctx.stroke(); ctx.setLineDash([]);
  }
  els.priceChart._rows = rows;
  els.priceChart._frame = frame;
}

function drawPriceLine(ctx, rows, frame) {
  const gradient = ctx.createLinearGradient(0, frame.pad.top, 0, frame.plotBottom);
  gradient.addColorStop(0, 'rgba(124,108,255,.30)'); gradient.addColorStop(1, 'rgba(124,108,255,0)');
  ctx.beginPath();
  rows.forEach((row, index) => { const px = frame.x(index, rows.length); const py = frame.y(row.close); if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
  ctx.lineTo(frame.x(rows.length - 1, rows.length), frame.plotBottom); ctx.lineTo(frame.x(0, rows.length), frame.plotBottom); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
  ctx.beginPath(); rows.forEach((row, index) => { const px = frame.x(index, rows.length); const py = frame.y(row.close); if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
  ctx.strokeStyle = '#8b7cff'; ctx.lineWidth = 1.8; ctx.stroke();
}

function drawCandles(ctx, rows, frame) {
  const candleWidth = Math.max(1, Math.min(7, frame.plotW / rows.length * .66));
  rows.forEach((row, index) => {
    const px = frame.x(index, rows.length); const up = row.close >= row.open; const color = up ? '#2ed6a1' : '#ff6b81';
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, frame.y(row.high)); ctx.lineTo(px, frame.y(row.low)); ctx.stroke();
    const top = frame.y(Math.max(row.open, row.close)); const bottom = frame.y(Math.min(row.open, row.close));
    ctx.fillRect(px - candleWidth / 2, top, candleWidth, Math.max(1, bottom - top));
  });
}

function drawVolume(ctx, rows, frame, height, volumeBand) {
  const bottom = height - 28;
  const top = bottom - volumeBand + 8;
  const maxVolume = Math.max(...rows.map((row) => row.volume || 0), 1);
  const barWidth = Math.max(1, Math.min(6, frame.plotW / rows.length * .7));
  ctx.strokeStyle = 'rgba(255,255,255,.055)';
  ctx.beginPath(); ctx.moveTo(frame.pad.left, top); ctx.lineTo(frame.pad.left + frame.plotW, top); ctx.stroke();
  rows.forEach((row, index) => {
    const px = frame.x(index, rows.length);
    const barHeight = Math.max(1, (Number(row.volume || 0) / maxVolume) * (bottom - top));
    ctx.fillStyle = row.close >= row.open ? 'rgba(46,214,161,.32)' : 'rgba(255,107,129,.30)';
    ctx.fillRect(px - barWidth / 2, bottom - barHeight, barWidth, barHeight);
  });
  ctx.fillStyle = '#596277'; ctx.font = '9px Inter, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(`量 ${formatVolume(maxVolume)}`, frame.pad.left + 3, top + 11);
}

function enrichMovingAverages(rows) {
  let sum50 = 0; let sum200 = 0;
  return rows.map((row, index) => {
    sum50 += row.close; sum200 += row.close;
    if (index >= 50) sum50 -= rows[index - 50].close;
    if (index >= 200) sum200 -= rows[index - 200].close;
    return { ...row, ma50: index >= 49 ? sum50 / 50 : null, ma200: index >= 199 ? sum200 / 200 : null };
  });
}

function drawMovingAverage(ctx, rows, frame, field, color) {
  let started = false;
  ctx.beginPath();
  rows.forEach((row, index) => {
    const value = row[field];
    if (!Number.isFinite(value)) return;
    const px = frame.x(index, rows.length); const py = frame.y(value);
    if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
  });
  if (started) { ctx.strokeStyle = color; ctx.lineWidth = 1.15; ctx.globalAlpha = .9; ctx.stroke(); ctx.globalAlpha = 1; }
}

function drawXAxis(ctx, rows, frame, height) {
  ctx.fillStyle = '#687187'; ctx.font = '10px Inter, sans-serif'; ctx.textAlign = 'center';
  const count = Math.min(6, rows.length);
  for (let i = 0; i < count; i += 1) {
    const index = Math.round(i * (rows.length - 1) / Math.max(count - 1, 1));
    ctx.fillText(rows[index].date.slice(0, 7), frame.x(index, rows.length), height - 8);
  }
}

function onPricePointerMove(event) {
  const rows = els.priceChart._rows; const frame = els.priceChart._frame;
  if (!rows?.length || !frame) return;
  const rect = els.priceChart.getBoundingClientRect();
  const localX = event.clientX - rect.left;
  const ratio = (localX - frame.pad.left) / Math.max(frame.plotW, 1);
  const index = Math.max(0, Math.min(rows.length - 1, Math.round(ratio * (rows.length - 1))));
  state.pointerIndex = index;
  const row = rows[index];
  els.priceTooltip.innerHTML = `<strong>${row.date}</strong><br>开 ${currency(row.open)}　高 ${currency(row.high)}<br>低 ${currency(row.low)}　收 ${currency(row.close)}<br>量 ${formatVolume(row.volume)}`;
  els.priceTooltip.classList.remove('hidden');
  const tooltipWidth = 185;
  els.priceTooltip.style.left = `${Math.min(rect.width - tooltipWidth - 8, Math.max(8, localX + 12))}px`;
  els.priceTooltip.style.top = `${Math.max(8, event.clientY - rect.top - 68)}px`;
  drawPriceChart();
}
function clearPricePointer() { state.pointerIndex = null; els.priceTooltip.classList.add('hidden'); drawPriceChart(); }

function drawDrawdownChart() {
  if (!state.prices.length) return clearCanvas(els.drawdownChart);
  const { ctx, width, height } = canvasContext(els.drawdownChart);
  const rows = getSampledRows(calculateMetrics().drawdowns, width, 800);
  const frame = chartFrame(ctx, width, height, rows.map((row) => row.value), { includeZero: true, percentAxis: true });
  drawXAxis(ctx, rows, frame, height);
  ctx.beginPath(); rows.forEach((row, index) => { const px = frame.x(index, rows.length); const py = frame.y(row.value); if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
  ctx.lineTo(frame.x(rows.length - 1, rows.length), frame.y(0)); ctx.lineTo(frame.x(0, rows.length), frame.y(0)); ctx.closePath();
  const gradient = ctx.createLinearGradient(0, frame.pad.top, 0, height - frame.pad.bottom); gradient.addColorStop(0, 'rgba(255,107,129,.03)'); gradient.addColorStop(1, 'rgba(255,107,129,.28)');
  ctx.fillStyle = gradient; ctx.fill();
  ctx.beginPath(); rows.forEach((row, index) => { const px = frame.x(index, rows.length); const py = frame.y(row.value); if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
  ctx.strokeStyle = '#ff6b81'; ctx.lineWidth = 1.4; ctx.stroke();
}

function resetComparison() {
  state.comparison = [];
  state.comparisonActive = false;
  els.comparisonLegend.innerHTML = '';
  els.compareEmpty.classList.remove('hidden');
  clearCanvas(els.compareChart);
}

async function loadComparison() {
  if (!state.cloudConfig?.ready || !state.prices.length) return;
  const symbols = [...new Set([state.symbol, ...els.compareInput.value.split(',').map(normalizeTicker).filter(Boolean)])].slice(0, 6);
  if (symbols.length < 2) return showToast('请至少输入一只对比股票。', 'error');
  state.comparisonActive = true;
  els.compareEmpty.classList.add('hidden');
  setLoading(els.compareLoading, true);
  try {
    const datasets = await Promise.all(symbols.map(async (symbol) => {
      if (symbol === state.symbol) return { symbol, prices: state.prices };
      const data = await apiFetch(`/api/prices?symbol=${encodeURIComponent(symbol)}&startDate=${els.startDate.value}&endDate=${els.endDate.value}`);
      return { symbol, prices: normalizePrices(data.prices || []) };
    }));
    const valid = datasets.filter((set) => set.prices.length > 1);
    const commonStart = valid.reduce((latest, set) => set.prices[0].date > latest ? set.prices[0].date : latest, '0000-00-00');
    state.comparison = valid.map((set, index) => ({
      ...set,
      prices: set.prices.filter((row) => row.date >= commonStart),
      color: COLORS[index % COLORS.length]
    })).filter((set) => set.prices.length > 1);
    renderComparisonLegend();
    drawCompareChart();
  } catch (error) {
    state.comparisonActive = false;
    els.compareEmpty.classList.remove('hidden');
    if (error.status !== 401) showToast(`对比加载失败：${error.message}`, 'error');
  } finally {
    setLoading(els.compareLoading, false);
  }
}

function renderComparisonLegend() {
  els.comparisonLegend.innerHTML = state.comparison.map((set) => {
    const start = set.prices[0].close; const end = set.prices.at(-1).close; const ret = end / start - 1;
    return `<span class="legend-item"><i class="legend-swatch" style="background:${set.color}"></i><strong>${escapeHtml(set.symbol)}</strong><span class="${ret >= 0 ? 'positive' : 'negative'}">${formatPercent(ret)}</span></span>`;
  }).join('');
}

function drawCompareChart() {
  if (!state.comparison.length) return clearCanvas(els.compareChart);
  const { ctx, width, height } = canvasContext(els.compareChart);
  const normalizedSets = state.comparison.map((set) => {
    const rows = getSampledRows(set.prices, width, 700); const base = rows[0].close;
    return { ...set, rows: rows.map((row) => ({ date: row.date, value: row.close / base * 100 })) };
  });
  const allValues = normalizedSets.flatMap((set) => set.rows.map((row) => row.value));
  const frame = chartFrame(ctx, width, height, allValues);
  drawXAxis(ctx, normalizedSets[0].rows, frame, height);
  normalizedSets.forEach((set) => {
    ctx.beginPath(); set.rows.forEach((row, index) => { const px = frame.x(index, set.rows.length); const py = frame.y(row.value); if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
    ctx.strokeStyle = set.color; ctx.lineWidth = set.symbol === state.symbol ? 2.2 : 1.45; ctx.globalAlpha = set.symbol === state.symbol ? 1 : .82; ctx.stroke(); ctx.globalAlpha = 1;
  });
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else els.chartPanel.requestFullscreen?.().catch(() => showToast('当前浏览器不支持图表全屏。', 'error'));
}

function exportCsv() {
  if (!state.prices.length) return;
  const header = ['date','adjOpen','adjHigh','adjLow','adjClose','adjVolume','divCash','splitFactor'];
  const lines = [header.join(','), ...state.prices.map((row) => [row.date,row.open,row.high,row.low,row.close,row.volume,row.dividend,row.split].join(','))];
  const blob = new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `${state.symbol}_${els.startDate.value}_${els.endDate.value}.csv`; anchor.click(); URL.revokeObjectURL(url);
  showToast('CSV 已导出。', 'success');
}

function clearDashboardValues() {
  els.latestPrice.textContent = '—'; els.periodChange.textContent = '暂无数据'; els.companyName.textContent = state.symbol; els.exchangeName.textContent = '—';
  [els.metricReturn, els.metricCagr, els.metricDrawdown, els.metricCurrentDrawdown, els.metricVolatility, els.metric52Week, els.metricHigh, els.metricLow].forEach((element) => { element.textContent = '—'; element.classList.remove('positive','negative'); });
  els.annualReturns.innerHTML = '<div style="padding:30px;color:#687187;font-size:10px">暂无数据</div>';
  clearCanvas(els.priceChart); clearCanvas(els.drawdownChart);
}

function setLoading(element, value) { element.classList.toggle('hidden', !value); }
function clearCanvas(canvas) { const { ctx, width, height } = canvasContext(canvas); ctx.clearRect(0, 0, width, height); }
function setValueTone(element, value) { element.classList.remove('positive','negative'); element.classList.add(value >= 0 ? 'positive' : 'negative'); }
function toDateInput(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
function currency(value) { return Number.isFinite(value) ? `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: value >= 1000 ? 2 : 3 })}` : '—'; }
function formatPercent(value, digits = 2) { if (!Number.isFinite(value)) return '—'; return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(digits)}%`; }
function formatAxisNumber(value) { if (Math.abs(value) >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 0 }); if (Math.abs(value) >= 10) return value.toFixed(0); return value.toFixed(2); }
function formatVolume(value) { if (!Number.isFinite(value)) return '—'; if (value >= 1e9) return `${(value/1e9).toFixed(2)}B`; if (value >= 1e6) return `${(value/1e6).toFixed(2)}M`; if (value >= 1e3) return `${(value/1e3).toFixed(1)}K`; return String(Math.round(value)); }
function formatDateTime(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }) : '—'; }
function readLocalJson(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char])); }
function showToast(message, type = '') {
  const toast = document.createElement('div'); toast.className = `toast ${type}`; toast.textContent = message; els.toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 4200);
}

init();
