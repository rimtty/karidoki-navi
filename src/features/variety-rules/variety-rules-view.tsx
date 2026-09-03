"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { DataLoadError } from "@/components/data-load-error";
import { FixtureNotice } from "@/components/quality-notice";
import { saveVarietyRuleAction, deleteVarietyRuleAction } from "@/lib/variety-rules/actions";
import {
  emptyVarietyRuleForm,
  validateVarietyRuleForm,
  type VarietyRuleFormErrors,
  type VarietyRuleFormField,
  type VarietyRuleFormInput,
} from "./validation";
import type {
  AccountVarietyRule,
  VarietyRuleCard,
  VarietyRuleRegion,
  VarietyRuleSettingsData,
} from "./types";
import styles from "./variety-rules-view.module.css";

type EditingRule = {
  cardId: string;
  ruleId: string | null;
  form: VarietyRuleFormInput;
};

function formFromRule(rule: AccountVarietyRule): VarietyRuleFormInput {
  return {
    startTempC: String(rule.harvestStartTempC),
    targetTempC: String(rule.harvestTargetTempC),
    endTempC: String(rule.harvestEndTempC),
    accumulationOffsetDays: String(rule.accumulationStartOffsetDays),
    sourceNote: rule.sourceNote,
    regionId: rule.regionId ?? "",
    effectiveFrom: rule.effectiveFrom,
    effectiveTo: rule.effectiveTo ?? "",
  };
}

function newForm(regions: VarietyRuleRegion[]): VarietyRuleFormInput {
  const form = emptyVarietyRuleForm();
  // Kui is the pilot's initial region.  The empty option remains available for
  // an account-wide rule, and is shown explicitly in the selector.
  return { ...form, regionId: regions[0]?.id ?? "" };
}

function formatNumber(value: number): string {
  return value.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
}

function regionLabel(rule: AccountVarietyRule, regions: VarietyRuleRegion[]): string {
  if (!rule.regionId) return "未指定（アカウント共通）";
  return regions.find((region) => region.id === rule.regionId)?.name ?? "指定地域";
}

function effectiveLabel(rule: AccountVarietyRule): string {
  return `${rule.effectiveFrom}〜${rule.effectiveTo ?? "期限なし"}`;
}

function fieldErrorId(cardId: string, field: VarietyRuleFormField): string {
  return `variety-rule-${cardId}-${field}-error`;
}

