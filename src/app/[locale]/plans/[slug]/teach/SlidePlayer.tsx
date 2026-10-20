"use client";

/**
 * SlidePlayer — the classroom deck for one lesson, projected while teaching.
 *
 * Two views of the same deck, kept in step over a BroadcastChannel:
 *  - audience  — the projector: one 16:9 slide, full screen on request;
 *  - presenter — the teacher's own screen (opened in a second window): the
 *                script, the plan's misconceptions / watch-for / support
 *                notes, and what comes next.
 * Either window drives both — arrows, space, PageUp/PageDown (so a clicker
 * works), or the on-screen buttons.
 *
 * Each slide takes `steps` clicks before moving on: lists reveal an item per
 * click, checkpoints reveal the expected answer. Timed slides carry a
 * countdown (T), and practice/checkpoint slides a pupil picker (P) that draws
 * numbers 1…class size without repeats; the class size is remembered on this
 * computer.
 *
 * Everything runs in the browser once the page has loaded, so a dropped
 * connection mid-lesson does not stop the slides.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { Link, useRouter } from "@/i18n/navigation";
import type { SlideDeck } from "@/lib/slides/deckSchema";
import type { ScriptLine, Visual } from "@/lib/slides/deckSchema";
import {
  answerStep,
  deckToSlides,
  hasVisual,
  scriptAt,
  type Slide,
  type TeacherExtras,
} from "@/lib/slides/deckToSlides";
import { DECK_LABELS, type DeckLabels } from "@/lib/slides/labels";

import styles from "./slides.module.css";

type View = "audience" | "presenter";
interface Position {
  slide: number;
  step: number;
}

const CLASS_SIZE_KEY = "silverleaf.slides.classSize";

/* ── countdown ─────────────────────────────────────────────────────────── */

function useCountdown(minutes: number | null, resetKey: number) {
  const [remaining, setRemaining] = useState(() => (minutes ?? 0) * 60);
  const [running, setRunning] = useState(false);

  // A new slide (or a slide with a different time) starts a fresh countdown.
  useEffect(() => {
    setRemaining((minutes ?? 0) * 60);
    setRunning(false);
  }, [minutes, resetKey]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          setRunning(false);
          beep();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [running]);

  return {
    remaining,
    running,
    toggle: () => {
      if (remaining === 0) setRemaining((minutes ?? 0) * 60);
      setRunning((r) => !r);
    },
    reset: () => {
      setRunning(false);
      setRemaining((minutes ?? 0) * 60);
    },
  };
}

/** A short two-tone chime when time is up (silently skipped if audio is blocked). */
function beep() {
  try {
    const ctx = new AudioContext();
    [880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.2, ctx.currentTime + i * 0.35);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.35 + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.35);
      osc.stop(ctx.currentTime + i * 0.35 + 0.3);
    });
  } catch {
    /* no audio — the flashing display is enough */
  }
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/* ── pupil picker ──────────────────────────────────────────────────────── */

function usePicker() {
  const [classSize, setClassSizeState] = useState(30);
  const [picked, setPicked] = useState<number | null>(null);
  const [wrapped, setWrapped] = useState(false);
  const bag = useRef<number[]>([]);

  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(CLASS_SIZE_KEY));
      if (saved >= 1 && saved <= 200) setClassSizeState(saved);
    } catch {
      /* storage blocked — keep the default */
    }
  }, []);

  const setClassSize = (n: number) => {
    const size = Math.min(200, Math.max(1, Math.round(n) || 1));
    setClassSizeState(size);
    bag.current = [];
    setWrapped(false);
    try {
      window.localStorage.setItem(CLASS_SIZE_KEY, String(size));
    } catch {
      /* not remembered — fine */
    }
  };

  const pick = () => {
    let refilled = false;
    if (bag.current.length === 0) {
      refilled = picked !== null;
      bag.current = Array.from({ length: classSize }, (_, i) => i + 1).filter(
        (n) => classSize === 1 || n !== picked,
      );
    }
    const i = Math.floor(Math.random() * bag.current.length);
    const [n] = bag.current.splice(i, 1);
    setPicked(n ?? 1);
    setWrapped(refilled);
  };

  // Stable, so "clear when the slide changes" runs on a slide change only —
  // a fresh function each render would wipe every pick as soon as it shows.
  const clear = useCallback(() => {
    setPicked(null);
    setWrapped(false);
  }, []);

  return { classSize, setClassSize, picked, wrapped, pick, clear };
}

