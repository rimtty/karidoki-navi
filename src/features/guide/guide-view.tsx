"use client";

import Link from "next/link";
import { useState } from "react";
import styles from "./guide-view.module.css";

const steps = [
  {
    short: "目安を設定",
    title: "品種ごとに、刈りどきを決める",
    lead: "最初に一度だけ、刈り始めと刈り終わりの積算気温を登録します。",
  },
  {
    short: "田んぼを登録",
    title: "田んぼの名前と日付を入れる",
    lead: "場所や地図は不要です。いつもの呼び名と大きさ、品種、日付だけで登録できます。",
  },
  {
    short: "毎日確認",
    title: "あとは色を見て、刈る順番を確認",
    lead: "出穂日から毎日の平均気温を自動で足し、田んぼの色とことばでお知らせします。",
  },
] as const;

const previewFields = [
  {
    name: "東の田んぼ",
    status: "刈りどき",
    detail: "今が刈りどきです",
    meta: "コシヒカリ・大",
    tone: "ready",
  },
  {
    name: "山ぎわ",
    status: "刈り遅れ",
    detail: "早めに確認",
    meta: "ヒノヒカリ・中",
    tone: "overdue",
  },
  {
    name: "家の前",
    status: "もうすぐ",
    detail: "あと75℃",
    meta: "あきさかり・小",
    tone: "soon",
  },
  {
    name: "上の田んぼ",
    status: "出穂前",
    detail: "出穂日を待っています",
    meta: "コシヒカリ・中",
    tone: "beforeHeading",
  },
  {
    name: "南の田んぼ",
    status: "刈りどき前",
    detail: "61%",
    meta: "あきろまん・中",
    tone: "growing",
  },
  {
    name: "西の田んぼ",
    status: "未設定",
    detail: "目安を設定",
    meta: "コシヒカリ・小",
    tone: "unset",
  },
  {
    name: "大きな田",
    status: "収穫済",
    detail: "収穫しました",
    meta: "恋の予感・大",
    tone: "harvested",
  },
] as const;

function StepPicture({ step }: { step: number }) {
  if (step === 0) {
    return (
      <div className={styles.rulePicture} aria-label="刈りどき設定の見本">
        <div>
          <span>刈り始め</span>
          <strong>1,000</strong>
          <small>℃・日</small>
        </div>
        <span className={styles.arrow} aria-hidden="true">→</span>
        <div>
          <span>刈り終わり</span>
          <strong>1,100</strong>
          <small>℃・日</small>
        </div>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className={styles.registrationPicture} aria-label="田んぼ登録の見本">
        <div><span>田んぼの名前</span><strong>家の前</strong></div>
        <div><span>大きさ</span><strong>中</strong></div>
        <div><span>品種</span><strong>コシヒカリ</strong></div>
        <div><span>出穂日</span><strong>8月5日</strong></div>
      </div>
    );
  }

  return (
    <div className={styles.statusPicture} aria-label="田んぼの色表示の見本">
      <div className={styles.growing}><strong>東の田んぼ</strong><span>刈りどき前</span></div>
      <div className={styles.soon}><strong>家の前</strong><span>もうすぐ</span></div>
      <div className={styles.ready}><strong>大きな田</strong><span>刈りどき</span></div>
    </div>
  );
}

function StepAction({ step }: { step: number }) {
  if (step === 0) {
    return (
      <Link className={styles.primaryAction} href="/app/settings/variety-rules">
        刈りどきの目安を設定する
      </Link>
    );
  }
  if (step === 1) {
    return (
      <Link className={styles.primaryAction} href="/app/fields/new/1">
        田んぼを登録する
      </Link>
    );
  }
  return (
    <Link className={styles.primaryAction} href="/app">
      今日の田んぼを見る
    </Link>
  );
}

