// ============ 状态管理 ============
const STORAGE_KEY = 'gold_trader_state';

// 合约规格: 0.01手 1点(0.01)=1美元, 即1手1点=100美元
const POINT_VALUE = 10000; // PnL = lots * POINT_VALUE * priceDiff

let state = loadState();
let priceMode = 'sim'; // 'sim' 或 'real'
let lastRealPrice = null;

function defaultState() {
  return {
    balance: 100000,
    positions: [],
    history: [],
    openPrice: 4390,
    highPrice: 4390,
    lowPrice: 4390,
    currentPrice: 4390,
    priceHistory: Array(60).fill(4390),
    startPrice: 4390,
  };
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const s = JSON.parse(saved);
      return { ...defaultState(), ...s };
    }
  } catch (e) {}
  return defaultState();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ============ 实时金价（Finnhub WebSocket）=============
// WebSocket不受CORS限制，可在浏览器中直接连接获取实时金价
// 免费注册: https://finnhub.io

let ws = null;
let wsReconnectTimer = null;
let finnhubApiKey = localStorage.getItem('finnhub_api_key') || '';

function connectFinnhubWS() {
  if (!finnhubApiKey) {
    // 没有API Key，尝试price.json回退
    fallbackToPriceJson();
    return;
  }
  
  if (ws && ws.readyState === WebSocket.OPEN) return; // 已连接
  
  try {
    ws = new WebSocket(`wss://ws.finnhub.io?token=${finnhubApiKey}`);
    
    ws.onopen = () => {
      console.log('Finnhub WebSocket 已连接');
      // 订阅黄金XAU/USD
      ws.send(JSON.stringify({ type: 'subscribe', symbol: 'OANDA:XAU_USD' }));
    };
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'trade' && data.data && data.data.length > 0) {
        // 取最新的成交价
        const lastTrade = data.data[data.data.length - 1];
        const price = lastTrade.p;
        if (price && price > 1000 && price < 10000) {
          lastRealPrice = price;
          priceMode = 'real';
          state.currentPrice = Math.round(price * 100) / 100;
          state.highPrice = Math.max(state.highPrice, state.currentPrice);
          state.lowPrice = Math.min(state.lowPrice, state.currentPrice);
          updatePriceModeBadge();
        }
      } else if (data.type === 'ping') {
        // 心跳，忽略
      }
    };
    
    ws.onerror = (e) => {
      console.error('Finnhub WebSocket 错误');
    };
    
    ws.onclose = () => {
      console.log('Finnhub WebSocket 断开，5秒后重连');
      ws = null;
      wsReconnectTimer = setTimeout(connectFinnhubWS, 5000);
    };
  } catch (e) {
    console.error('WebSocket连接失败:', e);
    fallbackToPriceJson();
  }
}

function disconnectFinnhubWS() {
  if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
  if (ws) {
    ws.onclose = null; // 防止自动重连
    ws.close();
    ws = null;
  }
}

// 回退方案: 读取price.json
async function fallbackToPriceJson() {
  try {
    const res = await fetch('./price.json', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data && data.price && data.price > 1000 && data.price < 10000) {
        const age = (Date.now() - new Date(data.updated).getTime()) / 60000;
        if (age < 60) {
          lastRealPrice = data.price;
          priceMode = 'real';
          state.currentPrice = Math.round(data.price * 100) / 100;
          updatePriceModeBadge();
        }
      }
    }
  } catch (e) {}
}

// 设置Finnhub API Key
function setFinnhubKey() {
  const input = prompt('请输入Finnhub API Key（免费获取: finnhub.io/register）：', finnhubApiKey);
  if (input === null) return;
  const key = input.trim();
  if (!key) {
    finnhubApiKey = '';
    localStorage.removeItem('finnhub_api_key');
    disconnectFinnhubWS();
    priceMode = 'sim';
    updatePriceModeBadge();
    showToast('已断开实时金价', 'info');
    return;
  }
  finnhubApiKey = key;
  localStorage.setItem('finnhub_api_key', key);
  disconnectFinnhubWS();
  connectFinnhubWS();
  showToast('正在连接实时金价...', 'success');
}

