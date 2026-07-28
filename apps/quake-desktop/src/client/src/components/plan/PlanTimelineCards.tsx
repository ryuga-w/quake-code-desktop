import React from "react";
import { ChevronRight, ListTodo } from "lucide-react";
import { useI18n } from "../../i18n";
import { MarkdownMessage } from "../markdown/MarkdownMessage";
import styles from "./PlanTimelineCards.module.css";

export function CreatedPlanCard({
  title,
  markdown,
  onOpen,
  onOpenFile,
}: {
  title: string;
  markdown?: string;
  onOpen: () => void;
  onOpenFile: (path: string) => void;
}) {
  const { t } = useI18n();
  const documentRef = React.useRef<HTMLDivElement>(null);
  const [fadeEdges, setFadeEdges] = React.useState({ top: false, bottom: false });
  const syncFadeEdges = React.useCallback(() => {
    const document = documentRef.current;
    if (!document) return;
    const next = {
      top: document.scrollTop > 3,
      bottom: document.scrollTop + document.clientHeight < document.scrollHeight - 3,
    };
    setFadeEdges((current) => current.top === next.top && current.bottom === next.bottom ? current : next);
  }, []);

  React.useEffect(() => {
    const document = documentRef.current;
    if (!document) return;
    const frame = requestAnimationFrame(syncFadeEdges);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(syncFadeEdges);
    observer?.observe(document);
    if (document.firstElementChild instanceof HTMLElement) observer?.observe(document.firstElementChild);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [markdown, syncFadeEdges]);

  return <section className={styles.created} aria-label={t("runtime.plan.planFor", { title })}>
    <header>
      <span><ListTodo size={13} strokeWidth={1.8} aria-hidden="true" />{t("runtime.plan.panel")}</span>
      <button type="button" onClick={onOpen} aria-label={t("runtime.plan.openPlanPanel", { title })} title={t("runtime.plan.openPlan")}>
        <ChevronRight size={15} aria-hidden="true" />
      </button>
    </header>
    <div className={styles.documentFrame} data-fade-top={fadeEdges.top} data-fade-bottom={fadeEdges.bottom}>
      <div ref={documentRef} className={styles.document} onScroll={syncFadeEdges}>
        {markdown
          ? <MarkdownMessage text={markdown} onOpenFile={onOpenFile} />
          : <h3>{title}</h3>}
      </div>
    </div>
  </section>;
}
