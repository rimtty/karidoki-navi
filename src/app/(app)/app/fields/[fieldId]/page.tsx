import { notFound } from "next/navigation";
import { getFieldFixture } from "@/features/fields/fixtures";
import { FieldDetailView } from "@/features/fields/field-detail-view";

type FieldDetailPageProps = {
  params: Promise<{ fieldId: string }>;
};

export async function generateMetadata({ params }: FieldDetailPageProps) {
  const { fieldId } = await params;
  const field = getFieldFixture(fieldId);
  return { title: field ? field.name : "田んぼ詳細" };
}

export default async function FieldDetailPage({ params }: FieldDetailPageProps) {
  const { fieldId } = await params;
  const field = getFieldFixture(fieldId);
  if (!field) notFound();
  return <FieldDetailView field={field} />;
}