async function fetchRealPrice() {
  // WebSocket模式下不需要轮询
  if (ws && ws.readyState === WebSocket.OPEN) return null;
  // 回退到price.json
  await fallbackToPriceJson();
  return null;
}

// 定时获取金价（仅作为WebSocket的回退）
async function refreshRealPrice() {
  if (ws && ws.readyState === WebSocket.OPEN) return; // WebSocket已连接，无需轮询
  try {
    await fallbackToPriceJson();
  } catch (e) {}
}

function updatePriceModeBadge() {
  const badge = document.getElementById('price-mode');
  if (badge) {
    badge.textContent = priceMode === 'real' ? '真实' : '模拟';
    badge.style.color = priceMode === 'real' ? 'var(--green)' : 'var(--gold)';
  }
}

// 手动输入真实金价
function manualSetPrice() {
  const input = prompt('请输入当前金价（如 3315.50）：', lastRealPrice ? lastRealPrice.toFixed(2) : '');
  if (input === null) return;
  const price = parseFloat(input);
  if (!price || price < 1000 || price > 10000) {
    showToast('金价范围: 1000-10000', 'error');
    return;
  }
  lastRealPrice = price;
  priceMode = 'real';
  if (Math.abs(price - state.currentPrice) > 50) {
    state.currentPrice = price;
    state.startPrice = price;
    state.highPrice = Math.max(state.highPrice, price);
    state.lowPrice = Math.min(state.lowPrice, price);
  } else {
    state.currentPrice = price;
  }
  updatePriceModeBadge();
  showToast('已切换到真实金价: ' + price.toFixed(2), 'success');
  saveState();
}

// ============ 价格模拟引擎（几何布朗运动） ============
let priceTick = 0;

function simulatePrice() {
  // WebSocket实时模式下，价格由onmessage直接更新，不需要模拟
  if (priceMode === 'real' && ws && ws.readyState === WebSocket.OPEN) {
    // 价格已由WebSocket实时更新，只记录历史
    priceTick++;
    if (priceTick % 2 === 0) {
      state.priceHistory.push(state.currentPrice);
      if (state.priceHistory.length > 120) state.priceHistory.shift();
    }
    checkTPSL();
    return;
  }
  
  // 有真实价格但WebSocket断开时，基于真实价格微调
  if (priceMode === 'real' && lastRealPrice) {
    const noise = (Math.random() - 0.5) * 0.3;
    state.currentPrice = Math.round((lastRealPrice + noise) * 100) / 100;
  } else {
    const sigma = parseFloat(document.getElementById('volatility').value);
    const mu = 0.00001;
    const dt = 1 / 86400;
    const z = randn();
    const drift = (mu - 0.5 * sigma * sigma) * dt;
    const diffusion = sigma * Math.sqrt(dt) * z;
    const newPrice = state.currentPrice * Math.exp(drift + diffusion);
    state.currentPrice = Math.round(newPrice * 100) / 100;
  }
  
  state.highPrice = Math.max(state.highPrice, state.currentPrice);
  state.lowPrice = Math.min(state.lowPrice, state.currentPrice);
  
  priceTick++;
  if (priceTick % 2 === 0) {
    state.priceHistory.push(state.currentPrice);
    if (state.priceHistory.length > 120) state.priceHistory.shift();
  }
  
  checkTPSL();
}

function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// ============ 交易逻辑 ============
function openTrade(direction) {
  const lots = parseFloat(document.getElementById('trade-lots').value);
  const leverage = parseInt(document.getElementById('leverage').value);
  const tpPrice = parseFloat(document.getElementById('tp-price').value) || null;
  const slPrice = parseFloat(document.getElementById('sl-price').value) || null;
  
  if (lots <= 0 || lots > 10) { showToast('手数范围: 0.01-10', 'error'); return; }
  
  const margin = lots * POINT_VALUE * state.currentPrice / leverage;
  const freeMargin = getFreeMargin();
  
  if (margin > freeMargin) {
    showToast('保证金不足，需要 ' + formatNum(margin) + ' USD', 'error');
    return;
  }
  
  const position = {
    id: Date.now(),
    direction: direction,
    lots: lots,
    leverage: leverage,
    openPrice: state.currentPrice,
    margin: margin,
    tpPrice: tpPrice,
    slPrice: slPrice,
    openTime: new Date().toLocaleString('zh-CN'),
  };
  
  state.positions.push(position);
  saveState();
  renderPositions();
  showToast(direction === 'buy' ? '做多开仓成功' : '做空开仓成功', 'success');
}

