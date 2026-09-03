import { VarietyRulesView } from "@/features/variety-rules/variety-rules-view";
import { loadVarietyRuleSettings } from "@/lib/variety-rules/server";

export const metadata = { title: "刈りどきの目安" };

export default async function VarietyRulesPage() {
  const data = await loadVarietyRuleSettings();
  return <VarietyRulesView initialData={data} />;
}
