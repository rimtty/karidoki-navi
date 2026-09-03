# 🌾 刈りどきナビ

刈りどきナビは、広島県三原市久井町の田んぼを地図で管理し、出穂後の日平均気温を積算して、次に確認する圃場を見つけやすくするスマートフォン向けWeb/PWAです。数値は収穫時期を決めるための補助情報であり、実際の収穫判断は現地の状態とあわせて行います。

## 対象地域とMVP

現在の実証対象は三原市久井町です。初期の品種マスターは次の5品種に固定しています。

- コシヒカリ
- あきさかり
- あきろまん
- ヒノヒカリ
- 恋の予感

この5品種について、久井町へ適用できる公的な出穂後積算気温の閾値はまだ確認できていません。品種は選択できますが、該当する公式値がない場合は画面に「公式ルール未設定」と表示し、他地域の値を推測で転用しません。利用者が根拠メモ付きの地域ルールを登録する設定画面を用意し、作付け登録時点の値をスナップショットとして保存します。方針の背景は [ユーザー定義品種ルールADR](docs/decisions/0003-user-defined-variety-rules.md) を参照してください。

## 主な画面

認証済みのユーザーだけが `/app` 以下へアクセスできます。

| パス | 画面 |
| --- | --- |
| `/login` | メールアドレス＋パスワード、またはGoogleを選ぶログイン画面。メールでの新規登録も含む |
| `/forgot-password` | 登録済みメールアドレスへパスワード再設定メールを送る画面 |
| `/reset-password` | 再設定メールの認証後に新しいパスワードを登録する画面 |
| `/app` | 今日の刈りどき地図。状態チップ、圃場ポリゴン、積算値、気象地点、反映日を表示 |
| `/app/fields` | 刈取時期が近い順に確認できる田んぼ一覧 |
| `/app/fields/new/1` ～ `/3` | 筆ポリゴン選択または手描き、名前・品種・出穂日、確認の3段階登録 |
| `/app/fields/[fieldId]` | 圃場詳細、積算グラフ、データ品質、収穫登録 |
| `/app/settings/variety-rules` | アカウント所有の品種別カスタムルールの登録・編集・削除 |

圃場登録は `register_field_with_season` RPCへ1トランザクションで送信します。`account_id` はブラウザから送らず、認証セッションからDBが決定します。同じ冪等キーで再試行しても同じ登録結果を返し、二重タップもクライアント側で抑止します。地図・一覧・詳細は `get_field_map` / `get_field_detail` RPC等をDB行からアダプターでUIモデルへ変換して表示します。RLSとowner-scoped RPCの両方で、認証ユーザー自身のデータだけを扱います。

## 認証とフォールバック

認証にはSupabase Authを使います。メールアドレス＋パスワードとGoogleログインを選択でき、ログイン後のセッションはSSR用Cookieで維持します。メール確認とパスワード再設定は、同一サイトのPKCE callbackでセッションを確立してから処理します。本番のGoogle OAuthとAmazon SES SMTPは外部設定し、本番メールアドレスへの実配送を受入ゲートとして管理します。手順と未完了事項は [リリース運用手順](docs/release-runbook.md) にまとめています。

Supabaseの公開設定がないローカル開発時だけ、明示的な開発用fixtureで画面を確認できます。非本番での接続失敗も開発用表示に限定され、本番環境に有効なSupabase設定がある場合はfixtureへ切り替えず、日本語のエラーと再試行導線を表示します。fixtureの圃場や気温を実際の収穫判断に使わないでください。

## 気象データ

MVPの `JmaAmedasProvider` は、気象庁Webサイトが参照する地点別JSONを低頻度・キャッシュ付きで取得し、3時間ごとの8ファイルから正時24点を作って日平均を計算します。これは気象庁が安定性・提供継続性を保証する契約APIではありません（JMA非保証）。仕様変更や障害に備え、欠測を0℃にせず `MISSING` / `ESTIMATED` / `INVALID` として保持し、必要な場合はレビュー済みの手動CSVへ切り替えます。CSV形式、品質情報、再取得・訂正の扱いは [JMA/AMeDAS運用メモ](docs/weather-jma-amedas.md) を参照してください。