function closeTrade(id) {
  const idx = state.positions.findIndex(p => p.id === id);
  if (idx === -1) return;
  
  const pos = state.positions[idx];
  const pnl = calcPnl(pos);
  state.balance += pnl;
  
  state.history.unshift({
    ...pos,
    closePrice: state.currentPrice,
    closeTime: new Date().toLocaleString('zh-CN'),
    pnl: pnl,
  });
  
  // 最多保留100条历史
  if (state.history.length > 100) state.history.pop();
  
  state.positions.splice(idx, 1);
  saveState();
  renderPositions();
  renderHistory();
  updateAccountBar();
  showToast('平仓成功，盈亏: ' + formatPnl(pnl), pnl >= 0 ? 'success' : 'error');
}

function closeAllPositions() {
  if (state.positions.length === 0) return;
  if (!confirm('确定全部平仓？')) return;
  [...state.positions].forEach(p => closeTrade(p.id));
}

function calcPnl(pos) {
  const priceDiff = pos.direction === 'buy'
    ? state.currentPrice - pos.openPrice
    : pos.openPrice - state.currentPrice;
  // 0.01手 1点(0.01)=1美元: lots * 10000 * priceDiff
  return priceDiff * pos.lots * POINT_VALUE;
}

function getFreeMargin() {
  const usedMargin = state.positions.reduce((sum, p) => sum + p.margin, 0);
  const floatingPnl = state.positions.reduce((sum, p) => sum + calcPnl(p), 0);
  return state.balance + floatingPnl - usedMargin;
}

function checkTPSL() {
  const toClose = [];
  state.positions.forEach(pos => {
    if (pos.tpPrice) {
      if (pos.direction === 'buy' && state.currentPrice >= pos.tpPrice) toClose.push(pos.id);
      if (pos.direction === 'sell' && state.currentPrice <= pos.tpPrice) toClose.push(pos.id);
    }
    if (pos.slPrice) {
      if (pos.direction === 'buy' && state.currentPrice <= pos.slPrice) toClose.push(pos.id);
      if (pos.direction === 'sell' && state.currentPrice >= pos.slPrice) toClose.push(pos.id);
    }
  });
  toClose.forEach(id => closeTrade(id));
}

// ============ UI 渲染 ============
function updateAccountBar() {
  const floatingPnl = state.positions.reduce((sum, p) => sum + calcPnl(p), 0);
  const usedMargin = state.positions.reduce((sum, p) => sum + p.margin, 0);
  const equity = state.balance + floatingPnl;
  const freeMargin = equity - usedMargin;
  
  document.getElementById('equity').textContent = formatNum(equity);
  document.getElementById('balance').textContent = formatNum(state.balance);
  
  const pnlEl = document.getElementById('floating-pnl');
  pnlEl.textContent = (floatingPnl >= 0 ? '+' : '') + formatNum(floatingPnl);
  pnlEl.style.color = floatingPnl >= 0 ? 'var(--green)' : 'var(--red)';
  
  const marginEl = document.getElementById('free-margin');
  marginEl.textContent = formatNum(freeMargin);
  marginEl.style.color = freeMargin < 0 ? 'var(--red)' : 'var(--text-primary)';
}

