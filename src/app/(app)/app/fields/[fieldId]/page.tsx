import { notFound } from "next/navigation";
import { FieldDetailView } from "@/features/fields/field-detail-view";
import { loadFieldDetailData } from "@/lib/fields/server";

type FieldDetailPageProps = {
  params: Promise<{ fieldId: string }>;
};

export async function generateMetadata({ params }: FieldDetailPageProps) {
  const { fieldId } = await params;
  const result = await loadFieldDetailData(fieldId, 2026);
  return { title: result.data ? result.data.name : "田んぼ詳細" };
}

export default async function FieldDetailPage({ params }: FieldDetailPageProps) {
  const { fieldId } = await params;
  const result = await loadFieldDetailData(fieldId, 2026);
  if (!result.error && !result.data) notFound();
  return (
    <FieldDetailView
      field={result.data}
      dataSource={result.source}
      dataError={result.error}
    />
  );
}