日次処理はSupabase Cronから `update-weather` Edge Functionを起動し、取り込み後に作付けサマリーを再計算します。世羅（地点 `67316`）など、圃場から距離の近い地点を候補として提示します。気温の取得値や適期表示は必ず更新日・品質・観測地点を確認してください。

## 筆ポリゴンと地図

地図はMapLibre GL JS、背景は国土地理院タイル、筆ポリゴン候補は農林水産省（MAFF）の2026年FlatGeobufを使います。三原市久井町の `land_type=100`（田）として監査済みの候補は2,010件です。原本・生成物はリポジトリへ入れず、取得物のハッシュ・件数・構造検査を監査台帳に残します。取得、抽出、PostGIS投入、出典とロールバックは [MAFF筆ポリゴン取込手順](docs/maff-parcel-import.md) を参照してください。地図上には国土地理院とMAFFの出典表示を残します。

## Supabase / Vercel構成

| 層 | 役割 |
| --- | --- |
| Vercel | Next.js 16のWeb/PWA配信。FunctionsはSupabase東京リージョンに近い`hnd1`へ固定し、Server/Client境界を分けて`cookies()`、`params`、`searchParams`などのasync APIをサーバー側で扱う |
| Supabase Auth | メール・Google認証、SSRセッション、認証ユーザーの識別 |
| Supabase PostgreSQL + PostGIS | 圃場、作付け、品種、地域ルール、日別気象、筆候補の保存。RLSとRPCで所有者境界を強制 |
| Supabase Edge Function | `update-weather`によるJMA取得、日別値のUPSERT、作付けサマリー再計算 |
| Supabase Cron / Vault | 日次・再試行・週次訂正の起動と、Function URL・内部呼出し用secretの保管 |

ブラウザへ出してよいSupabase設定は公開URLとpublishable keyだけです。サービスロールキーやCron呼出し用secretをブラウザ、Git、SQL本文、レスポンスへ出しません。Edge FunctionはカスタムBearerを検証するため、`update-weather`だけGatewayのJWT検証を無効にしてデプロイします。詳しい順序は [リリース運用手順](docs/release-runbook.md) を参照してください。

## 環境変数

`.env.example`には値を持たない公開設定名だけを記載しています。

| 名前 | 用途・扱い |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | ブラウザとSSRが使うSupabase URL。公開情報 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | ブラウザとSSRが使うpublishable key。公開情報 |
| `SUPABASE_URL` | Edge Functionの内部接続先。Supabase実行環境で設定 |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge FunctionやローカルE2Eの管理API専用。ブラウザ・Next.jsクライアントへ渡さない |
| `UPDATE_WEATHER_CRON_SECRET` | `update-weather`のカスタムBearer。Function secretとVaultで同じ値を管理し、値は保存・出力しない |
| `E2E_BASE_URL` | Playwrightが接続するURLを上書きする場合だけ指定 |
| `E2E_REUSE_SERVER` | 起動済みの同一環境のNext.jsを再利用する場合だけ `1` |

`NEXT_PUBLIC_*`以外の値を`.env.local`へ置く場合もGitへ追加しません。ローカルE2Eは `supabase status --output env` から接続情報をプロセス内だけで受け取り、専用ユーザーを終了時に削除します。

## ローカル開発

前提はNode.js、pnpm、Docker、Supabase CLIです。

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

Supabaseを使う実接続確認は、別ターミナルで次を実行します。

```bash
pnpm exec supabase start
pnpm exec supabase db reset
```

設定がない状態で `pnpm dev` を起動すると、開発用fixtureで主要画面を確認できます。ローカルSupabaseの接続値を設定すれば、Auth、RLS、RPC、DBデータを使う実接続になります。DB変更は `supabase/migrations/` で管理し、Dashboard上で本番テーブルを直接変更しません。

