import { compareLocalDates, isLocalDate } from "../../domain";

export const MAX_ACCUMULATED_TEMP_C = 10_000;
export const MAX_SOURCE_NOTE_LENGTH = 2_000;

export type VarietyRuleFormInput = {
  startTempC: string;
  targetTempC: string;
  endTempC: string;
  accumulationOffsetDays: string;
  sourceNote: string;
  regionId: string;
  effectiveFrom: string;
  effectiveTo: string;
};

export type VarietyRuleFormValues = {
  startTempC: number;
  targetTempC: number;
  endTempC: number;
  accumulationOffsetDays: number;
  sourceNote: string;
  regionId: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type VarietyRuleFormField = keyof VarietyRuleFormInput | "form";
export type VarietyRuleFormErrors = Partial<Record<VarietyRuleFormField, string>>;

export type VarietyRuleValidationResult =
  | { ok: true; value: VarietyRuleFormValues }
  | { ok: false; errors: VarietyRuleFormErrors };

function requiredNumber(
  value: unknown,
  label: string,
  field: VarietyRuleFormField,
  errors: VarietyRuleFormErrors,
): number | null {
  if (typeof value !== "string" || value.trim() === "") {
    if (typeof value !== "string") {
      setFieldError(errors, field, `${label}は数値で入力してください。`);
      return null;
    }
    setFieldError(errors, field, `${label}を入力してください。`);
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    setFieldError(errors, field, `${label}は数値で入力してください。`);
    return null;
  }
  return parsed;
}

function setFieldError(
  errors: VarietyRuleFormErrors,
  field: VarietyRuleFormField,
  message: string,
): void {
  if (!errors[field]) errors[field] = message;
}

export function validateVarietyRuleForm(
  input: VarietyRuleFormInput,
): VarietyRuleValidationResult {
  if (!input || typeof input !== "object") {
    return { ok: false, errors: { form: "入力内容を確認してください。" } };
  }
  const errors: VarietyRuleFormErrors = {};
  const start = requiredNumber(input.startTempC, "開始温度", "startTempC", errors);
  const target = requiredNumber(input.targetTempC, "中心温度", "targetTempC", errors);
  const end = requiredNumber(input.endTempC, "終了温度", "endTempC", errors);

  for (const [field, value, label] of [
    ["startTempC", start, "開始温度"],
    ["targetTempC", target, "中心温度"],
    ["endTempC", end, "終了温度"],
  ] as const) {
    if (value === null) continue;
    if (value <= 0) {
      setFieldError(errors, field, `${label}は0より大きくしてください。`);
    } else if (value > MAX_ACCUMULATED_TEMP_C) {
      setFieldError(
        errors,
        field,
        `${label}は${MAX_ACCUMULATED_TEMP_C.toLocaleString("ja-JP")}℃・日以下で入力してください。`,
      );
    }
  }

  if (start !== null && target !== null && start > target) {
    setFieldError(errors, "targetTempC", "開始温度以上の値にしてください。");
  }
  if (target !== null && end !== null && target > end) {
    setFieldError(errors, "endTempC", "中心温度以上の値にしてください。");
  }

  const offset = requiredNumber(
    input.accumulationOffsetDays,
    "積算開始日",
    "accumulationOffsetDays",
    errors,
  );
  if (offset !== null && (!Number.isInteger(offset) || offset < 0 || offset > 7)) {
    setFieldError(errors, "accumulationOffsetDays", "0〜7日の整数で入力してください。");
  }

  const sourceNote = typeof input.sourceNote === "string" ? input.sourceNote.trim() : "";
  if (sourceNote.length === 0) {
    setFieldError(errors, "sourceNote", "根拠メモを入力してください。");
  } else if (sourceNote.length > MAX_SOURCE_NOTE_LENGTH) {
    setFieldError(
      errors,
      "sourceNote",
      `根拠メモは${MAX_SOURCE_NOTE_LENGTH.toLocaleString("ja-JP")}文字以内で入力してください。`,
    );
  }

  const effectiveFrom = typeof input.effectiveFrom === "string" ? input.effectiveFrom.trim() : "";
  if (!isLocalDate(effectiveFrom)) {
    setFieldError(errors, "effectiveFrom", "適用開始日は正しい日付を入力してください。");
  }

  const effectiveTo = typeof input.effectiveTo === "string" ? input.effectiveTo.trim() : "";
  if (effectiveTo !== "" && !isLocalDate(effectiveTo)) {
    setFieldError(errors, "effectiveTo", "適用終了日は正しい日付を入力してください。");
  }
  if (
    isLocalDate(effectiveFrom) &&
    effectiveTo !== "" &&
    isLocalDate(effectiveTo) &&
    compareLocalDates(effectiveTo, effectiveFrom) < 0
  ) {
    setFieldError(errors, "effectiveTo", "適用終了日は開始日以降にしてください。");
  }

  const regionId = typeof input.regionId === "string" ? input.regionId.trim() : "";
  if (regionId.length > 200) {
    setFieldError(errors, "regionId", "適用地域の指定が不正です。");
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      startTempC: start!,
      targetTempC: target!,
      endTempC: end!,
      accumulationOffsetDays: offset!,
      sourceNote,
      regionId: regionId || null,
      effectiveFrom,
      effectiveTo: effectiveTo || null,
    },
  };
}

export function emptyVarietyRuleForm(today = "2026-01-01"): VarietyRuleFormInput {
  return {
    startTempC: "",
    targetTempC: "",
    endTempC: "",
    accumulationOffsetDays: "1",
    sourceNote: "",
    regionId: "",
    effectiveFrom: today,
    effectiveTo: "",
  };
}