function updatePriceDisplay() {
  const priceEl = document.getElementById('current-price');
  priceEl.textContent = state.currentPrice.toFixed(2);
  
  const change = state.currentPrice - state.startPrice;
  const changePct = (change / state.startPrice * 100);
  const changeEl = document.getElementById('price-change');
  changeEl.textContent = (change >= 0 ? '+' : '') + change.toFixed(2) + ' (' + changePct.toFixed(2) + '%)';
  changeEl.style.color = change >= 0 ? 'var(--green)' : 'var(--red)';
  priceEl.style.color = change >= 0 ? 'var(--green)' : 'var(--red)';
  
  document.getElementById('high-price').textContent = state.highPrice.toFixed(2);
  document.getElementById('low-price').textContent = state.lowPrice.toFixed(2);
  document.getElementById('open-price').textContent = state.startPrice.toFixed(2);
}

function updateMarginPreview() {
  const lots = parseFloat(document.getElementById('trade-lots').value) || 0;
  const leverage = parseInt(document.getElementById('leverage').value) || 1;
  const margin = lots * POINT_VALUE * state.currentPrice / leverage;
  document.getElementById('margin-needed').textContent = formatNum(margin);
}

function renderPositions() {
  const container = document.getElementById('position-list');
  const closeAllBtn = document.getElementById('close-all-btn');
  
  if (state.positions.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无持仓</div>';
    closeAllBtn.style.display = 'none';
    return;
  }
  
  closeAllBtn.style.display = 'inline-block';
  container.innerHTML = state.positions.map(pos => {
    const pnl = calcPnl(pos);
    const pnlClass = pnl >= 0 ? 'positive' : 'negative';
    const dirClass = pos.direction === 'buy' ? 'buy' : 'sell';
    const dirText = pos.direction === 'buy' ? '做多' : '做空';
    return `
      <div class="position-card ${dirClass}">
        <div class="card-row">
          <span class="card-direction ${dirClass}">${dirText} ${pos.lots}手 x${pos.leverage}</span>
          <span class="card-pnl ${pnlClass}">${pnl >= 0 ? '+' : ''}${formatNum(pnl)}</span>
        </div>
        <div class="card-row">
          <span class="card-detail">开仓: ${pos.openPrice.toFixed(2)} → ${state.currentPrice.toFixed(2)}</span>
          <button class="btn-close-pos" onclick="closeTrade(${pos.id})">平仓</button>
        </div>
        ${pos.tpPrice ? `<div class="card-detail">止盈: ${pos.tpPrice.toFixed(2)}</div>` : ''}
        ${pos.slPrice ? `<div class="card-detail">止损: ${pos.slPrice.toFixed(2)}</div>` : ''}
        <div class="card-detail">保证金: ${formatNum(pos.margin)} USD | ${pos.openTime}</div>
      </div>
    `;
  }).join('');
}

function renderHistory() {
  const container = document.getElementById('history-list');
  const statsEl = document.getElementById('trade-stats');
  
  if (state.history.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无交易记录</div>';
    statsEl.innerHTML = '';
    return;
  }
  
  // 统计
  const wins = state.history.filter(h => h.pnl > 0).length;
  const totalPnl = state.history.reduce((s, h) => s + h.pnl, 0);
  const winRate = ((wins / state.history.length) * 100).toFixed(0);
  statsEl.innerHTML = `<span>胜率: ${winRate}%</span><span>总盈亏: ${formatPnl(totalPnl)}</span>`;
  
  container.innerHTML = state.history.map(h => {
    const pnlClass = h.pnl >= 0 ? 'positive' : 'negative';
    const dirClass = h.direction === 'buy' ? 'buy' : 'sell';
    const dirText = h.direction === 'buy' ? '做多' : '做空';
    return `
      <div class="history-card" style="border-left-color: ${h.pnl >= 0 ? 'var(--green)' : 'var(--red)'}">
        <div class="card-row">
          <span class="card-direction ${dirClass}">${dirText} ${h.lots}手 x${h.leverage}</span>
          <span class="card-pnl ${pnlClass}">${h.pnl >= 0 ? '+' : ''}${formatNum(h.pnl)}</span>
        </div>
        <div class="card-detail">开仓: ${h.openPrice.toFixed(2)} → 平仓: ${h.closePrice.toFixed(2)}</div>
        <div class="card-detail">${h.openTime} → ${h.closeTime}</div>
      </div>
    `;
  }).join('');
}