/* ── player ────────────────────────────────────────────────────────────── */

export default function SlidePlayer({
  deck,
  extras,
  planId,
  planHref,
  view,
  basic,
  canRegenerate,
}: {
  deck: SlideDeck;
  extras: TeacherExtras;
  planId: string;
  /** Locale-less href of the plan page. */
  planHref: string;
  view: View;
  /** True for the no-AI deck built straight from the plan. */
  basic: boolean;
  canRegenerate: boolean;
}) {
  const t = useTranslations("lpSlides");
  const router = useRouter();
  const slides = useMemo(() => deckToSlides(deck), [deck]);
  const [pos, setPos] = useState<Position>({ slide: 0, step: 0 });
  /** Current position for event handlers, which must not go stale. */
  const posRef = useRef(pos);
  posRef.current = pos;
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  /** Single-screen view: the teacher's script under the slide (off the slide itself). */
  const [notesOpen, setNotesOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const channel = useRef<BroadcastChannel | null>(null);

  const labels = DECK_LABELS[deck.language];
  const slide = slides[pos.slide]!;
  const minutes = slide.timer;
  const timer = useCountdown(minutes, pos.slide);
  const picker = usePicker();
  const pickerOn = slide.picker;

  // Keep both windows on the same slide. A position received from the other
  // window is applied without being sent back.
  const go = useCallback((next: Position, broadcast = true) => {
    setPos(next);
    if (broadcast) channel.current?.postMessage(next);
  }, []);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(`silverleaf-slides:${planId}`);
    ch.onmessage = (e: MessageEvent<Position | "hello">) => {
      if (e.data === "hello") {
        // A window just opened: tell it where we are.
        ch.postMessage(posRef.current);
      } else if (e.data && typeof e.data.slide === "number") {
        go(e.data, false);
      }
    };
    channel.current = ch;
    ch.postMessage("hello");
    return () => ch.close();
  }, [planId, go]);

  // The picker's last draw belongs to the slide it was made on.
  const clearPick = picker.clear;
  useEffect(() => clearPick(), [pos.slide, clearPick]);

  const next = useCallback(() => {
    const { slide: s, step } = posRef.current;
    if (step < slides[s]!.steps) go({ slide: s, step: step + 1 });
    else if (s < slides.length - 1) go({ slide: s + 1, step: 0 });
  }, [slides, go]);

  const prev = useCallback(() => {
    const { slide: s, step } = posRef.current;
    if (step > 0) go({ slide: s, step: step - 1 });
    else if (s > 0) go({ slide: s - 1, step: slides[s - 1]!.steps });
  }, [slides, go]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void shellRef.current?.requestFullscreen?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select")) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
        case "PageDown":
        case " ":
        case "Enter":
          e.preventDefault();
          next();
          break;
        case "ArrowLeft":
        case "ArrowUp":
        case "PageUp":
        case "Backspace":
          e.preventDefault();
          prev();
          break;
        case "Home":
          go({ slide: 0, step: 0 });
          break;
        case "End":
          go({ slide: slides.length - 1, step: 0 });
          break;
        case "f":
        case "F":
          toggleFullscreen();
          break;
        case "t":
        case "T":
          if (minutes) timer.toggle();
          break;
        case "p":
        case "P":
          if (pickerOn) picker.pick();
          break;
        case "n":
        case "N":
          setNotesOpen((open) => !open);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, go, slides.length, toggleFullscreen, minutes, timer, pickerOn, picker]);

  async function regenerate() {
    setRegenerating(true);
    setRegenError(null);
    try {
      const res = await fetch("/api/ai/slides", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId, regenerate: true }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setRegenError(errorText(t, body.error));
      } else {
        router.refresh();
      }
    } catch {
      setRegenError(errorText(t, "network"));
    } finally {
      setRegenerating(false);
    }
  }

  function openPresenter() {
    const url = new URL(window.location.href);
    url.searchParams.set("view", "presenter");
    window.open(url.toString(), `silverleaf-presenter-${planId}`, "width=1100,height=760");
  }

  const toolbar = (
    <div className={styles.toolbar}>
      <Link href={planHref} className={styles.toolLink}>
        {t("back")}
      </Link>
      <span className={styles.counter}>
        {t("slideOf", { n: pos.slide + 1, total: slides.length })}
      </span>
      <div className={styles.toolGroup}>
        <button type="button" className={styles.toolButton} onClick={prev} disabled={pos.slide === 0 && pos.step === 0}>
          ← {t("previous")}
        </button>
        <button
          type="button"
          className={styles.toolButton}
          onClick={next}
          disabled={pos.slide === slides.length - 1 && pos.step >= slide.steps}
        >
          {pos.step < slide.steps ? t("reveal") : t("next")} →
        </button>
        {view === "audience" ? (
          <>
            <button
              type="button"
              className={styles.toolButton}
              onClick={() => setNotesOpen((open) => !open)}
              aria-pressed={notesOpen}
            >
              {t("toggleNotes")}
            </button>
            <button type="button" className={styles.toolButton} onClick={openPresenter}>
              {t("presenter")}
            </button>
            <button type="button" className={styles.toolButton} onClick={toggleFullscreen}>
              {t("fullscreen")}
            </button>
          </>
        ) : null}
        {/* A plain API download, not a page — hence <a>, not the locale Link. */}
        <a className={styles.toolButton} href={`/api/slides/${planId}/pptx`} download>
          {t("downloadPptx")}
        </a>
        {canRegenerate ? (
          <button type="button" className={styles.toolButton} onClick={regenerate} disabled={regenerating}>
            {regenerating ? t("regenerating") : t("regenerate")}
          </button>
        ) : null}
      </div>
    </div>
  );

  const notices = (
    <>
      {basic ? <p className={styles.notice}>{t("basicNotice")}</p> : null}
      {regenError ? (
        <p className={styles.notice} role="alert">
          {regenError}
        </p>
      ) : null}
    </>
  );

  const stage = (
    <SlideStage
      slide={slide}
      labels={labels}
      step={pos.step}
      progress={(pos.slide + 1) / slides.length}
      // Once the exercise / exit-ticket answers are up, the class is marking,
      // not working: the timer gives its room to the answers.
      timer={
        minutes && !(answerStep(slide, pos.step) >= 1 && (slide.kind === "exercise" || slide.kind === "exit"))
          ? timer
          : null
      }
      picker={pickerOn ? picker : null}
      onAdvance={view === "audience" ? next : undefined}
    />
  );

  if (view === "presenter") {
    const upcoming = slides[pos.slide + 1];
    return (
      <div className={styles.shell} ref={shellRef}>
        {toolbar}
        {notices}
        <div className={styles.presenter}>
          <div className={styles.presenterStage}>
            <p className={styles.presenterTitle}>{t("presenterTitle")}</p>
            {stage}
            <p className={styles.keys}>{t("keys")}</p>
          </div>
          <aside className={styles.presenterNotes}>
            <h2>{t("notes")}</h2>
            <ScriptList lines={scriptAt(slide, pos.step)} labels={labels} empty={t("noNotes")} />
            <ExtrasPanel slide={slide} extras={extras} />
            <h2>{t("nextUp")}</h2>
            <p>{upcoming ? upcomingLabel(upcoming, labels) : t("lastSlide")}</p>
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.shell} ref={shellRef}>
      {toolbar}
      {notices}
      <div className={styles.viewport}>{stage}</div>
      {notesOpen ? (
        <aside className={styles.notesPanel}>
          <ScriptList lines={scriptAt(slide, pos.step)} labels={labels} empty={t("noNotes")} />
          <ExtrasPanel slide={slide} extras={extras} />
        </aside>
      ) : null}
      <p className={styles.keys}>{t("keys")}</p>
    </div>
  );
}

