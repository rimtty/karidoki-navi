"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { DataLoadError } from "@/components/data-load-error";
import { FixtureNotice } from "@/components/quality-notice";
import {
  createRiceVarietyAction,
  deleteVarietyRuleAction,
  saveVarietyRuleAction,
} from "@/lib/variety-rules/actions";
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
    endTempC: String(rule.harvestEndTempC),
    sourceNote: rule.sourceNote,
  };
}

function formatNumber(value: number): string {
  return value.toLocaleString("ja-JP", { maximumFractionDigits: 1 });
}

function fieldErrorId(cardId: string, field: VarietyRuleFormField): string {
  return `variety-rule-${cardId}-${field}-error`;
}

function RuleForm({
  card,
  editing,
  errors,
  pending,
  onChange,
  onCancel,
  onSubmit,
}: {
  card: VarietyRuleCard;
  editing: EditingRule;
  errors: VarietyRuleFormErrors;
  pending: boolean;
  onChange: (field: keyof VarietyRuleFormInput, value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const input = (field: keyof VarietyRuleFormInput) => editing.form[field];
  const describedBy = (field: VarietyRuleFormField, hintId?: string) =>
    [hintId, errors[field] ? fieldErrorId(card.id, field) : undefined]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div className={styles.form} aria-label={`${card.name}の刈りどきの目安を入力`}>
      <div className={styles.formHeading}>
        <p className={styles.formEyebrow}>{editing.ruleId ? "目安を変更" : "目安を登録"}</p>
        <h3>{card.name}の刈りどき</h3>
        <p>作業ノートやJAなどの資料にある、出穂後の積算気温を入力してください。</p>
      </div>

      <div className={styles.temperatureFields}>
        <div className={styles.field}>
          <div className={styles.labelRow}>
            <label htmlFor={`${card.id}-start`}>刈り始めの積算気温</label>
            <span className={styles.required}>必須</span>
          </div>
          <div className={styles.numberInput}>
            <input
              id={`${card.id}-start`}
              type="number"
              min="100"
              max="3000"
              step="1"
              inputMode="numeric"
              placeholder="参考：1000"
              value={input("startTempC")}
              onChange={(event) => onChange("startTempC", event.target.value)}
              aria-invalid={Boolean(errors.startTempC)}
              aria-describedby={describedBy("startTempC", `${card.id}-start-hint`)}
            />
            <span aria-hidden="true">℃・日</span>
          </div>
          <p className={styles.fieldHint} id={`${card.id}-start-hint`}>
            この温度になったら、田んぼを確認し始めます。
          </p>
          {errors.startTempC && (
            <p className={styles.error} id={fieldErrorId(card.id, "startTempC")} role="alert">
              {errors.startTempC}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <div className={styles.labelRow}>
            <label htmlFor={`${card.id}-end`}>刈り終わりの積算気温</label>
            <span className={styles.required}>必須</span>
          </div>
          <div className={styles.numberInput}>
            <input
              id={`${card.id}-end`}
              type="number"
              min="100"
              max="3000"
              step="1"
              inputMode="numeric"
              placeholder="参考：1100"
              value={input("endTempC")}
              onChange={(event) => onChange("endTempC", event.target.value)}
              aria-invalid={Boolean(errors.endTempC)}
              aria-describedby={describedBy("endTempC", `${card.id}-end-hint`)}
            />
            <span aria-hidden="true">℃・日</span>
          </div>
          <p className={styles.fieldHint} id={`${card.id}-end-hint`}>
            この温度までに刈り終える目安です。
          </p>
          {errors.endTempC && (
            <p className={styles.error} id={fieldErrorId(card.id, "endTempC")} role="alert">
              {errors.endTempC}
            </p>
          )}
        </div>
      </div>

      <p className={styles.referenceNote}>
        薄い数字は参考用の入力例です。地域や年によって変わるため、自動では保存しません。
      </p>

      <div className={styles.field}>
        <div className={styles.labelRow}>
          <label htmlFor={`${card.id}-note`}>この目安の出どころ</label>
          <span className={styles.required}>必須</span>
        </div>
        <textarea
          id={`${card.id}-note`}
          maxLength={2000}
          value={input("sourceNote")}
          onChange={(event) => onChange("sourceNote", event.target.value)}
          placeholder="例：2025年の法人の作業ノート。収穫実績をもとに決めた。"
          aria-invalid={Boolean(errors.sourceNote)}
          aria-describedby={describedBy("sourceNote", `${card.id}-note-hint`)}
        />
        <p className={styles.fieldHint} id={`${card.id}-note-hint`}>
          後から見返せるよう、資料名・年・決めた人などを書きます。
        </p>
        {errors.sourceNote && (
          <p className={styles.error} id={fieldErrorId(card.id, "sourceNote")} role="alert">
            {errors.sourceNote}
          </p>
        )}
      </div>

      <div className={styles.automaticSettings} aria-label="自動で決まる項目">
        <strong>次の内容は自動で設定します</strong>
        <dl>
          <div>
            <dt>計算を始める日</dt>
            <dd>出穂日当日</dd>
          </div>
          <div>
            <dt>対象地域</dt>
            <dd>三原市久井町</dd>
          </div>
          <div>
            <dt>使う田んぼ</dt>
            <dd>同じ品種の未設定の田んぼ</dd>
          </div>
        </dl>
      </div>

      {errors.form && <p className={styles.formError} role="alert">{errors.form}</p>}

      <div className={styles.formActions}>
        <button className={styles.cancelButton} type="button" onClick={onCancel} disabled={pending}>
          やめる
        </button>
        <button className={styles.saveButton} type="button" onClick={onSubmit} disabled={pending}>
          {pending ? "保存しています…" : "この目安を保存する"}
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
  const [newVarietyName, setNewVarietyName] = useState("");
  const [pendingVariety, setPendingVariety] = useState(false);
  const [varietyError, setVarietyError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState(false);

  function beginCreate(card: VarietyRuleCard) {
    setEditing({ cardId: card.id, ruleId: null, form: emptyVarietyRuleForm() });
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
    setEditing((current) =>
      current ? { ...current, form: { ...current.form, [field]: value } } : current,
    );
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
  }

  async function addVariety() {
    if (pendingVariety || initialData.source === "fixture") return;
    const name = newVarietyName.trim().replace(/\s+/g, " ");
    if (!name || name.length > 30) {
      setVarietyError("品種名を30文字以内で入力してください。");
      return;
    }
    if (cards.some((card) => card.name.localeCompare(name, "ja", { sensitivity: "base" }) === 0)) {
      setVarietyError("この品種は、すでに一覧にあります。");
      return;
    }

    setPendingVariety(true);
    setVarietyError(null);
    setFeedback(null);
    setFeedbackError(false);
    try {
      const result = await createRiceVarietyAction({ name });
      if (!result.ok) {
        setVarietyError(result.message);
        return;
      }
      setCards((current) =>
        current.some((card) => card.id === result.card.id)
          ? current
          : [...current, result.card],
      );
      setNewVarietyName("");
      setEditing({
        cardId: result.card.id,
        ruleId: null,
        form: emptyVarietyRuleForm(),
      });
      setErrors({});
      setFeedback("品種を追加しました。続けて、刈りどきの目安を入力してください。");
      router.refresh();
      window.setTimeout(() => {
        document.getElementById(`variety-${result.card.id}`)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 0);
    } catch {
      setVarietyError("品種を追加できませんでした。通信状態を確認してください。");
    } finally {
      setPendingVariety(false);
    }
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
      setCards((current) =>
        current.map((candidate) => {
          if (candidate.id !== card.id) return candidate;
          const customRules = editing.ruleId
            ? candidate.customRules.map((rule) =>
                rule.id === result.rule.id ? result.rule : rule,
              )
            : [result.rule, ...candidate.customRules];
          return { ...candidate, customRules };
        }),
      );
      setEditing(null);
      setErrors({});
      setFeedback("刈りどきの目安を保存しました。同じ品種で未設定の田んぼにも反映しました。");
      router.refresh();
    } catch {
      setFeedback("刈りどきの目安を保存できませんでした。通信状態を確認してください。");
      setFeedbackError(true);
    } finally {
      setPending(false);
    }
  }

  async function removeRule(rule: AccountVarietyRule) {
    if (pending || initialData.source === "fixture") return;
    if (!window.confirm("この刈りどきの目安を削除しますか？登録済みの田んぼは変わりません。")) {
      return;
    }

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
      setCards((current) =>
        current.map((card) => ({
          ...card,
          customRules: card.customRules.filter((candidate) => candidate.id !== rule.id),
        })),
      );
      if (editing?.ruleId === rule.id) setEditing(null);
      setFeedback("刈りどきの目安を削除しました。登録済みの田んぼは変わりません。");
      router.refresh();
    } catch {
      setFeedback("刈りどきの目安を削除できませんでした。通信状態を確認してください。");
      setFeedbackError(true);
    } finally {
      setPendingDelete(null);
    }
  }

  return (
    <div className={styles.screen}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>設定</p>
          <h1>刈りどきの目安</h1>
          <p className={styles.pageLead}>
            品種ごとに、刈り始めと刈り終わりの積算気温を登録します。
          </p>
        </div>
        <Link className={styles.backLink} href="/app">田んぼへ戻る</Link>
      </header>

      {initialData.error && <DataLoadError message={initialData.error} />}
      {initialData.source === "fixture" && <FixtureNotice compact />}

      <div className={styles.notice} role="note">
        <span className={styles.noticeIcon} aria-hidden="true">!</span>
        <div>
          <strong>数字が分からないときは、入力しなくて大丈夫です</strong>
          <p>
            三原市久井町で使える公的な数字は、まだ確認できていません。ほかの地域の数字を推測で入れず、作業ノートやJAなどの資料がある場合だけ登録してください。
          </p>
        </div>
      </div>

      <section className={styles.addVarietyPanel} aria-labelledby="add-variety-title">
        <div>
          <p className={styles.addVarietyEyebrow}>一覧にない品種</p>
          <h2 id="add-variety-title">品種を追加</h2>
          <p>作っているお米が一覧にないときだけ、品種名を追加してください。</p>
        </div>
        <div className={styles.addVarietyControls}>
          <label htmlFor="new-variety-name">追加する品種名</label>
          <div className={styles.addVarietyRow}>
            <input
              id="new-variety-name"
              type="text"
              maxLength={30}
              autoComplete="off"
              placeholder="例：にこまる"
              value={newVarietyName}
              onChange={(event) => {
                setNewVarietyName(event.target.value);
                setVarietyError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void addVariety();
                }
              }}
              aria-invalid={Boolean(varietyError)}
              aria-describedby={varietyError ? "new-variety-error" : undefined}
              disabled={pendingVariety || initialData.source === "fixture"}
            />
            <button
              type="button"
              onClick={() => void addVariety()}
              disabled={pendingVariety || initialData.source === "fixture"}
            >
              {pendingVariety ? "追加しています…" : "この品種を追加"}
            </button>
          </div>
          {varietyError && (
            <p className={styles.error} id="new-variety-error" role="alert">
              {varietyError}
            </p>
          )}
        </div>
      </section>

      {feedback && (
        <p
          className={`${styles.feedback} ${feedbackError ? styles.feedbackError : ""}`}
          role={feedbackError ? "alert" : "status"}
        >
          {feedback}
        </p>
      )}

      <div className={styles.cards}>
        {cards.map((card) => {
          const isEditing = editing?.cardId === card.id;
          const hasRule = card.customRules.length > 0;
          return (
            <section className={styles.card} key={card.id} aria-labelledby={`variety-${card.id}`}>
              <div className={styles.cardHeader}>
                <div>
                  <h2 id={`variety-${card.id}`}>{card.name}</h2>
                  {card.isCustom && <span className={styles.customLabel}>追加した品種</span>}
                </div>
                <span className={hasRule ? styles.configuredBadge : styles.emptyBadge}>
                  {hasRule ? "目安あり" : "目安なし"}
                </span>
              </div>

              {!hasRule && !isEditing && (
                <div className={styles.emptyRule}>
                  <p>この品種は、まだ刈りどきの数字を登録していません。</p>
                  <button
                    className={styles.addButton}
                    type="button"
                    onClick={() => beginCreate(card)}
                    disabled={initialData.source === "fixture"}
                  >
                    この品種の目安を登録する
                  </button>
                </div>
              )}

              {hasRule && !isEditing && (
                <div className={styles.ruleList}>
                  {card.customRules.map((rule) => (
                    <div className={styles.savedRule} key={rule.id}>
                      <div className={styles.ruleTemperatures}>
                        <div>
                          <span>刈り始め</span>
                          <strong>{formatNumber(rule.harvestStartTempC)}<small>℃・日</small></strong>
                        </div>
                        <div aria-hidden="true" className={styles.rangeArrow}>→</div>
                        <div>
                          <span>刈り終わり</span>
                          <strong>{formatNumber(rule.harvestEndTempC)}<small>℃・日</small></strong>
                        </div>
                      </div>
                      <div className={styles.sourceNote}>
                        <span>目安の出どころ</span>
                        <p>{rule.sourceNote}</p>
                      </div>
                      <div className={styles.rowActions}>
                        <button
                          className={styles.editButton}
                          type="button"
                          onClick={() => beginEdit(card, rule)}
                          disabled={pending || pendingDelete !== null}
                        >
                          変更する
                        </button>
                        <button
                          className={styles.deleteButton}
                          type="button"
                          onClick={() => removeRule(rule)}
                          disabled={pending || pendingDelete !== null}
                        >
                          {pendingDelete === rule.id ? "削除しています…" : "削除する"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {isEditing && editing && (
                <RuleForm
                  card={card}
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
        <p className={styles.disabledNote}>
          Supabaseに接続すると、刈りどきの目安を保存・変更・削除できます。
        </p>
      )}
    </div>
  );
}