// ============ 图表 ============
function drawChart() {
  const canvas = document.getElementById('price-chart');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  
  canvas.width = canvas.offsetWidth * dpr;
  canvas.height = canvas.offsetHeight * dpr;
  ctx.scale(dpr, dpr);
  
  const w = canvas.offsetWidth;
  const h = canvas.offsetHeight;
  const data = state.priceHistory.slice(-60);
  
  if (data.length < 2) return;
  
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = { top: 10, bottom: 20, left: 5, right: 50 };
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;
  
  ctx.clearRect(0, 0, w, h);
  
  // 网格线
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (chartH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(w - padding.right, y);
    ctx.stroke();
  }
  
  // 价格标签
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '10px monospace';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (chartH / 4) * i;
    const price = max - (range / 4) * i;
    ctx.fillText(price.toFixed(2), w - 4, y + 4);
  }
  
  // 绘制面积图
  const isUp = data[data.length - 1] >= data[0];
  const lineColor = isUp ? '#00e676' : '#ff1744';
  
  ctx.beginPath();
  data.forEach((price, i) => {
    const x = padding.left + (chartW / (data.length - 1)) * i;
    const y = padding.top + chartH - ((price - min) / range) * chartH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  
  // 填充区域
  const lastX = padding.left + chartW;
  const lastY = padding.top + chartH - ((data[data.length - 1] - min) / range) * chartH;
  ctx.lineTo(lastX, padding.top + chartH);
  ctx.lineTo(padding.left, padding.top + chartH);
  ctx.closePath();
  
  const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
  gradient.addColorStop(0, isUp ? 'rgba(0,230,118,0.25)' : 'rgba(255,23,68,0.25)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fill();
  
  // 绘制线
  ctx.beginPath();
  data.forEach((price, i) => {
    const x = padding.left + (chartW / (data.length - 1)) * i;
    const y = padding.top + chartH - ((price - min) / range) * chartH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  ctx.stroke();
  
  // 当前价格点
  ctx.beginPath();
  ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
  ctx.fillStyle = lineColor;
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.stroke();
}

// ============ Tab 切换 ============
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  event.target.classList.add('active');
}

// ============ 辅助函数 ============
function formatNum(n) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPnl(n) {
  return (n >= 0 ? '+' : '') + formatNum(n);
}

function adjustLots(delta) {
  const input = document.getElementById('trade-lots');
  let val = parseFloat(input.value) + delta;
  val = Math.max(0.01, Math.min(10, Math.round(val * 100) / 100));
  input.value = val.toFixed(2);
  updateMarginPreview();
}

function showToast(msg, type) {
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

function resetAccount() {
  if (!confirm('确定重置账户？所有持仓和历史将被清除。')) return;
  const initial = parseInt(document.getElementById('initial-balance').value);
  state = defaultState();
  state.balance = initial;
  state.currentPrice = 4390;
  state.openPrice = 4390;
  state.startPrice = 4390;
  state.highPrice = 4390;
  state.lowPrice = 4390;
  state.priceHistory = Array(60).fill(4390);
  saveState();
  renderPositions();
  renderHistory();
  updateAccountBar();
  showToast('账户已重置', 'info');
}

// ============ PWA ============
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  document.getElementById('install-prompt').style.display = 'flex';
});

function installPWA() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(result => {
      document.getElementById('install-prompt').style.display = 'none';
      deferredPrompt = null;
    });
  }
}

function dismissInstall() {
  document.getElementById('install-prompt').style.display = 'none';
}

// 注册Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ============ 主循环 ============
function gameLoop() {
  simulatePrice();
  updatePriceDisplay();
  updateAccountBar();
  updateMarginPreview();
  renderPositions();
  drawChart();
  saveState();
}

// 启动
document.getElementById('trade-lots').addEventListener('input', updateMarginPreview);
document.getElementById('leverage').addEventListener('change', updateMarginPreview);

renderHistory();
updateAccountBar();
updateMarginPreview();

// 尝试获取真实金价
connectFinnhubWS();
setInterval(refreshRealPrice, 30000);

// 每秒更新UI
setInterval(gameLoop, 1000);
gameLoop();
