// =====================================================================
// PedalShare 導入事業者向け コスト試算ロジック
// ---------------------------------------------------------------------
// このファイルが計算の心臓部です。
// 費用項目を増やしたい / 数式を変えたい場合はここを編集してください。
// UI(index.html)とは独立しているので、ここだけ直せば計算が変わります。
// =====================================================================

// ---------------------------------------------------------------------
// デフォルト前提値(京田辺パイロット: 6ポート / 12台 を初期値に)
// ---------------------------------------------------------------------
const DEFAULTS = {
  // --- 規模 ---
  bikes: 12,            // 自転車台数
  ports: 6,             // ポート数

  // --- 初期投資(1台/1ポートあたり単価) ---
  bikeUnitCost: 15000,      // 自転車1台あたり調達費(中古/リサイクル混在の平均)
  smartlockUnitCost: 8000,  // スマートロック1個あたり(Sesame Cycle 2想定)
  portSetupCost: 5000,      // ポート1拠点あたり設営費(看板・整備)
  initialOther: 30000,      // その他初期費(ブランディング・初期広報など)

  // --- ランニング費用(年額) ---
  insurancePerYear: 40000,      // 保険(導入事業者として加入する年額)
  commPerBikePerMonth: 100,     // 通信費(スマートロック1台あたり月額)
  maintenancePerBikePerYear: 3000, // 保守・修繕(1台あたり年額)
  systemPerYear: 24000,         // システム/アプリ運用(年額)

  // --- 人件費・運営協力費 ---
  laborPerMonth: 0,             // 自社人件費(月額)。学生運営なら0でもOK
  coopFeeRate: 0.0,             // 運営協力費(売上に対する割合。京田辺チームへの按分など)

  // --- 減価償却・更新 ---
  bikeLifeYears: 4,             // 自転車の耐用年数(更新サイクル)
  smartlockLifeYears: 5,        // スマートロックの耐用年数

  // --- 収益前提 ---
  turnover: 1.5,                // 回転率: 1台1日あたりの平均利用回数
  pricePerUse: 100,            // 1回あたり利用料金(円)
  couponRevenuePerUsePerMonth: 0, // クーポン提携からの1回あたり付帯収益
  operatingDaysPerYear: 300,    // 年間稼働日数(冬季・点検休止を考慮)
  revenueShareRate: 0.6,        // 自社取り分(売上のうちPedalShareの割合)

  // --- 期間 ---
  years: 5,                     // 試算するランニング年数
};

// ---------------------------------------------------------------------
// 初期投資の計算
// ---------------------------------------------------------------------
function calcInitialInvestment(p) {
  const bikes = p.bikeUnitCost * p.bikes;
  const smartlocks = p.smartlockUnitCost * p.bikes; // 1台に1ロック
  const ports = p.portSetupCost * p.ports;
  const other = p.initialOther;
  const total = bikes + smartlocks + ports + other;
  return {
    items: { 自転車: bikes, スマートロック: smartlocks, ポート設営: ports, その他初期費: other },
    total,
  };
}

// ---------------------------------------------------------------------
// 年間ランニング費用の計算(売上に依存しない固定費中心)
// ---------------------------------------------------------------------
function calcAnnualRunningCost(p) {
  const insurance = p.insurancePerYear;
  const comm = p.commPerBikePerMonth * p.bikes * 12;
  const maintenance = p.maintenancePerBikePerYear * p.bikes;
  const system = p.systemPerYear;
  const labor = p.laborPerMonth * 12;
  const total = insurance + comm + maintenance + system + labor;
  return {
    items: { 保険: insurance, 通信費: comm, 保守修繕: maintenance, システム運用: system, 人件費: labor },
    total,
  };
}

// ---------------------------------------------------------------------
// 減価償却(年額)= 初期投資のうち更新が必要な資産を耐用年数で割る
// ---------------------------------------------------------------------
function calcAnnualDepreciation(p) {
  const bikeDep = (p.bikeUnitCost * p.bikes) / p.bikeLifeYears;
  const lockDep = (p.smartlockUnitCost * p.bikes) / p.smartlockLifeYears;
  const total = bikeDep + lockDep;
  return {
    items: { 自転車更新: bikeDep, スマートロック更新: lockDep },
    total,
  };
}

// ---------------------------------------------------------------------
// 年間売上の計算
//   売上 = 台数 × 回転率 × 稼働日数 × (利用料金 + クーポン付帯収益)
//   自社収益 = 売上 × 自社取り分
// ---------------------------------------------------------------------
function calcAnnualRevenue(p) {
  const usesPerYear = p.bikes * p.turnover * p.operatingDaysPerYear;
  const grossRevenue = usesPerYear * (p.pricePerUse + p.couponRevenuePerUsePerMonth);
  const ourRevenue = grossRevenue * p.revenueShareRate;
  return { usesPerYear, grossRevenue, ourRevenue };
}

// ---------------------------------------------------------------------
// メイン: 全指標を計算して返す
// ---------------------------------------------------------------------
function runModel(input) {
  const p = { ...DEFAULTS, ...input };

  const initial = calcInitialInvestment(p);
  const running = calcAnnualRunningCost(p);
  const depreciation = calcAnnualDepreciation(p);
  const revenue = calcAnnualRevenue(p);

  // 運営協力費(売上連動)
  const coopFee = revenue.ourRevenue * p.coopFeeRate;

  // 年間の実費用(キャッシュアウト): ランニング費用 + 運営協力費
  // ※減価償却は更新時の実支出として別途扱う(下のキャッシュフローで反映)
  const annualOperatingCost = running.total + coopFee;

  // 年間営業利益(減価償却込みの会計利益)
  const annualProfit = revenue.ourRevenue - annualOperatingCost - depreciation.total;

  // --- 台数あたり収支(年間) ---
  const perBike = {
    revenue: revenue.ourRevenue / p.bikes,
    cost: (annualOperatingCost + depreciation.total) / p.bikes,
    profit: annualProfit / p.bikes,
  };

  // --- 年次キャッシュフロー & 累積(損益分岐の判定用) ---
  const yearly = [];
  let cumulative = -initial.total; // 年0: 初期投資を一括計上
  let breakEvenYear = null;

  for (let y = 1; y <= p.years; y++) {
    // 実キャッシュアウト: ランニング + 運営協力費
    let cashOut = annualOperatingCost;
    // 更新費: 耐用年数の倍数の年に資産を買い替え
    let renewal = 0;
    if (y % p.bikeLifeYears === 0) renewal += p.bikeUnitCost * p.bikes;
    if (y % p.smartlockLifeYears === 0) renewal += p.smartlockUnitCost * p.bikes;
    cashOut += renewal;

    const netCash = revenue.ourRevenue - cashOut;
    cumulative += netCash;

    if (breakEvenYear === null && cumulative >= 0) breakEvenYear = y;

    yearly.push({
      year: y,
      revenue: revenue.ourRevenue,
      cashOut,
      renewal,
      netCash,
      cumulative,
    });
  }

  return {
    params: p,
    initial,
    running,
    depreciation,
    revenue,
    coopFee,
    annualOperatingCost,
    annualProfit,
    perBike,
    yearly,
    breakEvenYear,
  };
}

// ブラウザ / Node 両対応のエクスポート
if (typeof module !== "undefined" && module.exports) {
  module.exports = { runModel, DEFAULTS };
}
