// =====================================================================
// PedalShare コスト試算 — UI ロジック
// calc.js の runModel() を呼んで結果を描画します。
// 入力項目を増やしたい場合は下の FIELDS 配列に1行足すだけでOK。
// =====================================================================

// 入力フォームの定義。{key, label, unit, group} を並べるだけ
const FIELDS = [
  { group: "規模" },
  { key: "bikes", label: "自転車台数", unit: "台" },
  { key: "ports", label: "ポート数", unit: "拠点" },

  { group: "初期投資(単価)" },
  { key: "bikeUnitCost", label: "自転車 単価", unit: "円/台" },
  { key: "smartlockUnitCost", label: "スマートロック 単価", unit: "円/個" },
  { key: "portSetupCost", label: "ポート設営費", unit: "円/拠点" },
  { key: "initialOther", label: "その他初期費", unit: "円" },

  { group: "ランニング費用(年額)" },
  { key: "insurancePerYear", label: "保険", unit: "円/年" },
{ key: "maintenancePerBikePerYear", label: "保守・修繕", unit: "円/台/年" },
  { key: "systemPerYear", label: "システム運用", unit: "円/年" },

  { group: "人件費・運営協力費" },
  { key: "laborPerMonth", label: "導入事業者人件費", unit: "円/月" },
  { key: "coopFeeRate", label: "運営協力費率", unit: "売上比(0.1=10%)" },

  { group: "減価償却・更新" },
  { key: "bikeLifeYears", label: "自転車 耐用年数", unit: "年" },
  { key: "smartlockLifeYears", label: "ロック 耐用年数", unit: "年" },

  { group: "収益前提" },
  { key: "turnover", label: "回転率", unit: "回/台/日" },
  { key: "pricePerUse", label: "1回あたり料金", unit: "円" },
  { key: "couponRevenuePerUsePerMonth", label: "クーポン付帯収益", unit: "円/回" },
  { key: "operatingDaysPerYear", label: "年間稼働日数", unit: "日" },

  { group: "収益分配(合計が1.0になるよう設定)" },
  { key: "pedalShareRate", label: "PedalShareの取り分", unit: "0.2=20%" },
  { key: "portProviderRate", label: "ポート提供者全体の取り分", unit: "0.1=10%" },
  { key: "revenueShareRate", label: "導入事業者の取り分", unit: "0.7=70%" },
  { key: "operatorOwnedPorts", label: "導入事業者保有ポート数", unit: "拠点" },

  { group: "試算期間" },
  { key: "years", label: "ランニング年数", unit: "年" },
];

const yen = (n) => "¥" + Math.round(n).toLocaleString("ja-JP");
const num = (n) => Math.round(n).toLocaleString("ja-JP");
const escHtml = (s) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

// =====================================================================
// IndexedDB — 試算の保存・呼び出し
// =====================================================================
const IDB_NAME = "pedalshare-cost";
const IDB_VER  = 1;
const IDB_STORE = "scenarios";

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VER);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(IDB_STORE, { keyPath: "name" });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror  = (e) => reject(e.target.error);
  });
}
function idbPut(record) {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(record);
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  }));
}
function idbGetAll() {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror  = (e) => reject(e.target.error);
  }));
}
function idbGet(name) {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror  = (e) => reject(e.target.error);
  }));
}
function idbDelete(name) {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(name);
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  }));
}

// --- 入力フォームを生成 ---
function buildPanel() {
  const panel = document.getElementById("panel");
  let html = "";
  for (const f of FIELDS) {
    if (f.group) { html += `<h2>${f.group}</h2>`; continue; }
    const v = DEFAULTS[f.key];
    html += `<div class="field">
      <label for="${f.key}">${f.label} <span class="unit">${f.unit}</span></label>
      <input id="${f.key}" type="number" step="any" value="${v}">
    </div>`;
  }
  panel.innerHTML = html;
  panel.addEventListener("input", recalc);
}

