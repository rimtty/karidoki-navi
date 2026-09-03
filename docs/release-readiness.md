# リリース準備監査

監査日: 2026-09-03
対象: `feat/mvp-vertical-slice`

この文書は、リポジトリ内で再現できる確認と、本番サービス側で別途承認が必要な確認を分けるための記録です。外部サービスの設定値、secret、個人情報は記載しません。

## リポジトリ内で確認する項目

次の確認は、対象コミットのチェックアウト後に実行できます。

| 項目 | 確認方法 | 判定 |
| --- | --- | --- |
| PWA資産とキャッシュ方針 | `node scripts/verify-pwa.mjs` | 合格（2026-09-03） |
| lint・型・単体テスト・ビルド | `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` | 合格（58テスト、2026-09-03） |
| フォーマット | package script・formatter設定を棚卸し | 未設定。CIの自動gateなし |
| 依存関係 | `pnpm audit --prod --audit-level high` | high以上0件（2026-09-03） |
| 追跡secret | CIのsecretパターン検査 | 該当なし（2026-09-03） |
| 公開DBスキーマ | `pnpm exec supabase db lint --local --schema public --level warning --fail-on error` | エラーなし（local/linked、2026-09-03） |
| DB/RLS/RPC | `supabase/tests/*.sql`をローカルDBへ順に実行 | 全6ファイル合格（2026-09-03） |
| ブラウザ | `pnpm e2e:local` | 3/3合格、ローカルSupabaseのみ（2026-09-03） |

CIは、アプリ品質確認に加えてローカルDBの公開スキーマlint、DB統合・セキュリティSQL、production依存監査、追跡secretパターン検査を実行します。DBテストはトランザクション内で実行し、本番DBへ接続しません。

`supabase db lint --local`をスキーマ指定なしで実行した場合、Supabase管理拡張の既知警告が含まれます。アプリの判定は公開スキーマを明示したコマンドの結果を正とします。

## 実装上の安全境界

- `NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` だけをブラウザへ渡します。
- HTTPのSupabase URLは非本番のローカル開発だけで許可し、本番設定はHTTPSに限定します。
- 本番でSupabase設定が欠けた場合、保護された画面をログインへ戻し、データ読込・登録・収穫登録はfixture成功にせず日本語エラーを返します。
- fixtureはSupabase設定のない非本番開発でのみ利用します。設定済み環境のRPC・認証・変換エラーはfixtureへ置き換えません。
- Security Advisorの`SECURITY DEFINER`警告は、固定`search_path`と認証済みの明示grantを持つowner-safe RPCに限定されます。`supabase/tests/security_hardening.sql`のallowlistと結果を併せて確認します。
- Vercelのプロジェクト設定、環境変数、Supabase AuthやFunctionのsecretはリポジトリへ置かず、管理画面またはsecret管理へ限定します。

2026-09-03のlinked Security Advisorは、上記の意図したRPC実行可否についてwarningのみを返し、errorはありませんでした。warningを無検証で無視せず、関数ごとのallowlist、固定`search_path`、認証済みgrantを同じリリース記録で確認します。

## 本番前の外部ゲート

以下はコードだけでは完了しないため、担当者・対象プロジェクト・承認記録を付けてリリース時に確認します。

管理側共有の2026-09-03 Preview smokeでは、`/`、`/login`、`/manifest.webmanifest`、`/sw.js`が200、未認証の`/app`が`/login?next=%2Fapp`への307でした。これはPreviewの疎通証跡であり、Productionの設定・認証・実機ゲートの完了を意味しません。

1. **未完了 — Vercel Production**: 対象commit、HTTPSドメイン、公開環境変数名、Production build、主要routeの実データまたは日本語エラーを確認する。追跡`vercel.json`はなく、プロジェクト設定は外部管理です。今回の管理側確認では、コードから参照されていない`SUPABASE_SECRET_KEY`がProduction/Preview環境に残存しています。値は表示・記録せず、所有者承認後の削除を推奨します（この監査では外部状態を変更しません）。
2. **一部完了 — Supabase本番**: 管理側で050000までのmigration適用とDBサイズ確認済みです。バックアップ、空き容量、最終Production接続確認はリリース責任者が別途記録し、テストから本番DBへ接続しません。
3. **完了 — 気象更新**: `update-weather` Edge Functionを再deployし、`verify_jwt=false`（Function側の専用Bearer検証）を確認済みです。世羅 `67316` の `2026-09-02` 単日bounded smokeは正時24点、平均 `26.47℃`、同条件再実行の冪等性まで確認済みです。Vault参照とCron 3本もactiveです。JMAの可用性は保証されないため、手動CSVの代替手順は維持します。
4. **未完了 — Google OAuth**: Google側client/redirect URIとSupabase provider、Site URL・callback allow-listを設定して専用アカウントで確認するまで受入完了にしません。
5. **未完了 — 本番SMTP**: 送信元・認証・レート制限と確認メール／パスワード再設定を確認するまで受入完了にしません。
6. **未完了 — 実機PWA**: iPhone Safari/PWAとAndroid Chrome/PWAで、インストール、主要登録、地図、通信断からの復帰、屋外視認性を実機確認します。PlaywrightのPixel 7相当エミュレーションは実機ゲートの代わりにしません。
7. **完了 — MAFF候補/API**: 2026年MAFF久井町の監査台帳2,010件、`ST_IsValid`/修復件数、SRID、MVTとbbox上限、取込rollback対象を確認済みです。bounded RPCの認証済み確認とanon拒否も完了しています。原本・NDJSONはGitへ追加しません。

現行のブラウザE2Eは手描き登録の縦通しを対象にしており、MAFF候補のタップ選択・MVT表示、Google OAuth、実機PWAはまだ自動受入していません。候補取込後の1地点確認と併せて、専用の受入シナリオを追加または手動記録してから完了扱いにします。

手順の順序、停止判断、候補だけのrollbackは [本番リリース運用手順](release-runbook.md) と [MAFF取込手順](maff-parcel-import.md) を正とします。
