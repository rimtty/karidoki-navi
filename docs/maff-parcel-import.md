# MAFF 2026 筆ポリゴン取込手順

対象は2026年の広島県データ、三原市（自治体コード`34204`）のうち久井町です。原本と生成GeoJSONはGitへ入れません。`scripts/maff-parcels.mjs`の既定出力先はOSの一時領域です。

## 公式データと検証結果

公式掲載ページは [筆ポリゴン（2026年）](https://www.maff.go.jp/j/tokei/census/shuraku_data/2025/mb/index.html) です。ページに記載された「34_広島県（FlatGeobuf:342.6MB）」の6分割をすべて取得します。

| 分割 | 公式URL |
|---|---|
| 1 | `https://www.maff.go.jp/j/tokei/census/shuraku_data/2025/mb/MB0001_2026_2025_34.zip.001` |
| 2 | `https://www.maff.go.jp/j/tokei/census/shuraku_data/2025/mb/MB0001_2026_2025_34.zip.002` |
| 3 | `https://www.maff.go.jp/j/tokei/census/shuraku_data/2025/mb/MB0001_2026_2025_34.zip.003` |
| 4 | `https://www.maff.go.jp/j/tokei/census/shuraku_data/2025/mb/MB0001_2026_2025_34.zip.004` |
| 5 | `https://www.maff.go.jp/j/tokei/census/shuraku_data/2025/mb/MB0001_2026_2025_34.zip.005` |
| 6 | `https://www.maff.go.jp/j/tokei/census/shuraku_data/2025/mb/MB0001_2026_2025_34.zip.006` |

久井町の地理キー確認には、同じく公式の [2025年農業集落境界データ](https://www.maff.go.jp/j/tokei/census/shuraku_data/2025/ma/index.html) を使います。広島県の `MA0001_2025_2025_34.zip` では旧久井村の`KCITY=24`、名称「久井村」、14集落が確認できます。2026年筆ポリゴンの`key`は10桁で、先頭5桁が自治体コード、6–7桁目が旧市区町村コードです。そのため`3420424`を久井町の公式農業集落キー接頭辞として使い、次の14キーを対象にします。

`3420424001`–`3420424014`（莇原上、莇原下、行広、吉田西側、寄金城、江木西側、中屋城、井々出、店條、鶴岬、高根沖、横田、大下、林崎谷）。これは現在の所有者や個人を表すIDではなく、MAFFが公開する農業集落コードです。

2026年9月3日に取得した実ファイルの検証結果は次のとおりです。ハッシュは取得物の再検証用で、監査JSONにも保存されます。

| 対象 | バイト数 | SHA-256 |
|---|---:|---|
| 分割1 | 30,408,704 | `23d9bbae8784afddbdb0a9f960850d8e4d4bfec1241931ca904ec9960f109fb5` |
| 分割2 | 30,408,704 | `95ad719db37e202dded14d289efcc8292b7f688435201bb7f046d86bea125c87` |
| 分割3 | 30,408,704 | `d107efa4a43bb69a2841e7891cf1a0ec53e77725ffc4754e89c8581ebb44e1cb` |
| 分割4 | 30,408,704 | `ac4c36d81487254bbf333f12bd41140cfe34cdeca2b5052ff005aa4f75fa65ae` |
| 分割5 | 30,408,704 | `db4decd3b67f303a28910828f3be892357013880717cf8ff87085ea94cfbc7f4` |
| 分割6 | 6,182,369 | `6a5360d7953212f94fa1c60d71b911d6d5e3bfbf6ea10de0c94491ee6640e118` |
| 結合ZIP | 158,225,889 | `9924867f1e381c75293da9235aa245983dd7ac676d355ab75e59d2033ed62159` |
| 展開FlatGeobuf | 359,285,912 | `3ed7957c03006de494c9d1d2395f41a9807cb7052430795dcea6298a821a4035` |

実ファイルは約343MiB、721,309フィーチャでした。実スキーマは次の6列です。

| 列 | 型（MAFF） | 用途 |
|---|---|---|
| `polygon_uuid` | 文字列 | 外部筆ID |
| `land_type` | 整数 | `100=田`, `200=畑` |
| `issue_year` | 整数 | 2026 |
| `point_lng` / `point_lat` | 数値 | 重心点（候補テーブルには保存しない） |
| `key` | 文字列 | 農業集落キー |

座標系はヘッダーで`EPSG:4612 (JGD2000)`、形状型は`MultiPolygon`でした。PostGISには`4326`として格納するため、取込時にSRIDを設定し、`ST_MakeValid`と`ST_CollectionExtract(..., 3)`を通します。

## 再現可能な取得・検査・抽出

GDAL/`ogrinfo`/`ogr2ogr`は不要です。FlatGeobufの読み取りは`package.json`に固定した`flatgeobuf@4.4.0`、ZIP展開は標準の`unzip`を使います。GDALがある環境でも、同じ監査マニフェストを残すため以下の手順を推奨します。

```bash
pnpm install --frozen-lockfile
pnpm maff:parcels download
# 出力例: /tmp/karidoki-maff-2026-34-XXXX
pnpm maff:parcels inspect --source-dir /tmp/karidoki-maff-2026-34-XXXX
pnpm maff:parcels extract --source-dir /tmp/karidoki-maff-2026-34-XXXX
```

`download`は6分割を個別に保存し、結合ZIP・展開FlatGeobuf・取得時刻・各URL・各SHA-256・サイズ・ヘッダー件数を`maff-import-audit.json`へ書きます。`inspect`はヘッダー件数と実走査件数、列順、CRSを照合します。

既定の`extract`は次の順でフィルタします。

1. `issue_year=2026`
2. `key`の先頭5桁が`34204`
3. `key`の先頭7桁が`3420424`（公式農業集落境界の旧久井村）
4. `land_type=100`（田）
5. 構造上の有効なPolygon/MultiPolygonだけを、MultiPolygonへ正規化

抽出結果は`generated/parcel-candidates-2026-34204-kui.ndjson`と監査JSONです。候補属性は`source_feature_id`、`source_year`、`municipality_code`、`settlement_code`、`land_type`、`geometry`だけで、`point_lng`/`point_lat`等の不要な原典列はコピーしません。集落キーを確認できない場合だけ、明示的に`--city-only`を指定して三原市全体へ安全側に戻せます。

今回の実データでは、三原市45,431件、久井キー2,477件、久井の田2,010件が得られ、構造不正は0件でした。抽出NDJSONは約1.49MiBです。`ST_IsValid`による位相検証と修復件数はDB取込時の監査値を正とします。

## DB取込（本番投入前に容量確認）

Migration `20260903030000_parcel_candidates.sql` は次を提供します。

- `source_imports`: URL、取得時刻、分割ファイル配列、ハッシュ、件数、無効/修復件数の監査台帳
- `parcel_candidates`: 所有者に依存しない参照候補。`source_import_id`、年度、原典筆ID、自治体/集落キー、地目、検証済みMultiPolygonのみ
- `normalize_parcel_candidate_geometry(jsonb)`: GeoJSON→4326、2D化、`ST_MakeValid`、MultiPolygon化、修復フラグ
- `get_parcel_candidates(...)`: 認証済みユーザー専用のbbox/limit RPC（bbox最大0.5度、面積最大0.1平方度、limit最大200）
- `get_parcel_candidates_mvt(...)`: 認証済みユーザー専用のWeb Mercator MVT RPC（z最大22、limit最大10,000）

Supabase Free等の容量が分からない状態では、原本や三原市全件をDBへ投入しません。まず次を確認します。

```bash
du -h /tmp/karidoki-maff-2026-34-XXXX/data/*.fgb
wc -l /tmp/karidoki-maff-2026-34-XXXX/generated/*.ndjson
```

`source_imports`へ監査JSONの値を登録し、NDJSONを一時表へ`\copy`してから、全行を正規化して投入します。以下はpsqlの骨子です。`<...>`は監査JSONから置き換え、サービスロール接続だけで実行してください。

```sql
begin;

insert into public.source_imports (
  provider, dataset_name, dataset_year, prefecture_code,
  source_page_url, settlement_boundary_source_url, downloaded_at,
  source_files, source_manifest_sha256, source_feature_count,
  municipality_feature_count, settlement_feature_count,
  candidate_feature_count, invalid_geometry_count, repaired_geometry_count,
  status, notes
) values (
  'MAFF', 'MB0001_2026_2025_34', 2026, '34',
  'https://www.maff.go.jp/j/tokei/census/shuraku_data/2025/mb/index.html',
  'https://www.maff.go.jp/j/tokei/census/shuraku_data/2025/ma/MA0001_2025_2025_34.zip',
  '<downloaded_at>'::timestamptz,
  '<audit.jsonのparts配列>'::jsonb,
  '<manifest_sha256>', <source_feature_count>,
  <municipality_feature_count>, <settlement_feature_count>,
  <candidate_feature_count>, <invalid_geometry_count>, 0, 'EXTRACTED',
  '2026 三原市34204 久井町; key prefix 3420424; land_type=100'
)
returning id \gset source_

create temporary table parcel_candidate_stage (payload jsonb not null);
\copy parcel_candidate_stage(payload) from '/tmp/.../parcel-candidates-2026-34204-kui.ndjson'

create temporary table parcel_candidate_normalized as
select
  stage.payload -> 'properties' as properties,
  normalized.geom,
  normalized.was_repaired
from parcel_candidate_stage as stage
cross join lateral public.normalize_parcel_candidate_geometry(
  stage.payload -> 'geometry'
) as normalized;

insert into public.parcel_candidates (
  source_import_id, source_year, source_feature_id,
  municipality_code, settlement_code, land_type,
  geom, geometry_was_repaired
)
select
  :'source_id'::uuid,
  (normalized.properties ->> 'source_year')::smallint,
  normalized.properties ->> 'source_feature_id',
  normalized.properties ->> 'municipality_code',
  normalized.properties ->> 'settlement_code',
  (normalized.properties ->> 'land_type')::smallint,
  normalized.geom,
  normalized.was_repaired
from parcel_candidate_normalized as normalized;

update public.source_imports as imports
set repaired_geometry_count = (
      select count(*) from parcel_candidate_normalized
      where was_repaired
    ),
    candidate_feature_count = (select count(*) from parcel_candidate_normalized),
    status = 'READY'
where imports.id = :'source_id'::uuid;

commit;
```

実際の`invalid_geometry_count`は、投入前にステージングした原形状へ`ST_IsValid`を掛けた値を`<invalid_geometry_count>`へ設定します。上のスクリプトは抽出器が構造不正を除外しているため、今回の実データでは0件です。位相不正が発見された場合は`normalize...`の`was_repaired`を`repaired_geometry_count`へ記録し、手作業で形状を差し替えません。

## 年度更新とロールバック

年度更新では既存年度を上書きしません。新年度の原本6分割を再取得し、新しい`source_imports`行と`parcel_candidates`行を作成し、RPC呼び出し側が`p_source_year`を明示します。登録済み圃場の`fields.geom`は候補からコピー済みのスナップショットなので、候補の入替で変わりません。

取込だけを戻す場合は、監査台帳IDを確認して候補を先に削除します。

```sql
begin;
delete from public.parcel_candidates where source_import_id = '<source_import_id>'::uuid;
delete from public.source_imports where id = '<source_import_id>'::uuid;
commit;
```

本番データを含む場合は、先に台帳と候補のバックアップを取り、対象年度以外を削除しないでください。Migration自体はforward-onlyです。ローカル検証DBだけを完全に戻す場合は`supabase db reset`を使います（既存のローカルデータは失われます）。

## 検証

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

小さな `tests/fixtures/maff/mini.geojson` と `tests/unit/maff-parcels.test.ts` で、キー/年度/地目フィルタ、属性ホワイトリスト、Polygon→MultiPolygon正規化、リング閉鎖、実ヘッダー契約を検証します。PostGISの権限、bbox上限、`ST_MakeValid`、GeoJSON RPC、MVTは`supabase/tests/parcel_candidates.sql`でローカルDBに対して検証します。