function readInputs() {
  const input = {};
  for (const f of FIELDS) {
    if (f.group) continue;
    const el = document.getElementById(f.key);
    const v = parseFloat(el.value);
    input[f.key] = isNaN(v) ? 0 : v;
  }
  return input;
}

// --- 結果を描画 ---
function render(r) {
  // KPI
  const be = r.breakEvenYear ? `${r.breakEvenYear}年目` : "期間内に未達";
  document.getElementById("kpis").innerHTML = `
    <div class="kpi"><div class="k-label">初期投資</div><div class="k-value">${yen(r.initial.total)}</div><div class="k-sub">${r.params.bikes}台 / ${r.params.ports}拠点</div></div>
    <div class="kpi"><div class="k-label">年間導入事業者収益</div><div class="k-value">${yen(r.revenue.ourRevenue)}</div><div class="k-sub">グロス売上 ${yen(r.revenue.grossRevenue)}</div></div>
    <div class="kpi"><div class="k-label">年間営業利益</div><div class="k-value" style="color:${r.annualProfit>=0?'var(--green)':'var(--red)'}">${yen(r.annualProfit)}</div><div class="k-sub">償却込み</div></div>
    <div class="kpi"><div class="k-label">PedalShare年間収入</div><div class="k-value" style="color:var(--orange)">${yen(r.revenue.pedalShareRevenue)}</div><div class="k-sub">グロス売上の${Math.round(r.params.pedalShareRate*100)}%</div></div>
    <div class="kpi accent"><div class="k-label">損益分岐</div><div class="k-value">${be}</div><div class="k-sub">累積CFがプラスに転じる年</div></div>
  `;

  // 収益分配テーブル
  const portProviderLabel = r.portProviderCount > 0
    ? `${r.portProviderCount}拠点で按分`
    : "―(導入事業者保有のみ)";
  const operatorNote = r.revenue.operatorPortRevenue > 0
    ? `運営主体 + 保有${Math.min(r.params.operatorOwnedPorts, r.params.ports)}拠点分 (${yen(r.revenue.operatorPortRevenue)}) 含む`
    : "運営主体";
  let h = `<thead><tr><th>受取人</th><th>分配率</th><th>年間受取額</th><th>備考</th></tr></thead><tbody>
    <tr><td>株式会社PedalShare</td><td>${Math.round(r.params.pedalShareRate*100)}%</td><td>${yen(r.revenue.pedalShareRevenue)}</td><td>プラットフォーム提供</td></tr>
    <tr><td>ポート提供者(外部・合計)</td><td>—</td><td>${yen(r.revenue.portProviderTotalRevenue)}</td><td>${portProviderLabel}</td></tr>
    <tr><td>ポート提供者(1拠点あたり)</td><td>—</td><td>${yen(r.portProviderPerSite)}</td><td>全${r.params.ports}拠点で均等割り</td></tr>
    <tr><td>導入事業者</td><td>${Math.round(r.params.revenueShareRate*100)}%</td><td>${yen(r.revenue.ourRevenue)}</td><td>${operatorNote}</td></tr>
  </tbody><tfoot><tr><td>グロス売上</td><td>100%</td><td>${yen(r.revenue.grossRevenue)}</td><td>利用 ${num(r.revenue.usesPerYear)}回/年</td></tr></tfoot>`;
  document.getElementById("t-distribution").innerHTML = h;

  // 初期投資テーブル
  h = "<tbody>";
  for (const [k, v] of Object.entries(r.initial.items)) h += `<tr><td>${k}</td><td>${yen(v)}</td></tr>`;
  h += `</tbody><tfoot><tr><td>合計</td><td>${yen(r.initial.total)}</td></tr></tfoot>`;
  document.getElementById("t-initial").innerHTML = h;

  // 年間費用テーブル
  h = "<tbody>";
  for (const [k, v] of Object.entries(r.running.items)) h += `<tr><td>${k}</td><td>${yen(v)}</td></tr>`;
  for (const [k, v] of Object.entries(r.depreciation.items)) h += `<tr><td>${k}(償却)</td><td>${yen(v)}</td></tr>`;
  if (r.coopFee > 0) h += `<tr><td>運営協力費</td><td>${yen(r.coopFee)}</td></tr>`;
  const annualTotal = r.running.total + r.depreciation.total + r.coopFee;
  h += `</tbody><tfoot>
    <tr><td>年間費用 合計</td><td>${yen(annualTotal)}</td></tr>
    <tr><td>台数あたり年間収支</td><td class="${r.perBike.profit>=0?'pos':'neg'}">${yen(r.perBike.profit)}/台</td></tr>
    </tfoot>`;
  document.getElementById("t-running").innerHTML = h;

  // 年次キャッシュフロー
  h = `<thead><tr><th>年</th><th>導入事業者収益</th><th>支出(更新含む)</th><th>純CF</th><th>累積CF</th></tr></thead><tbody>`;
  for (const row of r.yearly) {
    const beClass = row.year === r.breakEvenYear ? ' class="be"' : "";
    h += `<tr${beClass}>
      <td>${row.year}年目</td>
      <td>${yen(row.revenue)}</td>
      <td>${yen(row.cashOut)}${row.renewal>0?` <span style="color:var(--orange);font-size:11px">(更新${yen(row.renewal)})</span>`:""}</td>
      <td class="${row.netCash>=0?'pos':'neg'}">${yen(row.netCash)}</td>
      <td class="${row.cumulative>=0?'pos':'neg'}">${yen(row.cumulative)}</td>
    </tr>`;
  }
  h += "</tbody>";
  document.getElementById("t-yearly").innerHTML = h;

  drawChart(r);

  // ---- ポート提供者（外部）1拠点あたり ----
  if (r.portProviderCount > 0) {
    const ppBe = r.portProvider.breakEvenYear ? `${r.portProvider.breakEvenYear}年目` : "期間内に未達";
    document.getElementById("pp-kpis").innerHTML = `
      <div class="kpi"><div class="k-label">初期投資(1拠点)</div><div class="k-value">${yen(r.portProvider.initial)}</div><div class="k-sub">ポート設営費のみ</div></div>
      <div class="kpi"><div class="k-label">年間収入(1拠点)</div><div class="k-value">${yen(r.portProviderPerSite)}</div><div class="k-sub">全${r.params.ports}拠点で均等割り</div></div>
      <div class="kpi accent"><div class="k-label">損益分岐</div><div class="k-value">${ppBe}</div><div class="k-sub">累積CFがプラスに転じる年</div></div>
    `;
  } else {
    document.getElementById("pp-kpis").innerHTML =
      `<p style="color:var(--muted);font-size:13px">外部ポート提供者なし（全ポートが導入事業者保有）</p>`;
  }

  // ポート提供者 初期投資テーブル
  h = `<tbody><tr><td>ポート設営費</td><td>${yen(r.portProvider.initial)}</td></tr></tbody>
    <tfoot><tr><td>合計</td><td>${yen(r.portProvider.initial)}</td></tr></tfoot>`;
  document.getElementById("pp-t-initial").innerHTML = h;

  // ポート提供者 年間費用テーブル
  h = `<tbody>
    <tr><td>ランニング費用</td><td>¥0</td></tr>
    <tr><td>減価償却</td><td>¥0</td></tr>
  </tbody><tfoot><tr><td>年間費用 合計</td><td>¥0</td></tr></tfoot>`;
  document.getElementById("pp-t-running").innerHTML = h;

  // ポート提供者 年次キャッシュフローテーブル
  h = `<thead><tr><th>年</th><th>収入</th><th>支出</th><th>純CF</th><th>累積CF</th></tr></thead><tbody>`;
  for (const row of r.portProvider.yearly) {
    const beClass = row.year === r.portProvider.breakEvenYear ? ' class="be"' : "";
    h += `<tr${beClass}>
      <td>${row.year}年目</td>
      <td>${yen(row.revenue)}</td>
      <td>¥0</td>
      <td class="pos">${yen(row.netCash)}</td>
      <td class="${row.cumulative>=0?'pos':'neg'}">${yen(row.cumulative)}</td>
    </tr>`;
  }
  h += "</tbody>";
  document.getElementById("pp-t-yearly").innerHTML = h;

  drawPortProviderChart(r);
}

