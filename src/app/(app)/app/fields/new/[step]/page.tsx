import { notFound } from "next/navigation";
import { FieldRegistrationView } from "@/features/fields/field-registration-view";
import { loadRiceVarieties } from "@/lib/fields/server";

type RegistrationPageProps = {
  params: Promise<{ step: string }>;
};

export const metadata = { title: "田んぼ登録" };

export default async function FieldRegistrationPage({ params }: RegistrationPageProps) {
  const { step } = await params;
  const initialStep = Number(step);
  if (!Number.isInteger(initialStep) || initialStep < 1 || initialStep > 3) notFound();
  const varieties = await loadRiceVarieties();
  return (
    <FieldRegistrationView
      initialStep={initialStep}
      varieties={varieties.data ?? []}
      dataSource={varieties.source}
      dataError={varieties.error}
    />
  );
}
