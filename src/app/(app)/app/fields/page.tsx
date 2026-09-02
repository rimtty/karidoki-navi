import { FieldListView } from "@/features/fields/field-list-view";
import { loadFieldMapData } from "@/lib/fields/server";

export const metadata = {
  title: "田んぼ一覧",
};

export default async function FieldsPage() {
  const result = await loadFieldMapData(2026);
  return (
    <FieldListView
      initialFields={result.data ?? []}
      dataSource={result.source}
      dataError={result.error}
    />
  );
}
