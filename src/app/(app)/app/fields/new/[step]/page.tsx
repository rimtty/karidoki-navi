import { notFound } from "next/navigation";
import { FieldRegistrationView } from "@/features/fields/field-registration-view";

type RegistrationPageProps = {
  params: Promise<{ step: string }>;
};

export async function generateMetadata({ params }: RegistrationPageProps) {
  const { step } = await params;
  const number = Number(step);
  return { title: number >= 1 && number <= 3 ? `田んぼ登録 ${number}/3` : "田んぼ登録" };
}

export default async function FieldRegistrationPage({ params }: RegistrationPageProps) {
  const { step } = await params;
  const initialStep = Number(step);
  if (!Number.isInteger(initialStep) || initialStep < 1 || initialStep > 3) notFound();
  return <FieldRegistrationView initialStep={initialStep} />;
}
