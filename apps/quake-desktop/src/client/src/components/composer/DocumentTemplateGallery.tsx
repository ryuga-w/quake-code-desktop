import React from "react";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import type { WebArtifactTemplate } from "../../../../shared/protocol";
import { apiGet, apiGetBlob } from "../../lib/api";
import styles from "./DocumentTemplateGallery.module.css";

type Props = {
  onSelect: (template: WebArtifactTemplate) => void;
};

export function DocumentTemplateGallery({ onSelect }: Props) {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const [templates, setTemplates] = React.useState<WebArtifactTemplate[]>([]);
  const [previewUrls, setPreviewUrls] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(true);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);
  const [scrollState, setScrollState] = React.useState({ start: true, end: false });

  const updateScrollState = React.useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    setScrollState({
      start: track.scrollLeft <= 2,
      end: track.scrollLeft + track.clientWidth >= track.scrollWidth - 2,
    });
  }, []);

  React.useEffect(() => {
    if (templates.length === 0) {
      setPreviewUrls({});
      return;
    }
    let active = true;
    const objectUrls: string[] = [];
    void Promise.all(templates.map(async (template) => {
      try {
        const blob = await apiGetBlob(template.previewUrl);
        if (!active) return undefined;
        const objectUrl = URL.createObjectURL(blob);
        objectUrls.push(objectUrl);
        return [template.id, objectUrl] as const;
      } catch {
        return undefined;
      }
    })).then((entries) => {
      if (!active) return;
      setPreviewUrls(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry))));
    });
    return () => {
      active = false;
      for (const objectUrl of objectUrls) URL.revokeObjectURL(objectUrl);
    };
  }, [templates]);

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    void apiGet<{ templates?: WebArtifactTemplate[] }>("/api/artifact-templates?kind=document")
      .then((payload) => {
        if (!active) return;
        setTemplates(Array.isArray(payload.templates) ? payload.templates : []);
        setLoadFailed(false);
      })
      .catch(() => {
        if (!active) return;
        setTemplates([]);
        setLoadFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    updateScrollState();
  }, [templates.length, updateScrollState]);

  if (dismissed) return null;

  const scroll = (direction: -1 | 1) => {
    trackRef.current?.scrollBy({ left: direction * 320, behavior: "smooth" });
  };

  return (
    <section className={styles.gallery} aria-label="Belge şablonları">
      <header className={styles.header}>
        <span>Şablonlar</span>
        <div className={styles.headerActions}>
          <button type="button" disabled={scrollState.start} aria-label="Önceki şablonlar" onClick={() => scroll(-1)}>
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button type="button" disabled={scrollState.end} aria-label="Sonraki şablonlar" onClick={() => scroll(1)}>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
          <button type="button" aria-label="Şablonları kapat" onClick={() => setDismissed(true)}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className={styles.track} ref={trackRef} onScroll={updateScrollState} aria-busy={loading ? "true" : undefined}>
        {loading ? <TemplateSkeletons /> : null}
        {!loading && loadFailed ? <div className={styles.catalogNotice}>Yerel şablon kataloğu okunamadı.</div> : null}
        {!loading && !loadFailed && templates.length === 0 ? <div className={styles.catalogNotice}>Belge şablonu bulunamadı.</div> : null}
        {!loading ? templates.map((template) => (
          <button
            type="button"
            className={styles.template}
            key={template.id}
            title={template.description}
            onClick={() => onSelect(template)}
          >
            <span className={styles.paper} aria-hidden="true">
              {previewUrls[template.id]
                ? <img src={previewUrls[template.id]} alt="" loading="lazy" draggable={false} />
                : <span className={styles.previewPlaceholder} />}
            </span>
            <span className={styles.label}>{template.displayName}</span>
          </button>
        )) : null}
        {!loading && !loadFailed ? (
          <button
            type="button"
            className={`${styles.template} ${styles.createTemplate}`}
            onClick={() => onSelect({
              id: "artifact-template-custom-document",
              skillName: "docx",
              displayName: "Şablon oluştur",
              description: "Create a reusable custom document template",
              defaultPrompt: "Create a reusable custom document template.",
              kind: "document",
              previewUrl: "",
            })}
          >
            <span className={styles.createPreview} aria-hidden="true"><Plus size={22} /></span>
            <span className={styles.label}>Şablon oluştur</span>
          </button>
        ) : null}
      </div>
    </section>
  );
}

function TemplateSkeletons() {
  return <>{Array.from({ length: 5 }, (_, index) => (
    <div className={styles.templateSkeleton} aria-hidden="true" key={index}>
      <span />
      <i />
    </div>
  ))}</>;
}