export function errorText(t: ReturnType<typeof useTranslations>, code: string | undefined): string {
  const known = [
    "no-api-key",
    "not-structured",
    "not-found",
    "forbidden",
    "rate-limit",
    "no-credits",
    "model-error",
    "bad-request",
    "network",
  ] as const;
  const hit = known.find((k) => k === code) ?? "bad-request";
  return t(`errors.${hit}`);
}

function upcomingLabel(slide: Slide, labels: DeckLabels): string {
  const phase = labels.phase[slide.phase];
  if (slide.kind === "checkpoint") return `${phase} — ${labels.checkpoint}: ${slide.question}`;
  if (slide.kind === "example") return `${phase} — ${labels.workedExample(slide.number)}`;
  if (slide.kind === "round") return `${phase} — ${slide.title}`;
  return `${phase} — ${slide.heading}`;
}

/** The teacher's lines, each tagged Say / Ask / Expect / Do. */
function ScriptList({
  lines,
  labels,
  empty,
  className,
}: {
  lines: ScriptLine[];
  labels: DeckLabels;
  empty?: string;
  className?: string;
}) {
  if (lines.length === 0) return empty ? <p>{empty}</p> : null;
  return (
    <ul className={`${styles.scriptList} ${className ?? ""}`}>
      {lines.map((line, i) => (
        <li key={i}>
          <span className={`${styles.cue} ${styles[`cue_${line.kind}`] ?? ""}`}>
            {labels.script[line.kind]}
          </span>
          <span>{line.text}</span>
        </li>
      ))}
    </ul>
  );
}