function RuleForm({
  card,
  regions,
  editing,
  errors,
  pending,
  onChange,
  onCancel,
  onSubmit,
}: {
  card: VarietyRuleCard;
  regions: VarietyRuleRegion[];
  editing: EditingRule;
  errors: VarietyRuleFormErrors;
  pending: boolean;
  onChange: (field: keyof VarietyRuleFormInput, value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const input = (field: keyof VarietyRuleFormInput) => editing.form[field];
  const describedBy = (field: VarietyRuleFormField) =>
    errors[field] ? fieldErrorId(card.id, field) : undefined;

  return (
    <div className={styles.form} aria-label={`${card.name}の品種ルール入力`}>
      <div className={styles.formHeading}>
        <h3>{editing.ruleId ? "ルールを編集" : "ルールを追加"}</h3>
        <span>単位：℃・日</span>
      </div>
      <div className={styles.formGrid}>
        <div className={styles.field}>
          <label htmlFor={`${card.id}-start`}>適期開始 <em className={styles.required}>必須</em></label>
          <input
            id={`${card.id}-start`}
            type="number"
            min="0.01"
            max="10000"
            step="0.01"
            inputMode="decimal"
            value={input("startTempC")}
            onChange={(event) => onChange("startTempC", event.target.value)}
            aria-invalid={Boolean(errors.startTempC)}
            aria-describedby={describedBy("startTempC")}
          />
          {errors.startTempC && <span className={styles.error} id={fieldErrorId(card.id, "startTempC")}>{errors.startTempC}</span>}
        </div>
        <div className={styles.field}>
          <label htmlFor={`${card.id}-target`}>適期中心 <em className={styles.required}>必須</em></label>
          <input
            id={`${card.id}-target`}
            type="number"
            min="0.01"
            max="10000"
            step="0.01"
            inputMode="decimal"
            value={input("targetTempC")}
            onChange={(event) => onChange("targetTempC", event.target.value)}
            aria-invalid={Boolean(errors.targetTempC)}
            aria-describedby={describedBy("targetTempC")}
          />
          {errors.targetTempC && <span className={styles.error} id={fieldErrorId(card.id, "targetTempC")}>{errors.targetTempC}</span>}
        </div>
        <div className={styles.field}>
          <label htmlFor={`${card.id}-end`}>適期終了 <em className={styles.required}>必須</em></label>
          <input
            id={`${card.id}-end`}
            type="number"
            min="0.01"
            max="10000"
            step="0.01"
            inputMode="decimal"
            value={input("endTempC")}
            onChange={(event) => onChange("endTempC", event.target.value)}
            aria-invalid={Boolean(errors.endTempC)}
            aria-describedby={describedBy("endTempC")}
          />
          {errors.endTempC && <span className={styles.error} id={fieldErrorId(card.id, "endTempC")}>{errors.endTempC}</span>}
        </div>
        <div className={styles.field}>
          <label htmlFor={`${card.id}-offset`}>積算開始 offset <em className={styles.required}>必須</em></label>
          <input
            id={`${card.id}-offset`}
            type="number"
            min="0"
            max="7"
            step="1"
            inputMode="numeric"
            value={input("accumulationOffsetDays")}
            onChange={(event) => onChange("accumulationOffsetDays", event.target.value)}
            aria-invalid={Boolean(errors.accumulationOffsetDays)}
            aria-describedby={describedBy("accumulationOffsetDays")}
          />
          <span className={styles.fieldHint}>出穂日からの開始日数（0〜7日）</span>
          {errors.accumulationOffsetDays && <span className={styles.error} id={fieldErrorId(card.id, "accumulationOffsetDays")}>{errors.accumulationOffsetDays}</span>}
        </div>
        <div className={styles.field}>
          <label htmlFor={`${card.id}-region`}>適用地域 <em className={styles.required}>必須</em></label>
          <select
            id={`${card.id}-region`}
            value={input("regionId")}
            onChange={(event) => onChange("regionId", event.target.value)}
            aria-invalid={Boolean(errors.regionId)}
            aria-describedby={describedBy("regionId")}
          >
            <option value="">未指定（アカウント共通）</option>
            {regions.map((region) => (
              <option value={region.id} key={region.id}>{region.name}</option>
            ))}
          </select>
          {errors.regionId && <span className={styles.error} id={fieldErrorId(card.id, "regionId")}>{errors.regionId}</span>}
        </div>
        <div className={styles.field}>
          <label htmlFor={`${card.id}-from`}>適用開始日 <em className={styles.required}>必須</em></label>
          <input
            id={`${card.id}-from`}
            type="date"
            value={input("effectiveFrom")}
            onChange={(event) => onChange("effectiveFrom", event.target.value)}
            aria-invalid={Boolean(errors.effectiveFrom)}
            aria-describedby={describedBy("effectiveFrom")}
          />
          {errors.effectiveFrom && <span className={styles.error} id={fieldErrorId(card.id, "effectiveFrom")}>{errors.effectiveFrom}</span>}
        </div>
        <div className={styles.field}>
          <label htmlFor={`${card.id}-to`}>適用終了日 <small>任意</small></label>
          <input
            id={`${card.id}-to`}
            type="date"
            value={input("effectiveTo")}
            onChange={(event) => onChange("effectiveTo", event.target.value)}
            aria-invalid={Boolean(errors.effectiveTo)}
            aria-describedby={describedBy("effectiveTo")}
          />
          {errors.effectiveTo && <span className={styles.error} id={fieldErrorId(card.id, "effectiveTo")}>{errors.effectiveTo}</span>}
        </div>
        <div className={styles.wideField}>
          <label htmlFor={`${card.id}-note`}>根拠メモ <em className={styles.required}>必須</em></label>
          <textarea
            id={`${card.id}-note`}
            maxLength={2000}
            value={input("sourceNote")}
            onChange={(event) => onChange("sourceNote", event.target.value)}
            placeholder="例：営農会議で決定した久井町向けの運用値。決定日・確認者など"
            aria-invalid={Boolean(errors.sourceNote)}
            aria-describedby={describedBy("sourceNote")}
          />
          <span className={styles.fieldHint}>公式資料でない場合も、決定の経緯や確認者を記録してください。</span>
          {errors.sourceNote && <span className={styles.error} id={fieldErrorId(card.id, "sourceNote")}>{errors.sourceNote}</span>}
        </div>
      </div>
      {errors.form && <p className={styles.formError} role="alert">{errors.form}</p>}
      <div className={styles.formActions}>
        <button className={styles.cancelButton} type="button" onClick={onCancel} disabled={pending}>キャンセル</button>
        <button className={styles.saveButton} type="button" onClick={onSubmit} disabled={pending}>
          {pending ? "保存中…" : "このルールを保存"}
        </button>
      </div>
    </div>
  );
}

export function VarietyRulesView({ initialData }: { initialData: VarietyRuleSettingsData }) {
  const router = useRouter();
  const [cards, setCards] = useState(initialData.cards);
  const [editing, setEditing] = useState<EditingRule | null>(null);
  const [errors, setErrors] = useState<VarietyRuleFormErrors>({});
  const [pending, setPending] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState(false);

  function beginCreate(card: VarietyRuleCard) {
    setEditing({ cardId: card.id, ruleId: null, form: newForm(initialData.regions) });
    setErrors({});
    setFeedback(null);
  }

  function beginEdit(card: VarietyRuleCard, rule: AccountVarietyRule) {
    setEditing({ cardId: card.id, ruleId: rule.id, form: formFromRule(rule) });
    setErrors({});
    setFeedback(null);
  }

  function cancelEdit() {
    setEditing(null);
    setErrors({});
  }

  function changeField(field: keyof VarietyRuleFormInput, value: string) {
    setEditing((current) => current ? { ...current, form: { ...current.form, [field]: value } } : current);
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
  }

  async function submitRule() {
    if (!editing || pending || initialData.source === "fixture") return;
    const validation = validateVarietyRuleForm(editing.form);
    if (!validation.ok) {
      setErrors(validation.errors);
      setFeedback(null);
      return;
    }
    const card = cards.find((candidate) => candidate.id === editing.cardId);
    if (!card) return;

    setPending(true);
    setFeedback(null);
    setFeedbackError(false);
    try {
      const result = await saveVarietyRuleAction({
        varietyId: card.id,
        ruleId: editing.ruleId,
        form: editing.form,
      });
      if (!result.ok) {
        setFeedback(result.message);
        setFeedbackError(true);
        return;
      }
      setCards((current) => current.map((candidate) => {
        if (candidate.id !== card.id) return candidate;
        const customRules = editing.ruleId
          ? candidate.customRules.map((rule) => rule.id === result.rule.id ? result.rule : rule)
          : [result.rule, ...candidate.customRules];
        return { ...candidate, customRules };
      }));
      setEditing(null);
      setErrors({});
      setFeedback("品種ルールを保存しました。次回の作付け登録から適用されます。");
      router.refresh();
    } catch {
      setFeedback("品種ルールを保存できませんでした。通信状態を確認して再試行してください。");
      setFeedbackError(true);
    } finally {
      setPending(false);
    }
  }

  async function removeRule(rule: AccountVarietyRule) {
    if (pending || initialData.source === "fixture") return;
    if (!window.confirm("この品種ルールを削除しますか？既に登録済みの作付けの判定記録は変わりません。")) return;

    setPendingDelete(rule.id);
    setFeedback(null);
    setFeedbackError(false);
    try {
      const result = await deleteVarietyRuleAction({ ruleId: rule.id });
      if (!result.ok) {
        setFeedback(result.message);
        setFeedbackError(true);
        return;
      }
      setCards((current) => current.map((card) => ({
        ...card,
        customRules: card.customRules.filter((candidate) => candidate.id !== rule.id),
      })));
      if (editing?.ruleId === rule.id) setEditing(null);
      setFeedback("品種ルールを削除しました。既存の作付け記録は保持されます。");
      router.refresh();
    } catch {
      setFeedback("品種ルールを削除できませんでした。通信状態を確認して再試行してください。");
      setFeedbackError(true);
    } finally {
      setPendingDelete(null);
    }
  }

  return (
    <div className={styles.screen}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>刈りどきの設定</p>
          <h1>品種ごとの基準</h1>
          <p className={styles.pageLead}>
            広島県三原市久井町で使う、出穂後積算日平均気温の適期を登録します。公式ルールが確認できない品種は未設定のままです。
          </p>
        </div>
        <Link className={styles.backLink} href="/app">田んぼ一覧へ戻る</Link>
      </header>

      {initialData.error && <DataLoadError message={initialData.error} />}
      {initialData.source === "fixture" && <FixtureNotice compact />}
      <div className={styles.notice} role="note">
        <span className={styles.noticeIcon} aria-hidden="true">i</span>
        <div>
          <strong>公式値と利用者設定を分けて記録します</strong>
          <p>現在、初期5品種の公式閾値は未確認です。登録した値には根拠メモが付き、作付け登録時点のスナップショットとして保存されます。</p>
        </div>
      </div>

      {feedback && <p className={`${styles.feedback} ${feedbackError ? styles.feedbackError : ""}`} role={feedbackError ? "alert" : "status"}>{feedback}</p>}

      <div className={styles.cards}>
        {cards.map((card) => {
          const isEditing = editing?.cardId === card.id;
          return (
            <section className={styles.card} key={card.id} aria-labelledby={`variety-${card.id}`}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitle}>
                  <h2 id={`variety-${card.id}`}>{card.name}</h2>
                  {card.nameKana && <span className={styles.kana}>{card.nameKana}</span>}
                </div>
                <span className={styles.officialBadge}>公式ルール未設定</span>
              </div>

              <div className={styles.ruleList}>
                {card.customRules.length === 0 && (
                  <div className={styles.emptyRule}>
                    <span>利用者設定はありません。未設定のまま作付け登録できます。</span>
                    <button className={styles.addButton} type="button" onClick={() => beginCreate(card)} disabled={initialData.source === "fixture"}>＋ この品種のルールを追加</button>
                  </div>
                )}
                {card.customRules.map((rule) => (
                  <div className={styles.ruleRow} key={rule.id}>
                    <div className={styles.ruleSummary}>
                      <div className={styles.ruleMeta}>
                        <span className={styles.customBadge}>利用者設定</span>
                        <span>{regionLabel(rule, initialData.regions)}</span>
                        <span>{effectiveLabel(rule)}</span>
                      </div>
                      <p className={styles.ruleTemps}>
                        開始 {formatNumber(rule.harvestStartTempC)} ／ 中心 {formatNumber(rule.harvestTargetTempC)} ／ 終了 {formatNumber(rule.harvestEndTempC)} ℃・日
                      </p>
                      <p className={styles.ruleNote}>出穂後 +{rule.accumulationStartOffsetDays}日から積算：{rule.sourceNote}</p>
                    </div>
                    <div className={styles.rowActions}>
                      <button className={styles.textButton} type="button" onClick={() => beginEdit(card, rule)} disabled={pending || pendingDelete !== null}>編集</button>
                      <button className={styles.deleteButton} type="button" onClick={() => removeRule(rule)} disabled={pending || pendingDelete !== null}>
                        {pendingDelete === rule.id ? "削除中…" : "削除"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {card.customRules.length > 0 && !isEditing && (
                <button className={styles.addButton} type="button" onClick={() => beginCreate(card)} disabled={initialData.source === "fixture"}>＋ 期間・地域を追加</button>
              )}

              {isEditing && editing && (
                <RuleForm
                  card={card}
                  regions={initialData.regions}
                  editing={editing}
                  errors={errors}
                  pending={pending}
                  onChange={changeField}
                  onCancel={cancelEdit}
                  onSubmit={submitRule}
                />
              )}
            </section>
          );
        })}
      </div>

      {initialData.source === "fixture" && (
        <p className={styles.disabledNote}>Supabaseに接続すると、各品種の利用者設定を保存・編集・削除できます。</p>
      )}
    </div>
  );
}
