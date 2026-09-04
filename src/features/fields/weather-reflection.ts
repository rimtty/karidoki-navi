import { formatDate } from "./fixtures";
import type { FieldViewModel } from "./view-model";

export function weatherReflectionLabel(field: Pick<FieldViewModel, "status" | "observedThrough">): string {
  if (field.status === "before-heading") return "出穂後に計算を始めます";
  if (!field.observedThrough) return "まだ気温が反映されていません";
  return `${formatDate(field.observedThrough)}まで`;
}