/* ── one slide ─────────────────────────────────────────────────────────── */

/** Questions with their answers shown when `shown(i)` says so. */
function QuestionList({
  questions,
  shown,
}: {
  questions: Array<{ question: string; answer: string }>;
  shown: (i: number) => boolean;
}) {
  return (
    // Three or more questions sit in two columns: with their answers shown, a
    // single column would push the last ones off the slide.
    <ol className={`${styles.questions} ${questions.length >= 3 ? styles.twoColList : ""}`}>
      {questions.map((q, i) => (
        <li key={i}>
          {q.question}
          {shown(i) && q.answer.trim() ? <span className={styles.qAnswer}>→ {q.answer}</span> : null}
        </li>
      ))}
    </ol>
  );
}

/** The class's numbered steps, built up one per click. */
function Instructions({ items, step }: { items: string[]; step: number }) {
  if (items.length === 0) return null;
  return (
    <ol className={styles.instructions}>
      {items.map((item, i) => (
        <li key={i} className={i <= step ? styles.shown : styles.hidden}>
          {item}
        </li>
      ))}
    </ol>
  );
}

/* ── visuals: drawn by the app, so they work offline and need no props ── */

/** Most objects drawn in one group (the model is asked for 20 at most). */
const MAX_OBJECTS = 30;

