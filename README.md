# 🌾 刈りどきナビ

田んぼごとの出穂後積算気温を自動計算し、次に刈る田んぼを地図で素早く判断するためのWeb/PWAです。

## MVPのゴール

> 出穂日を登録したら、あとは自動積算され、地図を見れば次に刈る田んぼが3秒で分かる。

MVPでは次の機能に集中します。

- MapLibre GL JSと国土地理院タイルによる田んぼ地図
- 農林水産省の筆ポリゴンを使った区画登録
- 品種、出穂日、品種×地域ルールの登録
- 気象庁AMeDAS等の日平均気温の取得と積算
- 刈取適期、接近、超過などの地図上での色分け
- 収穫日と収穫時積算気温の記録
- スマートフォンのホーム画面から利用できるPWA

AI、収量予測、病害予測、衛星画像、NDVI、水管理、農薬・肥料管理は初期スコープ外です。

## ドキュメント

- [実装計画書](docs/implementation-plan.md)

## ステータス

MVPの実装基盤を準備中です。最初に気象庁データ取得と筆ポリゴン配信の技術検証を行い、その結果を確定仕様へ反映します。

## ローカル開発

前提として、Node.jsとpnpmを使用します。

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

ブラウザで`http://localhost:3000`を開きます。実際の認証情報や秘密鍵をGitへコミットしないでください。

Supabaseを含むローカル環境にはDockerが必要です。

```bash
pnpm exec supabase start
pnpm exec supabase db reset
```

DB変更は`supabase/migrations/`へ追加し、Dashboard上で本番テーブルを直接変更しません。

## 想定データソース

- [気象庁 過去の気象データ・ダウンロード](https://www.data.jma.go.jp/risk/obsdl/)
- [農林水産省 筆ポリゴン](https://www.maff.go.jp/j/tokei/census/shuraku_data/2025/mb/index.html)
- [国土地理院 地理院タイル](https://maps.gsi.go.jp/development/index.html)
- 将来候補: [WAGRI 1kmメッシュ農業気象データ](https://wagri.naro.go.jp/wagri_api/1kmmesh_apiauthenticationkey/)

各データは提供元の利用条件と出典表示要件に従って利用します。
