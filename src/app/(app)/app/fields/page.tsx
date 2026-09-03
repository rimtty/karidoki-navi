import { redirect } from "next/navigation";

export const metadata = {
  title: "田んぼ一覧",
};

export default async function FieldsPage() {
  redirect("/app");
}
