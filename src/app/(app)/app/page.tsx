import { HomeMapView } from "@/features/fields/home-map-view";
import { loadFieldMapData } from "@/lib/fields/server";

export const metadata = {
  title: "今日の刈りどき",
};

export default async function AppHomePage() {
  const result = await loadFieldMapData(2026);
  return (
    <HomeMapView
      initialFields={result.data ?? []}
      dataSource={result.source}
      dataError={result.error}
    />
  );
}
