# モバイル E2E

Playwright の `mobile-chrome` プロジェクトで、ローカル Supabase にだけ
接続して認証・圃場登録・収穫登録・ログアウトを検証します。さらにローカル
メール受信箱へ届く再設定メールを開き、PKCE callback、新しいパスワードの登録、
再ログインまでを確認します。テスト開始時に
管理 API でランダムな専用ユーザーを作成し、終了時に削除します。サービスキー
やパスワードはファイルへコミットせず、テスト結果ディレクトリにも残しません。

```sh
pnpm exec supabase start
pnpm e2e:local
```

`e2e:local` は `supabase status --output env` の結果をプロセス内だけで読み取り、
`NEXT_PUBLIC_SUPABASE_URL`・公開キー・サービスキー・ローカルメール受信箱URLを
設定して Playwright を起動します。
すでにローカル URL とキーを環境変数で指定している場合はそれを優先します。

既存の Next 開発サーバーを再利用する場合は、そのサーバーを同じ
`NEXT_PUBLIC_SUPABASE_URL`・`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` で起動したうえで、
`E2E_REUSE_SERVER=1 pnpm e2e:local` を使ってください。通常は E2E が専用ポートで起動します。

CI では通常の quality job と分離した E2E job でローカル Supabase を起動し、
ブラウザ依存関係をインストールしてから同じ `pnpm e2e:local` を実行します。
