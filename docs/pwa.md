# PWA・オフライン方針

刈りどきナビは、圃場の個人データをブラウザの `Cache Storage` に残さず、公開シェルと地図表示に必要な範囲だけをオフライン対応する。

## Manifest とアイコン

- `src/app/manifest.ts` が `/manifest.webmanifest` を生成する。
- `name` / `short_name` は「刈りどきナビ」、表示は `standalone`、起動URLとscopeは `/`。
- `theme_color` は `#315c2b`、`background_color` は `#f6f5eb`。
- 通常アイコンは `public/icons/icon-192.png` と `public/icons/icon-512.png`。
- Androidのマスク表示用に `purpose: maskable` の192px・512pxも用意する。
- iPhone Safariのホーム画面用に192pxアイコンを `apple-touch-icon` としても指定する。
- ルートlayoutのviewportは `width=device-width`、`initialScale=1`、`viewportFit=cover`。

アイコンと方針の静的検証は次で実行できる。

```bash
node scripts/verify-pwa.mjs
```

## Service Worker とキャッシュ

Service Workerは依存パッケージを使わず `public/sw.js` に置く。クライアント登録は `src/components/pwa-status.tsx` が担当する。

| 対象 | 方針 |
| --- | --- |
| 公開シェル | `/`、`/offline.html`、manifest、アイコンをインストール時に保存 |
| Next静的資産 | `/_next/static/` をcache-firstで保存。ハッシュ付き資産のみ |
| 地理院タイル | `https://cyberjapandata.gsi.go.jp/xyz/.../*.png` をstale-while-revalidate。最大120件 |
| 画面遷移HTML | 成功レスポンスを保存しない。通信失敗時は `offline.html` |
| `/app`、`/login`、`/auth`、`/api` | キャッシュ対象外。認証・個人情報を保存しない |
| Supabase | SupabaseホストとAuth/REST/Storage/Functionsのパスを対象外 |
| POST/PUT/PATCH/DELETE | Service Workerのキャッシュ処理に入らない |

地理院タイルは既存タイルをすぐ返し、裏で再取得する。新規タイルが通信失敗した場合はエラーを返し、画面側の地図エラー表示に任せる。キャッシュはバージョン更新時に古い `karidoki-*` を削除する。

## 接続状態と更新

画面上部に控えめな日本語ステータスを表示する。

- オンライン: `オンライン`
- オフライン: `オフライン：保存済みの画面を表示中`
- 新しいService Workerが待機中: `更新があります` ボタンを表示し、タップで安全に切り替える

通信状態の表示は操作の代替ではない。オフライン中の登録・更新処理をキューイングしたり、Cache Storageへ保存したりはしない。

## 実機受入チェックリスト

### iPhone Safari

- [ ] HTTPS（または `localhost`）で本番ビルドを開き、Safariの共有メニューから「ホーム画面に追加」できる。
- [ ] ホーム画面から起動した画面がSafariのタブ表示ではなくstandalone表示になり、ノッチ・ホームインジケータに内容が隠れない。
- [ ] ホーム画面のアイコンが欠けず、刈りどきナビの配色で表示される。
- [ ] オンライン時に `オンライン`、機内モードまたは通信遮断時に `オフライン：保存済みの画面を表示中` が表示される。
- [ ] 通信遮断後にトップページを再表示すると日本語のオフライン案内が表示される。
- [ ] 通信復旧後の再読み込みで通常画面へ戻り、ログイン情報や圃場データがオフライン画面に露出しない。
- [ ] Safari Web InspectorのApplication/Storageで、`/app`・`/login`・`/auth`のHTMLやSupabaseレスポンスがCache Storageにないことを確認する。

### Android Chrome

- [ ] HTTPSでmanifestが読み込まれ、Chromeのインストール（または「ホーム画面に追加」）を実行できる。
- [ ] インストール後の起動がstandalone表示で、512px通常アイコンとmaskableアイコンが正しく選択される。
- [ ] DevToolsのApplication > Service Workersで `public/sw.js` がactivatedになり、更新版が待機したとき `更新があります` が表示される。
- [ ] 機内モードで既に表示した公開画面を再表示するとオフライン案内が出る。新しい圃場の登録・更新は成功扱いにならない。
- [ ] 地図をオンラインで移動してタイルを取得し、オフラインで同じ範囲を表示すると直近タイルが残る。
- [ ] DevToolsでGSIタイルのCache Storageが120件を超えず、Supabase/APIのレスポンスが保存されないことを確認する。
- [ ] 新版デプロイ後に再訪すると更新通知からリロードでき、古い静的資産が残らない。

## Lighthouse / PWA確認

本番相当のサーバーを起動して `http://localhost:3000` を Lighthouse（モバイル、PWA）で測定する。`localhost` はService Workerのsecure contextとして扱われる。

```bash
pnpm install --frozen-lockfile
node scripts/verify-pwa.mjs
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

最低限、次を確認する。

- documentに `meta[name="viewport"]` があり、device widthである。
- manifestが200で取得でき、name、start_url、standalone、theme/background colorが正しい。
- 192pxと512pxの通常アイコン、maskableアイコンがmanifestから200で取得できる。
- Service Workerが登録され、オフライン遷移時にfallbackが返る。
- 地理院タイルの出典表示が画面に残る。

Lighthouseの「インストール可能」はHTTPS、実際の配信ヘッダ、ブラウザの既存Service Worker状態にも左右される。測定前に対象originの古いService Workerとサイトデータを削除し、`pnpm build` 後の `pnpm start` で再確認する。
