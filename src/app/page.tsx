import Link from "next/link";
import styles from "./page.module.css";

const steps = [
  {
    number: "01",
    title: "かんたん登録",
    description: "名前・大きさ・品種・田植え日・出穂日を入力します。",
  },
  {
    number: "02",
    title: "気温を自動で積算",
    description: "出穂日から毎日の平均気温を自動で積み上げます。",
  },
  {
    number: "03",
    title: "一覧で刈りどきを確認",
    description: "毎朝、上から順に色分けされた田んぼを確認します。",
  },
];

export default function Home() {
  return (
    <main className={styles.page}>
      <div className={styles.grain} aria-hidden="true" />
      <header className={styles.header}>
        <a className={styles.brand} href="#top" aria-label="刈りどきナビ ホーム">
          <span className={styles.brandMark} aria-hidden="true">
            🌾
          </span>
          <span>刈りどきナビ</span>
        </a>
        <span className={styles.status}>試用版</span>
      </header>

      <section className={styles.hero} id="top">
        <div className={styles.heroCopy}>
          <div className={styles.eyebrow}>田んぼの積算気温・刈りどき案内</div>
          <h1>
            次に刈る田んぼが、
            <br />
            <strong>3秒でわかる。</strong>
          </h1>
          <p className={styles.lead}>
            出穂日を登録したら、あとは自動で積算。
            <br />
            毎朝、一覧を見るだけで刈りどきを確認できます。
          </p>
          <div className={styles.ctaGroup}>
            <Link className={styles.primaryCta} href="/login">
              <span>ログインして使う</span>
              <span aria-hidden="true">→</span>
            </Link>
            <p className={styles.ctaNote}>
              メールアドレスまたはGoogleアカウントで始められます。
            </p>
          </div>
        </div>
        <div className={styles.preview} aria-label="刈取状況の表示例">
          <div className={styles.previewHeader}>
            <div>
              <span className={styles.previewCaption}>今日の刈りどき</span>
              <strong>2026年</strong>
            </div>
            <span className={styles.readyCount}>適期 2</span>
          </div>
          <div className={styles.fieldGrid}>
            <div className={`${styles.field} ${styles.ready}`}>
              <strong>北田</strong>
              <span>今が刈りどき</span>
            </div>
            <div className={`${styles.field} ${styles.soon}`}>
              <strong>西田</strong>
              <span>もうすぐ刈りどき</span>
            </div>
            <div className={`${styles.field} ${styles.growing}`}>
              <strong>南田</strong>
              <span>お米が育っています</span>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.howItWorks} aria-labelledby="how-it-works">
        <div className={styles.sectionHeading}>
          <span>使いかた</span>
          <h2 id="how-it-works">登録したあとは、一覧を見るだけ。</h2>
        </div>
        <ol className={styles.steps}>
          {steps.map((step) => (
            <li key={step.number}>
              <span className={styles.stepNumber}>{step.number}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <footer className={styles.footer}>
        <span>🌾 刈りどきナビ</span>
        <span>試用版を公開中です。</span>
      </footer>
    </main>
  );
}