export function GuideView() {
  const [currentStep, setCurrentStep] = useState(0);
  const step = steps[currentStep];

  return (
    <div className={styles.screen}>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>はじめての方へ</p>
        <h1>使い方</h1>
        <p>むずかしい操作はありません。使い始める順番を3つにまとめました。</p>
      </header>

      <aside className={styles.important} role="note">
        <span aria-hidden="true">!</span>
        <div>
          <strong>最初に「刈りどきの目安」を設定してください</strong>
          <p>
            品種の目安がない田んぼは、一覧でずっと「未設定」と表示されます。
            先に目安を登録すると、同じ品種の未設定の田んぼにも反映されます。
          </p>
        </div>
      </aside>

      <div className={styles.guideWorkspace}>
        <ol className={styles.stepTabs} aria-label="使い方の3段階">
          {steps.map((item, index) => (
            <li key={item.short}>
              <button
                type="button"
                className={index === currentStep ? styles.activeTab : ""}
                onClick={() => setCurrentStep(index)}
                aria-current={index === currentStep ? "step" : undefined}
              >
                <span>{index + 1}</span>
                <strong>{item.short}</strong>
              </button>
            </li>
          ))}
        </ol>

        <section className={styles.stepCard} aria-live="polite">
          <div className={styles.stepHeading}>
            <span>その{currentStep + 1}</span>
            <h2>{step.title}</h2>
            <p>{step.lead}</p>
          </div>

          <StepPicture step={currentStep} />

          {currentStep === 0 && (
            <div className={styles.explanation}>
              <strong>どの数字を入れるの？</strong>
              <p>
                法人の作業ノートやJAなどの資料にある「出穂後の積算気温」を使います。
                分からないときは推測で入れず、確認できてから登録してください。
              </p>
            </div>
          )}
          {currentStep === 1 && (
            <div className={styles.explanation}>
              <strong>入力するのは5つだけ</strong>
              <p>田んぼの名前・大きさ・品種・田植え日・出穂日を入れます。住所や地図は使いません。</p>
            </div>
          )}
          {currentStep === 2 && (
            <div className={styles.explanation}>
              <strong>金色になった田んぼから確認</strong>
              <p>うすい緑は出穂前、緑は刈りどき前、黄色はもうすぐ、金色は刈りどきです。色だけでなく文字でも表示します。</p>
            </div>
          )}

          <div className={styles.cardActions}>
            <button
              type="button"
              className={styles.secondaryAction}
              onClick={() => setCurrentStep((value) => Math.max(0, value - 1))}
              disabled={currentStep === 0}
            >
              前へ
            </button>
            {currentStep < steps.length - 1 ? (
              <button
                type="button"
                className={styles.nextAction}
                onClick={() => setCurrentStep((value) => Math.min(steps.length - 1, value + 1))}
              >
                次へ
              </button>
            ) : (
              <StepAction step={currentStep} />
            )}
          </div>

          {currentStep < steps.length - 1 && (
            <div className={styles.directAction}>
              <StepAction step={currentStep} />
            </div>
          )}
        </section>
      </div>

      <section className={styles.futurePreview} aria-labelledby="future-preview-title">
        <div className={styles.previewHeading}>
          <div>
            <p className={styles.previewEyebrow}>完成後の見え方</p>
            <h2 id="future-preview-title">登録すると、毎朝この一覧を見るだけ</h2>
          </div>
          <span>表示例</span>
        </div>
        <p className={styles.previewLead}>
          出穂日から気温を自動で積み上げ、急ぐ田んぼから順に並べます。色だけでなく、大きな文字でも状態が分かります。
        </p>
        <div className={styles.previewSummary}>
          <strong>今が刈りどき <span>1件</span></strong>
          <p>金色と赤色の田んぼから確認します。</p>
        </div>
        <div className={styles.previewGrid} aria-label="田んぼ一覧の色分け表示例">
          {previewFields.map((field) => (
            <article
              className={`${styles.previewCard} ${styles[field.tone]}`}
              key={field.name}
            >
              <span className={styles.previewStatus}>{field.status}</span>
              <h3>{field.name}</h3>
              <strong>{field.detail}</strong>
              <small>{field.meta}</small>
            </article>
          ))}
        </div>
        <Link className={styles.previewAction} href="/app/settings/variety-rules">
          刈りどきの目安を設定する
        </Link>
      </section>

      <section className={styles.quickHelp}>
        <h2>迷ったときは</h2>
        <div>
          <p><strong>田んぼが「未設定」になる</strong><span>その品種の刈りどきの目安を設定します。</span></p>
          <p><strong>「出穂前」と表示される</strong><span>設定は完了しています。登録した出穂日から気温を自動で計算します。</span></p>
          <p><strong>作っている品種がない</strong><span>設定画面の「品種を追加」から登録できます。</span></p>
          <p><strong>数字が分からない</strong><span>作業ノートやJAなどへ確認し、分かるまで空欄で大丈夫です。</span></p>
        </div>
      </section>
    </div>
  );
}
