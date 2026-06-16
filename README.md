# PedalShare コスト試算システム

導入事業者(株式会社PedalShare)がシェアサイクル事業にかかる費用と収支を試算するWebアプリ。
初期投資・ランニング費用・減価償却・人件費を入力すると、回転率・台数あたり収支・損益分岐年・年次キャッシュフローをリアルタイムで計算します。

## 起動方法

```bash
cd pedalshare-cost
npm start          # または: node server.js
```

ブラウザで **http://localhost:3000** を開く。
左の入力欄をいじると右側の結果が即座に更新されます。

## ファイル構成

```
pedalshare-cost/
├── server.js          ← localhostサーバー(依存ゼロ。触らなくてOK)
├── package.json
├── README.md
└── public/
    ├── index.html     ← 画面の見た目(レイアウト・色・表)
    ├── calc.js        ← 【計算の心臓部】費用モデルと数式。指標を変えるならここ
    └── app.js         ← 入力欄の定義と結果の描画。項目を増やすならここ
```

## Claude Code で編集するときのポイント

- **費用項目を増やす / 数式を変える** → `public/calc.js`
  - `DEFAULTS` に既定値を1行足す
  - 対応する `calc〇〇()` 関数の中で計算に組み込む
- **入力欄を画面に出す** → `public/app.js` の `FIELDS` 配列に1行足すだけ
  - `{ key: "新しいキー", label: "表示名", unit: "単位" }`
  - `key` は `calc.js` の `DEFAULTS` のキーと一致させる
- **見た目・色** → `public/index.html` の `<style>` 内の CSS変数(`:root`)

例: 「盗難・故障による損失率」を足したい
1. `calc.js` の `DEFAULTS` に `lossRate: 0.05` を追加
2. `calcAnnualRunningCost` に損失コストの計算を追加
3. `app.js` の `FIELDS` に `{ key: "lossRate", label: "盗難・故障損失率", unit: "0.05=5%" }` を追加

## 計算の前提(初期値)

- 規模: 12台 / 6ポート(京田辺パイロット想定)
- 売上 = 台数 × 回転率 × 年間稼働日数 × 1回あたり料金
- 自社収益 = 売上 × 自社取り分(60%)
- 損益分岐 = 累積キャッシュフローが初めてプラスになる年
- 減価償却は耐用年数の倍数の年に「更新費」として実支出に計上

数値はすべて仮の初期値です。実データに置き換えて使ってください。
