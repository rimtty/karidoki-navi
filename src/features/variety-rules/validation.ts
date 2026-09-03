export const MIN_ACCUMULATED_TEMP_C = 100;
export const MAX_ACCUMULATED_TEMP_C = 3_000;
export const MAX_SOURCE_NOTE_LENGTH = 2_000;

export type VarietyRuleFormInput = {
  startTempC: string;
  endTempC: string;
  sourceNote: string;
};

export type VarietyRuleFormValues = {
  startTempC: number;
  targetTempC: number;
  endTempC: number;
  accumulationOffsetDays: 0;
  sourceNote: string;
};

export type VarietyRuleFormField = keyof VarietyRuleFormInput | "form";
export type VarietyRuleFormErrors = Partial<Record<VarietyRuleFormField, string>>;

export type VarietyRuleValidationResult =
  | { ok: true; value: VarietyRuleFormValues }
  | { ok: false; errors: VarietyRuleFormErrors };

function setFieldError(
  errors: VarietyRuleFormErrors,
  field: VarietyRuleFormField,
  message: string,
): void {
  if (!errors[field]) errors[field] = message;
}

function requiredWholeNumber(
  value: unknown,
  label: string,
  field: VarietyRuleFormField,
  errors: VarietyRuleFormErrors,
): number | null {
  if (typeof value !== "string" || value.trim() === "") {
    setFieldError(errors, field, `${label}を入力してください。`);
    return null;
  }

  const parsed = Number(value);
  if (
    !Number.isInteger(parsed) ||
    parsed < MIN_ACCUMULATED_TEMP_C ||
    parsed > MAX_ACCUMULATED_TEMP_C
  ) {
    setFieldError(
      errors,
      field,
      `${label}は${MIN_ACCUMULATED_TEMP_C.toLocaleString("ja-JP")}〜${MAX_ACCUMULATED_TEMP_C.toLocaleString("ja-JP")}の整数で入力してください。`,
    );
    return null;
  }
  return parsed;
}

export function validateVarietyRuleForm(
  input: VarietyRuleFormInput,
): VarietyRuleValidationResult {
  if (!input || typeof input !== "object") {
    return { ok: false, errors: { form: "入力内容を確認してください。" } };
  }

  const errors: VarietyRuleFormErrors = {};
  const start = requiredWholeNumber(
    input.startTempC,
    "刈り始めの積算気温",
    "startTempC",
    errors,
  );
  const end = requiredWholeNumber(
    input.endTempC,
    "刈り終わりの積算気温",
    "endTempC",
    errors,
  );

  if (start !== null && end !== null && start >= end) {
    setFieldError(
      errors,
      "endTempC",
      "刈り終わりは、刈り始めより大きい数字にしてください。",
    );
  }

  const sourceNote = typeof input.sourceNote === "string" ? input.sourceNote.trim() : "";
  if (sourceNote.length === 0) {
    setFieldError(errors, "sourceNote", "この目安の出どころを入力してください。");
  } else if (sourceNote.length > MAX_SOURCE_NOTE_LENGTH) {
    setFieldError(
      errors,
      "sourceNote",
      `出どころは${MAX_SOURCE_NOTE_LENGTH.toLocaleString("ja-JP")}文字以内で入力してください。`,
    );
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      startTempC: start!,
      targetTempC: (start! + end!) / 2,
      endTempC: end!,
      accumulationOffsetDays: 0,
      sourceNote,
    },
  };
}

export function emptyVarietyRuleForm(): VarietyRuleFormInput {
  return {
    startTempC: "",
    endTempC: "",
    sourceNote: "",
  };
}