// --- 累積CFの折れ線グラフ(SVG) ---
function drawChart(r) {
  const W = 700, H = 240, padL = 70, padR = 20, padT = 20, padB = 30;
  const pts = [{ year: 0, cumulative: -r.initial.total }, ...r.yearly];
  const xs = pts.map(p => p.year);
  const ys = pts.map(p => p.cumulative);
  const minY = Math.min(0, ...ys), maxY = Math.max(0, ...ys);
  const x = (yr) => padL + (yr / r.params.years) * (W - padL - padR);
  const y = (val) => padT + (1 - (val - minY) / (maxY - minY || 1)) * (H - padT - padB);

  const zeroY = y(0);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.year)},${y(p.cumulative)}`).join(" ");
  const area = `M${x(0)},${zeroY} ` + pts.map(p => `L${x(p.year)},${y(p.cumulative)}`).join(" ") + ` L${x(r.params.years)},${zeroY} Z`;

  let svg = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#FF5500" stop-opacity="0.25"/>
    <stop offset="100%" stop-color="#FF5500" stop-opacity="0"/></linearGradient></defs>`;
  // 0ライン
  svg += `<line x1="${padL}" y1="${zeroY}" x2="${W-padR}" y2="${zeroY}" stroke="#8C8276" stroke-dasharray="4 3" stroke-width="1"/>`;
  svg += `<text x="${padL-8}" y="${zeroY+4}" text-anchor="end" font-size="11" fill="#8C8276">0</text>`;
  // 軸の年ラベル
  for (const p of pts) {
    svg += `<text x="${x(p.year)}" y="${H-10}" text-anchor="middle" font-size="11" fill="#8C8276">${p.year}年</text>`;
  }
  // エリア + ライン
  svg += `<path d="${area}" fill="url(#g)"/>`;
  svg += `<path d="${line}" fill="none" stroke="#FF5500" stroke-width="2.5"/>`;
  // 点
  for (const p of pts) {
    svg += `<circle cx="${x(p.year)}" cy="${y(p.cumulative)}" r="3.5" fill="#161412"/>`;
  }
  document.getElementById("chart").innerHTML = svg;
}