function VisualView({ visual }: { visual: Visual }) {
  if (!hasVisual(visual)) return null;
  return (
    <figure className={styles.visual}>
      {visual.kind === "objects" ? (
        <div className={styles.groups}>
          {visual.groups.map((g, i) => (
            <div key={i} className={styles.group}>
              <div className={styles.objects} aria-hidden="true">
                {Array.from({ length: Math.min(g.count, MAX_OBJECTS) }, (_, j) => (
                  <span key={j}>{g.emoji}</span>
                ))}
              </div>
              {g.label ? <span className={styles.groupLabel}>{g.label}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
      {visual.kind === "number_line" ? <NumberLine line={visual.number_line} /> : null}
      {visual.kind === "place_value" ? (
        <table className={styles.placeValue}>
          <thead>
            <tr>
              <th>H</th>
              <th>T</th>
              <th>O</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{visual.place_value.hundreds}</td>
              <td>{visual.place_value.tens}</td>
              <td>{visual.place_value.ones}</td>
            </tr>
          </tbody>
        </table>
      ) : null}
      {visual.kind === "table" ? (
        <table className={styles.dataTable}>
          {visual.table.headers.length > 0 ? (
            <thead>
              <tr>
                {visual.table.headers.map((h, i) => (
                  <th key={i}>{h}</th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {visual.table.rows.slice(0, 8).map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {visual.kind === "word_cards" ? (
        <div className={styles.cards}>
          {visual.cards.slice(0, 6).map((c, i) => (
            <div key={i} className={styles.card}>
              {c.emoji ? <span className={styles.cardEmoji}>{c.emoji}</span> : null}
              <span>{c.text}</span>
            </div>
          ))}
        </div>
      ) : null}
      {visual.kind === "picture" ? (
        <div className={styles.picture} aria-hidden="true">
          {visual.emoji}
        </div>
      ) : null}
      {visual.caption.trim() ? <figcaption>{visual.caption}</figcaption> : null}
    </figure>
  );
}

/** A number line from `from` to `to`, ticks every `step`, `highlight` circled. */
function NumberLine({ line }: { line: Visual["number_line"] }) {
  const count = Math.min(40, Math.floor((line.to - line.from) / line.step));
  const ticks = Array.from({ length: count + 1 }, (_, i) => +(line.from + i * line.step).toFixed(4));
  const x = (i: number) => 4 + (i / Math.max(1, count)) * 92;
  return (
    <svg className={styles.numberLine} viewBox="0 0 100 22" role="img" aria-label={`${line.from}–${line.to}`}>
      <line x1="2" y1="10" x2="98" y2="10" />
      {ticks.map((n, i) => {
        const on = line.highlight.includes(n);
        return (
          <g key={i}>
            {on ? <circle cx={x(i)} cy="10" r="2.6" /> : null}
            <line x1={x(i)} y1="7.5" x2={x(i)} y2="12.5" />
            <text x={x(i)} y="19" className={on ? styles.nlOn : undefined}>
              {n}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function SlideStage({
  slide,
  labels,
  step,
  progress,
  timer,
  picker,
  onAdvance,
}: {
  slide: Slide;
  labels: DeckLabels;
  step: number;
  progress: number;
  timer: ReturnType<typeof useCountdown> | null;
  picker: ReturnType<typeof usePicker> | null;
  /** Click on the slide itself = next (audience view only). */
  onAdvance?: () => void;
}) {
  const t = useTranslations("lpSlides");

  function handleClick(e: React.MouseEvent) {
    if (!onAdvance) return;
    if ((e.target as HTMLElement).closest("button, input, a, label")) return;
    onAdvance();
  }

  const heading = slide.kind === "checkpoint" ? labels.checkpoint : slide.heading;
  /** Clicks past the instructions: 1+ means the answers are showing. */
  const answers = answerStep(slide, step);
  const visual = hasVisual(slide.visual) ? slide.visual : null;
  // Nothing on a slide may be cut off: the content shrinks its type until it
  // fits (re-checked on every click and resize).
  const contentRef = useRef<HTMLDivElement>(null);
  useFitText(contentRef, `${slide.kind}:${slide.heading}:${step}:${slide.time?.start}`);

  return (
    <div className={`${styles.stage} ${styles[`kind_${slide.kind}`] ?? ""}`} onClick={handleClick}>
      <div className={styles.band} />
      {slide.time ? (
        <div className={styles.phaseBar}>
          <span className={styles.phase}>{labels.phase[slide.phase]}</span>
          <span className={styles.time}>⏱ {labels.minutes(slide.time.start, slide.time.end)}</span>
        </div>
      ) : null}

      <div className={styles.content} ref={contentRef}>
        {slide.kind === "title" ? (
          <div className={styles.titleBlock}>
            {slide.emoji ? <div className={styles.titleEmoji}>{slide.emoji}</div> : null}
            <h1>{slide.heading}</h1>
            {slide.subheading ? <p className={styles.subheading}>{slide.subheading}</p> : null}
            <p className={styles.titleTime}>⏱ {labels.duration(slide.lessonMinutes)}</p>
          </div>
        ) : (
          <h1 className={styles.heading}>
            {slide.kind === "example" ? (
              <span className={styles.chip}>{labels.workedExample(slide.number)}</span>
            ) : slide.kind === "round" ? (
              <span className={styles.chip}>{slide.title}</span>
            ) : slide.kind === "keyWords" ? (
              <span className={styles.chip}>{labels.newWords}</span>
            ) : null}
            {heading}
          </h1>
        )}

        {/* Slides with a visual put it beside their text. */}
        <div className={visual ? styles.withVisual : undefined}>
          <div className={styles.mainCol}>
            {slide.kind === "getReady" ? (
              <>
                <Instructions items={slide.instructions} step={step} />
                <div className={styles.twoCol}>
                  <div>
                    <p className={styles.label}>{labels.youNeed}</p>
                    <ul className={styles.ticks}>
                      {slide.materials.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  </div>
                  <div className={styles.bookBox}>
                    <p className={styles.bookLabel}>✏ {labels.copyIntoBook}</p>
                    <p className={styles.bookDate}>{labels.date}</p>
                    <p className={styles.bookTitle}>{slide.bookTitle}</p>
                    <p>{slide.bookGoal}</p>
                  </div>
                </div>
              </>
            ) : null}

            {slide.kind === "hook" ? (
              <>
                <Instructions items={slide.instructions} step={step} />
                <Frame text={slide.sentenceFrame} />
                {answers >= 1 ? (
                  <ul className={styles.answers}>
                    {slide.answers.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : null}

            {slide.kind === "keyWords" ? (
              <div className={styles.cards}>
                {slide.words.map((w, i) => (
                  <div key={i} className={`${styles.card} ${i <= step ? styles.shown : styles.hidden}`}>
                    {w.emoji ? <span className={styles.cardEmoji}>{w.emoji}</span> : null}
                    <strong>{w.word}</strong>
                    <span className={styles.cardMeaning}>{w.meaning}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {slide.kind === "points" ? (
              <ul className={styles.ticks}>
                {slide.points.map((point, i) => (
                  <li key={i} className={i <= step ? styles.shown : styles.hidden}>
                    {point}
                  </li>
                ))}
              </ul>
            ) : null}

            {slide.kind === "example" ? (
              <>
                <p className={styles.problem}>{slide.problem}</p>
                <ol className={styles.work}>
                  {slide.workSteps.map((ws, i) => (
                    <li key={i} className={i < step ? styles.shown : styles.hidden}>
                      {ws}
                    </li>
                  ))}
                </ol>
                {slide.bookNote.trim() && step > slide.workSteps.length ? (
                  <div className={`${styles.bookBox} ${styles.shown}`}>
                    <p className={styles.bookLabel}>✏ {labels.copyIntoBook}</p>
                    <p>{slide.bookNote}</p>
                  </div>
                ) : null}
              </>
            ) : null}

            {slide.kind === "checkpoint" ? (
              <>
                <p className={styles.question}>{slide.question}</p>
                <Instructions items={slide.instructions} step={step} />
                {slide.answer.trim() ? (
                  answers >= 1 ? (
                    <p className={styles.answer}>
                      <span>{labels.answer}</span>
                      {slide.answer}
                    </p>
                  ) : (
                    <p className={styles.answerHidden}>{t("answerHidden")}</p>
                  )
                ) : null}
              </>
            ) : null}

            {slide.kind === "round" ? (
              <>
                <Instructions items={slide.instructions} step={step} />
                <QuestionList
                  questions={slide.questions}
                  // Answers come one per click, in order among the answered ones.
                  shown={(i) =>
                    slide.questions.slice(0, i + 1).filter((q) => q.answer.trim()).length <= answers
                  }
                />
                <Frame text={slide.sentenceFrame} />
              </>
            ) : null}

            {slide.kind === "exercise" ? (
              <>
                <Instructions items={slide.instructions} step={step} />
                <QuestionList questions={slide.questions} shown={() => answers >= 1} />
                <p className={styles.challenge}>
                  <strong>⭐ {labels.challenge}:</strong> {slide.challenge.question}
                  {answers >= 1 && slide.challenge.answer.trim() ? (
                    <span className={styles.qAnswer}>→ {slide.challenge.answer}</span>
                  ) : null}
                </p>
              </>
            ) : null}

            {slide.kind === "exit" ? (
              <>
                <Instructions items={slide.instructions} step={step} />
                <QuestionList questions={slide.questions} shown={() => answers >= 1} />
              </>
            ) : null}

            {slide.kind === "close" ? (
              <div className={styles.twoCol}>
                <div>
                  <p className={styles.label}>{labels.recap}</p>
                  <ul className={styles.ticks}>
                    {slide.recap.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                  {slide.homework.trim() ? (
                    <div className={styles.bookBox}>
                      <p className={styles.bookLabel}>🏠 {labels.homework}</p>
                      <p>{slide.homework}</p>
                    </div>
                  ) : null}
                </div>
                <div>
                  <p className={styles.label}>{labels.thumbs}</p>
                  <ul className={styles.selfCheck}>
                    {slide.selfCheck.map((sc, i) => (
                      <li key={i}>
                        <span aria-hidden="true">👍 👌 👎</span>
                        {sc}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}
          </div>
          {visual ? <VisualView visual={visual} /> : null}
        </div>
      </div>

      {timer || picker ? (
        <div className={styles.widgets}>
          {timer ? (
            <div className={`${styles.timer} ${timer.remaining === 0 ? styles.timeUp : ""}`}>
              <span className={styles.timerDisplay} aria-live="polite">
                {timer.remaining === 0 ? t("timeUp") : mmss(timer.remaining)}
              </span>
              <button type="button" onClick={timer.toggle}>
                {timer.running ? t("timerPause") : t("timerStart")}
              </button>
              <button type="button" onClick={timer.reset}>
                {t("timerReset")}
              </button>
            </div>
          ) : null}
          {picker ? (
            <div className={styles.picker}>
              <button type="button" onClick={picker.pick}>
                {t("pick")}
              </button>
              {picker.picked !== null ? (
                <span className={styles.pickedNumber} aria-live="polite">
                  {t("pupil", { n: picker.picked })}
                </span>
              ) : null}
              <label className={styles.classSize}>
                {t("classSize")}
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={picker.classSize}
                  onChange={(e) => picker.setClassSize(Number(e.target.value))}
                />
              </label>
              {picker.wrapped ? <span className={styles.pickNote}>{t("everyonePicked")}</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={styles.progress} style={{ width: `${progress * 100}%` }} />
    </div>
  );
}

/** Smallest a box's type may shrink to, as a share of its normal size. */
const MIN_FIT = 0.55;

/**
 * Shrink a box's type (its `--fit` multiplier) until its content fits without
 * overflowing, down to MIN_FIT. Runs before paint whenever `key` changes and
 * whenever the box is resized (full screen, a different projector).
 */
function useFitText(ref: React.RefObject<HTMLElement | null>, key: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      let scale = 1;
      el.style.setProperty("--fit", "1");
      while (el.scrollHeight > el.clientHeight + 1 && scale > MIN_FIT) {
        scale = Math.max(MIN_FIT, +(scale - 0.05).toFixed(2));
        el.style.setProperty("--fit", String(scale));
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, key]);
}

function Frame({ text }: { text: string }) {
  return text.trim() ? <p className={styles.frame}>{text}</p> : null;
}

/* ── presenter extras ──────────────────────────────────────────────────── */

function ExtrasPanel({ slide, extras }: { slide: Slide; extras: TeacherExtras }) {
  const t = useTranslations("lpSlides");
  return (
    <>
      {slide.extras.includes("misconceptions") && extras.misconceptions.length > 0 ? (
        <>
          <h2>{t("misconceptions")}</h2>
          <ul>
            {extras.misconceptions.map((m, i) => (
              <li key={i}>
                <strong>{m.misconception}</strong> {m.description}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {slide.extras.includes("watchFor") && extras.watchFor.length > 0 ? (
        <>
          <h2>{t("watchFor")}</h2>
          <ul>
            {extras.watchFor.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </>
      ) : null}
      {slide.extras.includes("differentiation") ? (
        <>
          <h2>{t("differentiation")}</h2>
          <ul>
            <li>
              <strong>{t("remedial")}:</strong> {extras.differentiation.remedial}
            </li>
            <li>
              <strong>{t("support")}:</strong> {extras.differentiation.support}
            </li>
            <li>
              <strong>{t("challenge")}:</strong> {extras.differentiation.challenge}
            </li>
          </ul>
        </>
      ) : null}
    </>
  );
}
