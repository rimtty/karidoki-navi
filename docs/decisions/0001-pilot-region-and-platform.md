# ADR 0001: 実証地域と配信基盤

- 状態: Accepted
- 決定日: 2026-09-03

## 決定

- 実証地域は広島県三原市久井町とする。
- Web/PWAはVercel、認証とPostgreSQL/PostGISはSupabaseを使用する。
- Vercel Functionsは東京の`hnd1`単一リージョンで実行し、東京のSupabase（`ap-northeast-1`）との往復遅延を抑える。静的資産はVercel CDNから配信する。
- 地図はMapLibre GL JSから国土地理院の標準地図タイルを表示する。
- 農地区画候補は農林水産省の2026年筆ポリゴン（FlatGeobuf、世界測地系・緯度経度）を使用し、広島県データを取り込む。
- 気象地点は圃場ごとに固定せず、気温を観測する地点から距離順に候補を計算し、利用者が変更できるようにする。久井町では世羅・本郷等が候補になり得るが、実際の圃場座標から決定する。
- 初期品種マスターは、コシヒカリ、あきさかり、あきろまん、ヒノヒカリ、恋の予感の5品種とする。
- 品種名とVarietyRuleは分離し、公的根拠を確認できていない積算温度を推測で登録しない。
- MVP認証はSupabase Authのメールアドレス＋パスワードとGoogleログインの2方式を提供し、利用者が選べるようにする。電話番号認証とメールOTPは初期スコープ外とする。
- 日次バッチはSupabase CronからSupabase Edge Functionを起動する。Web/PWAと通常のRoute HandlerはVercelで配信する。

## 理由

久井町は三原市内でも水稲作付面積が大きく、市の資料で主要品種と地域の生産組織が確認できる。標高差があるため、行政区域だけで気象地点を一律指定するより、圃場座標と観測所座標から候補を提示する方が説明可能である。

VercelとSupabaseはすでにプロジェクトが作成され、GitHub連携・本番配信・PostGISマイグレーションが動作している。クラウド固有処理は認証、シークレット、スケジュール起動の境界へ限定する。

Vercel Functionsの既定リージョンは米国東部で、東京のSupabaseに対する認証確認とDB取得がリージョン間通信になっていた。`vercel.json`の`regions`を`hnd1`に固定し、再デプロイ後も配置が戻らないようにする。Hobbyでは単一リージョンを使用する。

Vercel HobbyのCronは1日1回までのため、06:30と12:30の2回実行要件には使用しない。Supabase Cronは`pg_cron`を基盤に複数回の実行と実行履歴の確認ができる。Edge Function呼出し用の値はSupabase Vaultへ保存する。

## 出典と表示

- 国土地理院標準地図: `https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png`
- 地図上に「国土地理院」への出典リンクを常時表示する。
- 筆ポリゴンの公開年度、取得元URL、取得日時、ファイル名、SHA-256、取込件数を保存する。

## 未決事項

- 品種別VarietyRuleの確定値
- 試験運用に参加する農家アカウントと実機受入日程

## 公式資料

- 三原市 久井町アグリマップ: https://www.city.mihara.hiroshima.jp/uploaded/attachment/115959.pdf
- JAグループ広島 「恋の予感」本格導入: https://www.ja-hiroshima.or.jp/wp/archives/3698/
- 広島県 水稲・麦・大豆栽培基準: https://www.pref.hiroshima.lg.jp/soshiki/82/kijun.html
- 気象庁 広島県内の観測所配置図: https://www.data.jma.go.jp/hiroshima/haiti.html
- 農林水産省 筆ポリゴン: https://www.maff.go.jp/j/tokei/census/shuraku_data/2025/mb/index.html
- 国土地理院 地理院タイル一覧: https://maps.gsi.go.jp/development/ichiran.html
- Supabase Cron: https://supabase.com/docs/guides/cron
- Supabase Edge Functionの定期実行: https://supabase.com/docs/guides/functions/schedule-functions
- Vercel Cronの制約: https://vercel.com/docs/cron-jobs/manage-cron-jobs