// --- ポート提供者 累積CFグラフ(SVG) ---
function drawPortProviderChart(r) {
  const W = 700, H = 240, padL = 70, padR = 20, padT = 20, padB = 30;
  const pts = [{ year: 0, cumulative: -r.portProvider.initial }, ...r.portProvider.yearly];
  const ys = pts.map(p => p.cumulative);
  const minY = Math.min(0, ...ys), maxY = Math.max(0, ...ys);
  const x = (yr) => padL + (yr / r.params.years) * (W - padL - padR);
  const y = (val) => padT + (1 - (val - minY) / (maxY - minY || 1)) * (H - padT - padB);

  const zeroY = y(0);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.year)},${y(p.cumulative)}`).join(" ");
  const area = `M${x(0)},${zeroY} ` + pts.map(p => `L${x(p.year)},${y(p.cumulative)}`).join(" ") + ` L${x(r.params.years)},${zeroY} Z`;

  let svg = `<defs><linearGradient id="gg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#FF5500" stop-opacity="0.25"/>
    <stop offset="100%" stop-color="#FF5500" stop-opacity="0"/></linearGradient></defs>`;
  svg += `<line x1="${padL}" y1="${zeroY}" x2="${W-padR}" y2="${zeroY}" stroke="#8C8276" stroke-dasharray="4 3" stroke-width="1"/>`;
  svg += `<text x="${padL-8}" y="${zeroY+4}" text-anchor="end" font-size="11" fill="#8C8276">0</text>`;
  for (const p of pts) {
    svg += `<text x="${x(p.year)}" y="${H-10}" text-anchor="middle" font-size="11" fill="#8C8276">${p.year}年</text>`;
  }
  svg += `<path d="${area}" fill="url(#gg)"/>`;
  svg += `<path d="${line}" fill="none" stroke="#FF5500" stroke-width="2.5"/>`;
  for (const p of pts) {
    svg += `<circle cx="${x(p.year)}" cy="${y(p.cumulative)}" r="3.5" fill="#161412"/>`;
  }
  document.getElementById("pp-chart").innerHTML = svg;
}

function recalc() { render(runModel(readInputs())); }

// =====================================================================
// 保存・呼び出し UI
// =====================================================================
function buildSavePanel() {
  const panel = document.getElementById("panel");
  const sec = document.createElement("div");
  sec.innerHTML = `
    <h2 style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:var(--orange);margin:22px 0 10px;font-weight:800">試算の保存・呼び出し</h2>
    <div class="field">
      <label for="save-name">保存名 <span class="unit">シナリオ名</span></label>
      <input id="save-name" type="text" placeholder="例: 京田辺パイロット">
    </div>
    <button class="save-btn" id="save-btn">この試算を保存</button>
    <div id="saved-list" class="saved-list"></div>
    <p class="save-note">※保存データはこのブラウザ内のみ。別の端末や他の人とは共有されません</p>
  `;
  panel.appendChild(sec);
  document.getElementById("save-btn").addEventListener("click", handleSave);
  refreshSavedList();
}

async function handleSave() {
  const name = document.getElementById("save-name").value.trim();
  if (!name) { alert("保存名を入力してください"); return; }
  const all = await idbGetAll();
  if (all.some(s => s.name === name) && !confirm(`「${name}」はすでに保存されています。上書きしますか？`)) return;
  await idbPut({ name, savedAt: new Date().toISOString(), inputs: readInputs() });
  refreshSavedList();
}

async function refreshSavedList() {
  const list = await idbGetAll();
  const el = document.getElementById("saved-list");
  if (list.length === 0) {
    el.innerHTML = `<p style="font-size:12px;color:var(--muted);margin-top:8px">保存された試算はありません</p>`;
    return;
  }
  list.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  el.innerHTML = list.map((s, i) => {
    const dt = new Date(s.savedAt).toLocaleString("ja-JP", {
      year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit"
    });
    return `<div class="saved-item" data-idx="${i}">
      <div class="saved-item-info">
        <div class="si-name">${escHtml(s.name)}</div>
        <div class="si-date">${dt}</div>
      </div>
      <button class="saved-item-del" data-idx="${i}" title="削除">×</button>
    </div>`;
  }).join("");

  el.querySelectorAll(".saved-item").forEach(item => {
    item.addEventListener("click", (e) => {
      if (e.target.classList.contains("saved-item-del")) return;
      restoreScenario(list[+item.dataset.idx]);
    });
  });
  el.querySelectorAll(".saved-item-del").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const s = list[+btn.dataset.idx];
      if (!confirm(`「${s.name}」を削除しますか？`)) return;
      await idbDelete(s.name);
      refreshSavedList();
    });
  });
}

function restoreScenario(scenario) {
  for (const f of FIELDS) {
    if (f.group) continue;
    const el = document.getElementById(f.key);
    if (el && scenario.inputs[f.key] !== undefined) el.value = scenario.inputs[f.key];
  }
  recalc();
}

buildPanel();
buildSavePanel();
recalc();
