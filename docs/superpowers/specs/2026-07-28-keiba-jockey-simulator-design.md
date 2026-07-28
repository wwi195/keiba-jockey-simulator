# 騎手別G1単勝バックテスト・シミュレーター 設計ドキュメント

**作成日：** 2026-07-28

---

## 概要

過去のJRA G1レース結果（`keiba`プロジェクトの「G1データ」スプレッドシート）をもとに、「特定の騎手の単勝馬券を、指定期間・指定金額でG1レースのたびに買い続けたら、投資額・払戻額・還元率・勝敗はどうなっていたか」を計算する静的Webシミュレーター。

タイトル例：「過去10年分のG1でルメールの単勝に1万円賭けた結果」

---

## 位置づけ

```
[keiba/ 既存]                          [keiba-jockey-simulator 新規]
G1データシート(拡張)                      data/races.json（静的JSON、事前エクスポート）
  ↓ export_races.py                        ↓
  Sheets APIで読み込み → JSON書き出し         index.html + simulator.js
                                            （ローカル完成後、GitHub Pagesへ）
```

Google Sheets（サービスアカウント認証）へのアクセスはエクスポート時のみ発生し、フロントエンドは静的JSONのみを参照する。認証情報をブラウザに露出させない、`umaren-vs-takarakuji`プロジェクトと同じ構成。

---

## 前提となるデータ拡張（keiba/側）

現状の「G1データ」シートは勝ち馬（1着）の騎手名しか記録していないため、「ある騎手が騎乗した全レース」を特定できない。以下の拡張を行う。

1. `g1_sheets_writer.py`のHEADERに`horseN_jockey`（N=2〜18）を追加
2. `g1_parser.py`の`build_row()`で、勝ち馬以外の`horseN_*`にも`jockey`を含める（`_parse_horses()`は既に全馬の騎手名を取得済みのため、パース処理自体の変更は不要）
3. **2016〜2026年を1回の`fetch_g1_race_list(2016, 2026)`呼び出しでまとめて再取得し、シートを作り直す。** 年ごとに分けて実行すると開催日順が崩れる（実際、今回2026年分を後追いで実行した結果、末尾に混在してしまっている）。1回のリクエストでdb.netkeiba側が返す開催日降順を維持することで、シートの行順＝「最新レースが上」を保証し、シミュレーターの「過去Nレース」判定にそのまま使えるようにする

---

## JSONエクスポート

`keiba-jockey-simulator/export_races.py`（新規）で、既存のサービスアカウント認証情報（`keiba/credentials.json`）を使い「G1データ」シートを読み込み、`data/races.json`を生成する。

- 配列の順序 = シートの行順（開催日降順、最新が先頭）をそのまま保持
- 払戻情報（複勝・馬連等）は本シミュレーターでは使わないため含めない（軽量化）
- 各馬の`position`はシート上の並び順（勝ち馬=1、horse2=2、…）からそのまま採番

```json
[
  {
    "race_name": "有馬記念(GI)",
    "year": 2025,
    "venue": "中山",
    "track": "芝",
    "horses": [
      {"position": 1, "number": 4, "name": "ミュージアムマイル", "jockey": "Ｃデム", "odds": 3.8, "popularity": 3},
      {"position": 2, "number": 10, "name": "コスモキュランダ", "jockey": "田辺", "odds": 111.5, "popularity": 12}
    ]
  }
]
```

---

## フロントエンド

### 画面構成（`index.html` + `simulator.js`、`umaren-vs-takarakuji/webapp`と同様のフォーム型）

1. **期間モード**（トグルでどちらか一方を選択）
   - 過去N年（Nを入力、例：10）
   - 過去Nレース（Nを入力、例：50）
2. **賭け金**（数値入力、100円〜10,000,000円、単勝馬券に固定で賭ける金額）
3. **騎手**（プルダウン。`races.json`の全`horses[].jockey`からユニーク一覧を起動時に生成）
4. 「計算する」ボタン

### 計算ロジック

```
1. モードに応じて対象レース配列を絞り込む
   - 年数モード: race.year >= (races[0].year - N + 1)
   - レース数モード: races.slice(0, N)   ※races は既に開催日降順

2. 対象レースごとに、選択した騎手が騎乗している馬を horses から検索
   - 見つからない場合: そのレースはスキップ（負け扱いにしない。騎乗していないレースは母数に入れない）
   - 見つかった場合:
       bets += 1
       investment += 賭け金
       if horse.position === 1:
           payout += 賭け金 * horse.odds
           wins += 1
       else:
           losses += 1

3. 結果表示
   - 対象レース数（bets）
   - 投資額（investment）
   - 払戻金（payout）
   - 還元率 = payout / investment * 100 (%)
   - 成績 = "{wins}勝{losses}敗"
   - 勝率 = wins / bets * 100 (%)
```

### エラー処理

| 状況 | 動作 |
|---|---|
| `bets === 0`（指定期間中に一度も騎乗なし） | 計算結果の代わりに「指定期間中、この騎手の騎乗レースはありませんでした」を表示 |
| 賭け金が範囲外（100円未満・10,000,000円超）・未入力 | 入力欄の下に赤字でバリデーションメッセージを表示し、「計算する」ボタンを無効化する |

---

## ファイル構成

```
C:\Users\ab_99\keiba-jockey-simulator\
  index.html          ← シミュレーター画面
  simulator.js         ← 計算ロジック・プルダウン生成
  export_races.py      ← Sheets → JSONエクスポートスクリプト（keiba/credentials.jsonを参照）
  data/
    races.json          ← エクスポートされた静的データ
  docs/superpowers/specs/
    2026-07-28-keiba-jockey-simulator-design.md  ← 本ドキュメント
```

---

## 開発・公開フロー

1. ローカルでこのリポジトリを完成させる（`git init`済み、コミットはローカルのみ）
2. 動作確認（ブラウザで`index.html`を直接、またはローカルサーバー経由で確認）
3. ユーザーが完成を確認後、GitHubにリモートリポジトリを作成してpush（今回は実施しない、後日の作業）

### データ更新方針

来年以降、新しいG1レースが増えたら「更新して」と言われた時点で、`keiba/g1_fetch.py`でシート更新 → `export_races.py`でJSON再生成 → （公開済みなら）再デプロイ、の順で対応する。自動化・スケジュール実行は行わない（既存keibaプロジェクトの方針を踏襲）。

---

## 関連ドキュメント

- [G1レース結果収集ツール 設計](../../../../docs/superpowers/specs/2026-07-28-keiba-g1-scraper-design.md)（`keiba`プロジェクト側）
- データソース：Google Sheets ID `1Tr7D8-qsGrNDwZH_m-0vCGGIa6NRM4DyaQWSA21ZDhM`（ワークシート「G1データ」）
- UI参考：`umaren-vs-takarakuji/webapp`（フォーム入力→数値結果表示のパターン）
