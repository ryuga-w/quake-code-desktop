import React, { useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import type { WebPlanClarificationAnswer, WebPlanClarificationState } from "../../../../shared/protocol";
import styles from "./PlanQuestionsPanel.module.css";

export function PlanQuestionsPanel({
  clarification,
  onComplete,
  onSkip,
}: {
  clarification?: WebPlanClarificationState;
  onComplete: (args: { requestId: string; clarificationId: string; answers: Record<string, WebPlanClarificationAnswer> }) => Promise<void>;
  onSkip: (args: { requestId: string; clarificationId: string }) => Promise<void>;
}) {
  if (!clarification || clarification.status !== "pending") return null;
  return <QuestionsCard key={`${clarification.requestId}:${clarification.id}`} clarification={clarification} onComplete={onComplete} onSkip={onSkip} />;
}

function QuestionsCard({ clarification, onComplete, onSkip }: {
  clarification: WebPlanClarificationState;
  onComplete: (args: { requestId: string; clarificationId: string; answers: Record<string, WebPlanClarificationAnswer> }) => Promise<void>;
  onSkip: (args: { requestId: string; clarificationId: string }) => Promise<void>;
}) {
  const requestId = clarification.requestId || "";
  const [answers, setAnswers] = useState<Record<string, WebPlanClarificationAnswer>>(() => Object.fromEntries(
    clarification.questions.filter((question) => question.answer).map((question) => [question.id, question.answer!]),
  ));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, clarification.questions.findIndex((question) => !question.answer)));
  const [submitting, setSubmitting] = useState(false);
  if (!requestId || clarification.questions.length === 0) return null;

  const chooseOption = (questionId: string, optionId: string) => {
    setAnswers((current) => ({ ...current, [questionId]: { optionId } }));
  };
  const chooseOther = (questionId: string) => {
    setAnswers((current) => ({ ...current, [questionId]: { text: drafts[questionId] || "" } }));
  };
  const updateText = (questionId: string, text: string) => {
    setDrafts((current) => ({ ...current, [questionId]: text }));
    setAnswers((current) => ({ ...current, [questionId]: { text } }));
  };
  const submit = async () => {
    if (submitting) return;
    const finalAnswers = Object.fromEntries(clarification.questions.map((question) => {
      const selected = answers[question.id];
      const answer = (selected?.optionId ? { optionId: selected.optionId } : undefined)
        || (selected?.text?.trim() ? { text: selected.text.trim() } : undefined)
        || (drafts[question.id]?.trim() ? { text: drafts[question.id].trim() } : undefined)
        || (question.recommendedOptionId ? { optionId: question.recommendedOptionId } : undefined)
        || (question.options?.[0]?.id ? { optionId: question.options[0].id } : { skipped: true });
      return [question.id, answer];
    }));
    setSubmitting(true);
    try {
      await onComplete({ requestId, clarificationId: clarification.id, answers: finalAnswers });
    } catch {
      setSubmitting(false);
    }
  };
  const advance = () => {
    if (activeIndex < clarification.questions.length - 1) setActiveIndex((value) => value + 1);
    else void submit();
  };
  const skip = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onSkip({ requestId, clarificationId: clarification.id });
    } catch {
      setSubmitting(false);
    }
  };

  return <section className={styles.root} aria-label="Plan soruları">
    <header className={styles.header}>
      <span>Questions</span>
      <div className={styles.progress}>
        <button type="button" aria-label="Önceki soru" disabled={activeIndex === 0} onClick={() => setActiveIndex((value) => Math.max(0, value - 1))}><ChevronLeft size={14} /></button>
        <b>{activeIndex + 1} of {clarification.questions.length}</b>
        <button type="button" aria-label="Sonraki soru" disabled={activeIndex === clarification.questions.length - 1} onClick={() => setActiveIndex((value) => Math.min(clarification.questions.length - 1, value + 1))}><ChevronRight size={14} /></button>
        <ChevronDown size={14} aria-hidden="true" />
      </div>
    </header>

    <div className={styles.list}>
      {clarification.questions.map((question, questionIndex) => {
        const currentAnswer = answers[question.id];
        const otherSelected = Object.prototype.hasOwnProperty.call(currentAnswer || {}, "text");
        return <div className={styles.question} key={question.id} onClick={() => setActiveIndex(questionIndex)}>
          <div className={styles.label}>{question.label}</div>
          {question.detail && <div className={styles.detail}>{question.detail}</div>}
          {question.options?.length ? <div className={styles.options}>
            {question.options.map((option, optionIndex) => <button
              type="button"
              className={`${styles.option} ${currentAnswer?.optionId === option.id ? styles.selected : ""}`}
              onClick={() => chooseOption(question.id, option.id)}
              key={option.id}
            >
              <span className={styles.optionKey}>{String.fromCharCode(65 + optionIndex)}</span>
              <span className={styles.optionCopy}>{option.label}{option.description && <small> — {option.description}</small>}</span>
            </button>)}
            <button type="button" className={`${styles.option} ${otherSelected ? styles.selected : ""}`} onClick={() => chooseOther(question.id)}>
              <span className={styles.optionKey}>{String.fromCharCode(65 + question.options.length)}</span>
              <span className={styles.optionCopy}>Other...</span>
            </button>
            {otherSelected && <input className={styles.otherInput} autoFocus value={drafts[question.id] || ""} onChange={(event) => updateText(question.id, event.target.value)} placeholder="Kendi cevabın…" />}
          </div> : <textarea className={styles.textInput} value={drafts[question.id] || ""} onChange={(event) => updateText(question.id, event.target.value)} placeholder="Kısa yanıtın…" rows={2} />}
        </div>;
      })}
    </div>

    <footer className={styles.actions}>
      <button type="button" className={styles.skip} disabled={submitting} onClick={() => void skip()}>Skip</button>
      <button type="button" className={styles.next} disabled={submitting} onClick={advance}>{activeIndex < clarification.questions.length - 1 ? "Next" : submitting ? "Sending" : "Submit"}<span>↵</span></button>
    </footer>
  </section>;
}