## 品質確認・テストコマンド

通常の品質確認は次の順で実行します。

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

追加の確認コマンドは次のとおりです。

```bash
pnpm test:watch
node scripts/verify-pwa.mjs
pnpm e2e
pnpm e2e:headed
pnpm exec playwright install chromium
pnpm e2e:local
pnpm start
```

`e2e:local`は先に `pnpm exec supabase start` を実行し、ローカルSupabaseだけを使います。Pixel 7相当のモバイルChromeで、未認証リダイレクト、メールログイン、3段階登録、一覧・詳細、収穫登録、ログアウト、公式ルール未設定表示に加え、ローカル受信箱の再設定メールから新パスワードで再ログインするまでを確認します。専用ユーザーとテスト結果の扱いは [モバイルE2E README](tests/e2e/README.md) を参照してください。

MAFFの取得・検査・抽出はデータ作業用コマンドです。原本は一時ディレクトリへ出力してください。

```bash
pnpm maff:parcels download
pnpm maff:parcels inspect --source-dir /tmp/karidoki-maff-2026-34-XXXX
pnpm maff:parcels extract --source-dir /tmp/karidoki-maff-2026-34-XXXX
```

## PWAとオフライン

Manifest、アイコン、Service Worker、オンライン／オフライン表示を実装しています。Service Workerが保存するのは公開シェル、ハッシュ付き静的資産、国土地理院タイルだけで、`/app`、`/login`、`/auth`、Supabaseレスポンス、圃場データはCache Storageへ保存しません。オフライン中の登録・更新をキューイングせず、通信復旧後に再試行します。詳細は [PWA・オフライン方針](docs/pwa.md) を参照してください。

iPhone SafariとAndroid Chromeの実機受入、ホーム画面インストール、通信遮断時の表示はまだ確認していません。現時点のPlaywrightはモバイルChromeエミュレーションであり、実機確認の代わりにはなりません。

## リリースと未完了事項

本番リリースは [docs/release-runbook.md](docs/release-runbook.md) の順序（DB、Edge Function、bounded smoke、Vault/Cron、MAFF、Vercel、Auth callback、監視／rollback）で実施します。本番外部状態はこのリポジトリのテストから変更しません。

Google OAuthと確認メール／パスワード再設定用のAmazon SES SMTPはSupabaseへ設定済みです。東京リージョンのSES本番利用承認、カスタムMAIL FROM設定、SMTP接続テストメールの実配送まで完了しており、アプリからの新規登録確認とパスワード再設定は管理者が縦通し確認する必要があります。JMA地点別JSONは非保証のため、障害時は手動CSV経路を使えるようにします。公式の品種別閾値は未設定のままです。

リポジトリ内の合否と本番外部ゲートを分けた監査表は [リリース準備監査](docs/release-readiness.md) を参照してください。

## データソースと設計資料

- [パイロット地域・プラットフォームADR](docs/decisions/0001-pilot-region-and-platform.md)
- [JMA気象ソースADR](docs/decisions/0002-jma-weather-source.md)
- [ユーザー定義品種ルールADR](docs/decisions/0003-user-defined-variety-rules.md)
- [実装計画書](docs/implementation-plan.md)
- [気象庁 過去の気象データ・ダウンロード](https://www.data.jma.go.jp/risk/obsdl/)
- [農林水産省 筆ポリゴン（2026年）](https://www.maff.go.jp/j/tokei/census/shuraku_data/2025/mb/index.html)
- [国土地理院 地理院タイル](https://maps.gsi.go.jp/development/index.html)
- 将来候補: [WAGRI 1kmメッシュ農業気象データ](https://wagri.naro.go.jp/wagri_api/1kmmesh_apiauthenticationkey/)

各データは提供元の利用条件と出典表示要件に従って利用します。
