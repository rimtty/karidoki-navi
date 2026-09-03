# 本番リリース運用手順

刈りどきナビをSupabase + Vercelへ本番公開するときの手順です。本番の外部状態をこの文書の確認コマンドやテストから変更してはいけません。各段階の担当者が対象プロジェクト、対象ブランチ、承認記録を確認してから実行します。

## 安全上の前提

- secret、サービスロールキー、OAuthクライアントsecret、SMTP認証情報はGit、SQL本文、ターミナル出力、ブラウザ、テスト成果物へ書きません。値は承認済みのSecret Manager、Supabase Function secret、Supabase Vault、Vercelの環境変数画面だけで扱います。
- ブラウザとNext.js Clientへ渡すのは `NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` だけです。`SUPABASE_SERVICE_ROLE_KEY` はEdge Functionまたはローカルの管理用E2Eに限定します。
- 本番では有効なSupabase設定の取得失敗をfixtureで隠しません。画面には日本語のエラーと再試行を表示し、原因と復旧を監視記録へ残します。
- DBのバックアップ、適用対象、ロールバック方法、停止判断をリリース責任者が事前に確認します。migrationはforward-onlyを基本とし、既存利用者の圃場・作付けを直接削除しません。
- `update-weather` の本番実行は、まず一地点・一日だけのbounded smokeを成功させてから定期実行を有効化します。

## 0. 事前確認

- 承認済みのリリースコミットで、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`を実行する。
- `pnpm exec supabase` が対象のSupabaseプロジェクトを指していることを、値をログへ出さない方法で確認する。
- 本番用のVercel環境、Supabase Auth、Edge Function、Cron/Vault、MAFF取込の担当者と停止連絡先を決める。
- JMAは安定性・提供継続性を保証する契約APIではないため、障害時に手動CSVへ切り替える担当者とレビュー手順を決める。
- Google OAuthの外部設定と本番SMTPはこの手順の外部作業です。未設定のまま本番ログインを有効にしない。

以下は、必ずこの順序で進めます。

## 1. DB migrationをpushする

1. 本番DBのバックアップ、適用予定migration、空き容量、maintenance windowを確認する。
2. 対象プロジェクトへリンク済みの保護された実行環境から、次を実行する。

   ```bash
   pnpm exec supabase db push
   ```

3. Supabase Dashboardまたは監査SQLで、migration履歴が最後まで適用され、PostGIS、RLS、owner-scoped RPC、`register_field_with_season`、`register_harvest`、`get_field_map`、`get_field_detail` が存在することを確認する。
4. 認証ユーザーを使う最小確認で、他アカウントの圃場・作付け・カスタムルールが返らないこと、`account_id`をクライアント引数にしていないことを確認する。

エラーが出た場合は後続へ進まず、migrationのエラー、対象名、適用済み履歴だけを記録します。キーや接続文字列は記録しません。

## 2. Function secretを設定し、Edge Functionをdeployする

1. `UPDATE_WEATHER_CRON_SECRET` をSupabase Function secretへ登録します。ランダムな値そのものは記録・表示せず、承認済みSecret Managerから入力します。
2. Supabase Functionの標準内部設定として `SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` が利用できることを確認します。サービスロールキーはFunction内だけで使い、ログへ出しません。
3. カスタムBearerをFunction内で検証するため、次のコマンドで `update-weather` だけをデプロイします。

   ```bash
   pnpm exec supabase functions deploy update-weather --no-verify-jwt
   ```

4. `supabase/config.toml` の `[functions.update-weather] verify_jwt = false` とデプロイ設定が一致することを確認します。JWT検証無効化を他のFunctionへ広げません。
5. `Authorization: Bearer ...` の値が `UPDATE_WEATHER_CRON_SECRET` と一致しないリクエストは拒否され、レスポンス・ログにsecretやサービスロールキーが含まれないことを確認します。

`--no-verify-jwt` は認証を無効にする指定ではありません。Supabase GatewayのJWT検証を切り、Function側で専用secretを検証するための構成です。

## 3. bounded smokeを実行する

本番では世羅の気象地点 `67316` に紐づく地点IDを一つだけ指定し、`fromDate` と
`toDate` に同じ観測日を明示して一日だけに限定します。地点IDはDBから確認し、secretや
UUIDを文書・ログへ転記しません。外部JMAの検証ができないローカルでは、同じ地点・一日・
24正時を持つ明示的なfixtureで確認できます。fixtureを本番の成功判定に使ってはいけません。

承認済みの保護された実行環境から、Function URLとsecretを直接書かずにPOSTします。リクエストの形は次のとおりです。

```bash
curl --fail-with-body --max-time 120 \
  -X POST "${UPDATE_WEATHER_FUNCTION_URL}" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${UPDATE_WEATHER_CRON_SECRET}" \
  --data '{"locationIds":["<67316のweather_location_id>"],"fromDate":"<JSTの観測対象日>","toDate":"<同じ観測対象日>"}'
