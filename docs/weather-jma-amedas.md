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
訂正された場合は週次の保持期間内再取得（未設定時28日）で同じ地点・日付をUPSERTします。

## Edge Function

`supabase/functions/update-weather` はPOST専用です。日付はすべてJSTのカレンダー日です。
通常の `{}` は当日の前日を `targetDate` とし、season bindingがない地点はその1日だけを
取得します。season bindingがある地点だけ、出穂日または地点メタデータを起点に最大60日の
暗黙バックフィルを計画します。

`asOfDate` は観測対象日ではなく、JSTの実行基準日（カットオフ日）です。明示的な範囲を
指定しない場合の `targetDate` は `asOfDate` の前日になります。運用者が前日だけを厳密に
取得する場合は `{"asOfDate":"YYYY-MM-DD","targetDateOnly":true}` を使います。より明示的な
再取得には `fromDate` と `toDate` を必ず組で指定します（`asOfDate`、`targetDateOnly`、
`correctionDays` とは併用しません）。同じ日を指定した `fromDate`/`toDate` は1日だけの
bounded smokeになります。レスポンスには `asOfDate` の意味、`targetDate`、要求範囲、実際の
取得範囲、JMA保持期間が含まれます。

`{"retryOnly":true}` は直近の失敗地点を再試行します。`{"correctionDays":N}` は直近N日を
強制再取得しますが、Nは1〜60かつJMAの利用可能期間以内でなければならず、超過時は400を
返します。期間を暗黙にclampして実行することはありません。

JMA地点別JSONの保持期間は実測または運用確認した値を `JMA_WEATHER_RETENTION_DAYS`（1〜60）
へ設定できます。未設定時は安全側の28日です。seasonありの暗黙バックフィルだけはこの保持
期間まで短縮し、レスポンスの `retentionLimited=true` / `csvFallbackStatus=REQUIRED_FOR_OLDER_DATES`
で保持期間外の古い日付を手動CSVで補う必要があることを示します。保持期間外の日付を
JMAへ繰り返し要求しません。明示範囲と `correctionDays` は保持期間外なら400です。

取り込み後は関連する `crop_season` ごとに `recalculate_crop_season_summary` RPCを呼び、
日別値から積算・欠測数・データ状態・成熟状態を冪等に再生成します。複数地点・複数範囲の
一部が失敗した場合は `ok=false` とHTTP 207を維持し、成功した範囲、失敗、CSV fallback状態を
レスポンスと監査行へ残します。

運用上の上限は、1回あたり地点100件、訂正範囲60日、地点リクエストの本文32KiBです。
JMAの各JSON取得は15秒でタイムアウトし、Function全体にも120秒の実行予算を設けています。
失敗した地点は実行履歴へ記録し、レスポンスにはsecretやサービスキーを含めません。

Edge Functionは `UPDATE_WEATHER_CRON_SECRET` を必須とし、`Authorization: Bearer ...` が
一致しない呼出しを拒否します。このFunctionだけはカスタムBearerを使うため、Supabase
GatewayのJWT検証を無効にしてデプロイします。

```sh
supabase functions deploy update-weather --no-verify-jwt
```

リポジトリの `supabase/config.toml` にも `[functions.update-weather] verify_jwt = false` を
記録しています。GatewayでJWT検証を無効にする範囲はこのFunctionだけに限定し、Function内で
secretを先に検証します。CronからはサービスロールJWTをBearerにしません。Supabaseのサービス
キーと `UPDATE_WEATHER_CRON_SECRET` はFunction/Vaultへ登録し、Git、SQL、ブラウザ、レスポンスへ
出しません。

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
`update-weather`を上記の `--no-verify-jwt` 付きでデプロイし、VaultのURLと同じ
`UPDATE_WEATHER_CRON_SECRET`を登録してから、テンプレートのコメントを外して実行します。
pg_cronがUTC実行の場合、06:30 JST（UTC 21:30）、12:30 JST（UTC 03:30）、週次訂正（月曜
07:00 JST、UTC日曜22:00）を設定します。VaultへURLとBearer secretを登録してから、親タスクの
最終承認後に個別実行してください。自動で本番cronを有効化するmigrationはありません。
