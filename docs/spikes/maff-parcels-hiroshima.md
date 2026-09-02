# 広島県筆ポリゴン取込スパイク

- 状態: 取込方式・実データ抽出を検証済み。DB投入は容量確認後
- 対象: 2026年データ・広島県・三原市久井町

## 公式データ

農林水産省は2026年の広島県筆ポリゴンをFlatGeobuf 6分割、合計342.6MB（結合ZIP 158,225,889 bytes、展開後FlatGeobuf 359,285,912 bytes）で公開している。公式ページの案内どおり、広島県内の全6分割を取得する。実ファイルはEPSG:4612 (JGD2000)、MultiPolygon、721,309フィーチャ、次の6列だった。

`polygon_uuid`, `land_type`（100=田、200=畑）, `issue_year`, `point_lng`, `point_lat`, `key`。`key`は10桁で、先頭5桁が自治体コード。個別ファイルのURL・取得時刻・SHA-256・件数は`maff-import-audit.json`に記録する。

## 取込方針

Supabase FreeのDB上限を考慮し、広島県全件を本番DBへ投入しない。

1. 6分割をローカル一時領域へ取得し、結合・展開する。
2. `flatgeobuf@4.4.0`で属性、座標系、件数、形状を検査する（GDAL/ogrinfoは必須ではない）。
3. `issue_year=2026`、自治体コード`34204`で三原市を抽出する。
4. 公式2025年農業集落境界の旧久井村（`KCITY=24`、14集落）に対応する筆キー接頭辞`3420424`で久井町を絞る。
5. `land_type=100`（田）を既定値として抽出し、必要時だけ`--land-type 200`または`all`を明示する。
6. GeoJSONを一時ステージへ出力し、PostGISの`ST_IsValid`/`ST_MakeValid`で最終検証・修復件数を監査する。
7. 抽出データだけを容量確認後に投入し、MVT/RPCではbbox・ズーム・limitで上限を設ける。

実データの抽出結果は、三原市45,431件、久井キー2,477件、久井の田2,010件、構造不正0件（抽出NDJSON約1.49MiB）だった。詳細なコマンド、監査ハッシュ、DB migration、rollbackは[docs/maff-parcel-import.md](../maff-parcel-import.md)にまとめている。

登録済み圃場は`fields.geom`へコピーするため、翌年度の候補データ入替で利用者の圃場形状を変更しない。

## リリース前確認

- FlatGeobufの実ファイル列・CRS・件数を`inspect`で再照合する。
- `3420424`は公式農業集落境界に基づく接頭辞。将来データでキー体系が変わり、久井町だけを属性で切り出せない場合は、三原市までに安全側で戻し、公式行政界との空間交差を別途検証する。
- 配信するMVTに個人情報や不要な原典属性を含めない。
- UIへの出典表示は別作業とし、本取込変更ではUI/Auth/Weather/PWAを変更しない。

## 公式資料

- 2026年筆ポリゴン: https://www.maff.go.jp/j/tokei/census/shuraku_data/2025/mb/index.html
- 筆ポリゴンの提供・利用: https://www.maff.go.jp/j/tokei/census/shuraku_data/2025/mb/index.html
- Supabase DBサイズ: https://supabase.com/docs/guides/platform/database-size