```

`<...>`はその場で確認する値であり、Gitへ置きません。次をDBの監査画面または保護されたSQL実行環境で確認します。
この例の `UPDATE_WEATHER_FUNCTION_URL` は作業端末だけの一時変数であり、アプリの環境変数では
ありません。Function APIでは、`asOfDate` はJSTの実行基準日（カットオフ日）で、明示範囲が
ない場合だけ前日が `targetDate` になります。前日を `asOfDate` で指定する場合は
`targetDateOnly:true` を付け、暗黙バックフィルを許可しません。

- `weather_import_runs` に対象地点・対象日一日の成功記録がある。
- JMAの8ファイルから正時24点が得られ、`daily_weather.sample_count=24`、`expected_sample_count=24` になっている。
- `daily_weather.mean_temp_c` は24点の算術平均（表示桁へ丸めた値）と一致し、欠測を0℃としていない。
- 同じPOSTを同一条件で再実行しても一意キーを増やさずUPSERTされ、関連する `crop_season_summaries` が再計算される。
- レスポンスの `rangeMode=explicit-range`、各結果の `requestedRange` /
  `effectiveRange` が同じ一日を示し、`retentionWindow` 内である。
- 成功・失敗レスポンス、Functionログ、HTTP履歴にsecret、サービスロールキー、Authorizationヘッダー全体が残っていない。

一日・一地点の確認が取れない場合は、CronとMAFF取込へ進まず、JMA非保証の代替としてレビュー済み手動CSV経路を検討します。

## 4. VaultとCronを有効化する

1. Supabase Vaultへ、値をGitへ書かずに次の用途のsecretを登録します。
   - `karidoki_navi_project_url`: Function URLの保管名
   - `karidoki_navi_update_weather_secret`: `UPDATE_WEATHER_CRON_SECRET` と同じ値を参照する保管名
2. [Cron SQLテンプレート](../supabase/cron/update-weather.sql) のコメント、対象プロジェクト、Vault名、Functionデプロイ結果をレビューします。URLやBearerをSQLへ直書きしません。
3. pg_cronとpg_netの有効化権限を確認し、次のUTCスケジュールを個別に登録します。

   | 用途 | JST | UTC cron |
   | --- | --- | --- |
   | 前日分の通常更新 | 毎日06:30 | `30 21 * * *`（前日） |
   | 失敗地点の再試行 | 毎日12:30 | `30 3 * * *` |
   | 訂正値の再取得 | 月曜07:00 | `0 22 * * 0`（日曜UTC） |

4. CronのAuthorizationはカスタムBearerとし、サービスロールJWTを設定しません。
5. `cron.job`、`net._http_response`、`weather_import_runs`、Functionログで、初回実行、HTTP status、所要時間、失敗地点、重複実行の有無を確認します。失敗時はretryOnlyまたは、Functionの `JMA_WEATHER_RETENTION_DAYS` 以下に設定した correctionDays の範囲を守り、無制限再試行にしません。未設定時の保持期間と週次訂正値は28日です。

テンプレートはmigrationではありません。bounded smokeとレビューが完了するまでコメントを外さず、本番Cronを自動で有効化するmigrationを追加しません。

## 5. MAFF 2,010件を取り込む

1. [MAFF取込手順](maff-parcel-import.md)に従い、2026年広島県FlatGeobufの6分割、監査JSON、取得ハッシュ、CRS、スキーマを保護された一時領域へ保存します。原本と生成NDJSONをGitへ入れません。
2. 三原市 `34204`、公式久井キー接頭辞 `3420424`、`land_type=100`（田）で抽出し、久井町の候補件数が2,010件であることを確認します。三原市全体や畑を誤って投入しません。
3. 構造不正、`ST_IsValid`、`ST_MakeValid`による修復件数、SRID、MultiPolygon正規化件数を監査値として記録します。
4. サービスロール専用の保護された取込環境から `source_imports` と `parcel_candidates` へ投入し、候補RPCのbbox/limit上限、MVT応答、認証ユーザーからの参照範囲を確認します。ブラウザから直接テーブルへ書き込みません。
5. 取込後にアプリの地図で候補表示を一地点だけ確認し、2,010件の件数、監査台帳ID、取得元、年度をリリース記録へ紐づけます。

候補だけを戻す場合は、対象 `source_import_id` を確認してから候補行を先に削除し、台帳を削除します。圃場へコピー済みの形状やユーザー作付けを対象年度以外まで削除しません。具体的なSQL骨子は [MAFF取込手順](maff-parcel-import.md)にあります。

## 6. Vercelへdeployする

1. VercelのProduction環境へ、`NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` だけを公開クライアント設定として登録します。値はVercelのSecret管理画面から入力し、Git、ビルドログ、画面へ出しません。
2. `vercel.json`の`regions`が`hnd1`であることを確認し、PreviewとProductionのFunctionsが東京へ配置されたことをデプロイ詳細で確認します。
3. `SUPABASE_SERVICE_ROLE_KEY`、`UPDATE_WEATHER_CRON_SECRET`、OAuth/SMTP credentialsをNext.jsの公開環境変数へ追加しません。Edge FunctionのsecretとVaultはSupabase側で管理します。
4. Production buildを実行し、`/login`、`/auth/callback`、`/app`、`/app/fields`、`/app/fields/[fieldId]`、`/app/guide`、`/app/settings/variety-rules` のレスポンスが、設定済みSupabaseの実データまたは日本語エラーを返すことを確認します。fixtureが本番表示へ混ざっていないことを確認します。
5. VercelのデプロイURL、commit、build結果、エラーログの確認者を記録します。

## 7. Auth callbackと外部認証を確認する

1. Supabase AuthのSite URLを本番HTTPS originへ設定し、追加リダイレクトURLには本番の `/auth/callback` を完全一致で登録します。開発用URLや任意の外部URLを本番allow-listへ残しません。
2. Google OAuthはGoogle側のOAuthクライアント、同意画面、承認済みredirect URIとSupabase側のGoogle providerを管理者が外部設定します。これはリポジトリだけでは完了しない外部作業です。クライアントIDやsecretをGitへ書きません。
3. 非本番の専用アカウントで、メールログイン、Google選択、OAuthから `/auth/callback` でのPKCE交換、`/app`への遷移、ログアウトを確認します。callback失敗時に日本語エラーへ戻り、外部URLへopen redirectしないことを確認します。
4. メール新規登録、確認リンク、パスワード再設定を本番で提供する場合は、Supabaseの本番SMTPを事前に契約・認証・送信元・レート制限まで設定します。ローカルSMTPや開発用メール画面を本番運用の代わりにしません。

Google OAuth外部設定とSMTP本運用前設定が終わるまでは、メール／Googleの本番受入を完了扱いにしません。

## 8. 監視とrollback

### 監視開始

本番有効化後は、少なくとも次を同じリリース記録へ紐づけて監視します。

- Vercelのデプロイ、Server/Clientエラー、`/auth/callback`失敗、5xx、レイテンシ
- Supabase Authの失敗率、DB接続、RLS拒否、RPCエラー、migration履歴
- Edge Functionの実行数、HTTP status、timeout、入力上限超過、失敗地点、再試行回数
- `weather_import_runs` の成功・失敗、`daily_weather` の24点／品質／最新日、`crop_season_summaries` の再計算遅延
- Cron実行履歴、pg_net応答、重複実行、MAFF `source_imports` の件数・無効・修復件数

ログにはsecret、Authorization全体、サービスロールキー、メール本文、不要な個人データを収集しません。アラートには対象、発生時刻、commitまたはFunction revision、復旧担当を付けます。

### 停止・復旧順序

異常を検知したら、影響範囲を記録してから次の順序で止めます。

1. 追加のCron scheduleを停止し、同じFunctionの重複実行を止める。
2. Functionの入力・外部JMA応答・DBエラーを確認し、必要なら直前の既知正常revisionへ再deployする。secretは再掲しない。
3. Vercelを直前の既知正常デプロイへ戻し、Auth callbackと公開環境変数を再確認する。
4. データ不整合が疑われる場合は、監査台帳、日別気象の一意キー、サマリー再計算結果を保全する。migrationを手作業で削除したり、ユーザー圃場を一括削除したりしない。
5. MAFF候補の誤取込は対象 `source_import_id` と2,010件の監査記録を確認し、[取込手順](maff-parcel-import.md)の限定的な候補ロールバックだけを承認付きで行う。
6. 原因修正、bounded smoke、Auth callback、監視確認を再実施してからCronを一つずつ再開する。

## 完了証跡

リリース責任者は次の証跡を、secretや個人情報を含まない形で保存します。

| 段階 | 必要な証跡 |
| --- | --- |
| DB | 適用済みmigration一覧、バックアップ確認、RPC/RLS最小確認 |
| Function | deploy revision、`--no-verify-jwt`確認、secret非露出のログ確認 |
| bounded smoke | 地点67316、同一from/toの一日、24正時、平均、UPSERT、サマリー再計算、取得範囲の結果 |
| Vault/Cron | Vault名、cron job名・UTC schedule、初回HTTP status・所要時間 |
| MAFF | 2026年、久井、田、2,010件、監査台帳ID、無効／修復件数 |
| Vercel | Production deployment、commit、build結果、公開env名の確認 |
| Auth | Site URL、callback allow-list、メール／Google結果、SMTP確認 |
| 監視 | ダッシュボード、アラートテスト、rollback責任者と復旧記録 |

## 現時点の留保

- Google OAuthのクライアント登録・redirect設定は外部作業であり、SMTPの本番運用前設定も未完了です。
- iPhone Safari/PWAとAndroid Chrome/PWAの実機確認は未実施です。PlaywrightのモバイルChromeエミュレーションは実機受入の代わりになりません。
- JMA地点別JSONは非保証です。障害時はレビュー済み手動CSVへ切り替え、データ品質と出典を記録します。
- seasonありの暗黙バックフィルが保持期間で短縮された場合は、レスポンスの
  `csvFallbackStatus=REQUIRED_FOR_OLDER_DATES` を確認し、古い日付をレビュー済みCSVで補います。
- 初期5品種の公式閾値は未設定です。利用者カスタムルールを使う場合も、根拠メモと作付け登録時点のスナップショットを確認します。
