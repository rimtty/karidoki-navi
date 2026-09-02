# 気象取得（JMA AMeDAS）運用メモ

## Provider境界

アプリの気象取得は `WeatherProvider` の境界へ閉じ込めています。MVPの
`JmaAmedasProvider` は、気象庁Webサイトが利用している次の無償JSONを、地点単位・
低頻度・キャッシュ付きで参照します。

- 地点一覧: <https://www.jma.go.jp/bosai/amedas/const/amedastable.json>
- 地点別: <https://www.jma.go.jp/bosai/amedas/data/point/{station}/{YYYYMMDD}_{HH}.json>
  （`HH` は `00,03,06,09,12,15,18,21`）

この地点別JSONは、気象庁が本番APIとして安定性・提供継続性を保証した契約APIではなく、
Webサイトが使う内部的なエンドポイントです。仕様、URL、アクセス制限、提供条件が将来
変更される可能性があります。大量・高頻度のスクレイピングには使わず、障害時は手動CSV
経路へ切り替えます。将来WAGRI等へ差し替える場合も、DBの正規化形式は変えずに
`WeatherProvider`実装だけを交換します。

## 日平均と品質

JMAの地点JSONは10分値を含むため、1日8ファイルを取得してJSTのローカル日付へまとめます。
各時刻の`00分`を優先して1時間1点を選び、24時間そろえばその24値の平均を日平均とします。
正時が欠けた時間は同じ時間帯で最も近い有効値を使い、`ESTIMATED`にします。1点も得られ
なければ日平均は`null`かつ`MISSING`です。欠測を0℃に変換する処理はありません。

保存する値は次のとおりです。

- `mean_temp_c`, `min_temp_c`, `max_temp_c`
- `sample_count` / `expected_sample_count`（MVPのJMA値は24点）
- `quality_code`（`COMPLETE`, `ESTIMATED`, `MISSING`, `INVALID`）
- `source_metadata`（地点、取得URL群、JST、重複除去数、集約方法、取得時刻）
- `weather_import_runs` の期間、成否、エラー、取得元メタデータ

同じ観測タイムスタンプが複数ファイルに現れた場合は1つへ重複除去します。値が後から
訂正された場合は週次60日再取得で同じ地点・日付をUPSERTします。

## Edge Function

`supabase/functions/update-weather` はPOST専用です。実行時にJSTの前日を対象とし、地点ごと
に未取得日と前日を取得します。`{"retryOnly":true}` は直近の失敗地点を再試行し、
`{"correctionDays":60}` は直近60日を強制再取得します。取り込み後は関連する
`crop_season`ごとに `recalculate_crop_season_summary` RPCを呼び、日別値から積算・欠測数・
データ状態・成熟状態を冪等に再生成します。

Edge Functionは `UPDATE_WEATHER_CRON_SECRET` を必須とし、`Authorization: Bearer ...` が
一致しない呼出しを拒否します。SupabaseのサービスキーとこのsecretはFunction/Vaultへ登録し、
Git、SQL、ブラウザへ出しません。

## 手動CSVへの切替

JMAの「過去の気象データ・ダウンロード」から、対象地点・対象日を絞り、日平均・最高・最低・
品質情報を含めたCSVを人が確認して保存します。CSVファイルには個人情報を含めず、対象地点、
抽出条件、取得日時を作業記録へ残してください。作業端末の一時ファイルはリポジトリ外へ
置きます。

Nodeジョブや検証では `parseManualDailyWeatherCsv` と `ManualCsvWeatherProvider.fromCsv` を
使えます。ヘッダは `date,mean_temp_c,max_temp_c,min_temp_c,quality_code` または、JMAの
`年月日,平均気温(℃),最高気温(℃),最低気温(℃),品質情報` を受け付けます。日付の重複は最初の
1行だけを採用し、値が`-`/`///`の行は`MISSING`として保持します。

本番DBへ投入する際は、レビュー済みCSVを専用の一時取り込みスクリプト（サービスロールを
ローカルへ保存しない、地点ID・日付範囲・行数を検証する、`daily_weather`の一意キーでUPSERT
する）から投入し、その後 `recalculate_crop_season_summary` を対象作付けへ実行します。
CSVをGitへコミットしたり、ブラウザから直接テーブルへ書き込んだりしないでください。

## Cron

本番CronのSQLテンプレートは [`supabase/cron/update-weather.sql`](../supabase/cron/update-weather.sql)
です。これはmigrationではなく、全スケジュール文をコメントアウトした承認待ちの成果物です。
pg_cronがUTC実行の場合、06:30 JST（UTC 21:30）、12:30 JST（UTC 03:30）、週次訂正（月曜
07:00 JST、UTC日曜22:00）を設定します。VaultへURLとBearer secretを登録してから、親タスクの
最終承認後に個別実行してください。自動で本番cronを有効化するmigrationはありません。
