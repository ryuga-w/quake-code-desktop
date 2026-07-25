import React, { useEffect, useRef } from "react";
import { Folder, FolderOpen, FolderPlus, Sparkles, Ban } from "lucide-react";
import { focusFirstMenuItem, handleMenuKeyDown, restoreMenuTriggerFocus } from "../../lib/menu-keyboard";
import styles from "./ProjectPicker.module.css";

export type ProjectPickerItem = {
  name: string;
  path: string;
  open?: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  projects: ProjectPickerItem[];
  activePath: string;
  noProject: boolean;
  onSelectProject: (path: string) => void;
  onNewProject: () => void;
  onQuickStart: () => void;
  onNoProject: () => void;
  /** Anchor: 'chip' for empty title, 'menu' for floating */
  label?: string;
  onToggle?: () => void;
  showChip?: boolean;
};

export function ProjectPicker({
  open,
  onClose,
  projects,
  activePath,
  noProject,
  onSelectProject,
  onNewProject,
  onQuickStart,
  onNoProject,
  label,
  onToggle,
  showChip = true,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [menuBounds, setMenuBounds] = React.useState<{ placement: "above" | "below"; maxHeight: number } | null>(null);

  const closeAndRestoreFocus = React.useCallback(() => {
    onClose();
    restoreMenuTriggerFocus(restoreFocusRef.current ?? triggerRef.current);
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const activeElement = document.activeElement;
    restoreFocusRef.current = triggerRef.current
      ?? (activeElement instanceof HTMLElement ? activeElement : null);
    focusFirstMenuItem(menuRef.current);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeAndRestoreFocus();
      }
    };
    // capture: true — boş alan / overlay tıklamaları kaçmasın
    const onPointerDown = (e: Event) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    // Açan tıklama aynı anda kapatmasın
    const timer = window.setTimeout(() => {
      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("mousedown", onPointerDown, true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("mousedown", onPointerDown, true);
    };
  }, [open, onClose, closeAndRestoreFocus]);

  useEffect(() => {
    if (!open) {
      setMenuBounds(null);
      return;
    }

    const updateMenuBounds = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
      const edgeGap = 16;
      const menuGap = 6;
      const roomBelow = viewportBottom - rect.bottom - edgeGap - menuGap;
      const roomAbove = rect.top - viewportTop - edgeGap - menuGap;
      const placement = roomBelow < 260 && roomAbove > roomBelow ? "above" : "below";
      const availableHeight = placement === "above" ? roomAbove : roomBelow;

      setMenuBounds({
        placement,
        maxHeight: Math.max(160, Math.min(440, Math.floor(availableHeight))),
      });
    };

    updateMenuBounds();
    window.addEventListener("resize", updateMenuBounds);
    window.visualViewport?.addEventListener("resize", updateMenuBounds);
    return () => {
      window.removeEventListener("resize", updateMenuBounds);
      window.visualViewport?.removeEventListener("resize", updateMenuBounds);
    };
  }, [open]);

  const activeKey = activePath.replace(/[\\/]+$/, "").toLowerCase();
  const activeFromList = projects.find(
    (p) => p.path.replace(/[\\/]+$/, "").toLowerCase() === activeKey,
  )?.name;
  const folderFromPath = activePath
    ? activePath.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop()
    : "";
  // Chip always shows the selected workspace (folder name), never "Yeni sohbet".
  const title = noProject
    ? "No Project"
    : activeFromList || label || folderFromPath || "Proje seç";
  const openProjects = projects.filter((project) => project.open);
  const recentProjects = projects.filter((project) => !project.open);

  const renderProjects = (items: ProjectPickerItem[], label: string) => items.length > 0 ? (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>{label}</span>
      {items.map((project) => {
        const key = project.path.replace(/[\\/]+$/, "").toLowerCase();
        const active = !noProject && key === activeKey;
        return (
          <button
            key={project.path}
            type="button"
            role="menuitem"
            className={`${styles.item} ${active ? styles.itemActive : ""}`}
            onClick={() => onSelectProject(project.path)}
            title={project.path}
          >
            {project.open ? <FolderOpen size={14} strokeWidth={1.9} aria-hidden="true" /> : <Folder size={14} strokeWidth={1.9} aria-hidden="true" />}
            <span>{project.name}</span>
            {project.open && <i className={styles.openIndicator} title="Bu pencerede açık" aria-label="Bu pencerede açık" />}
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <div ref={rootRef} className={styles.root}>
      {showChip && (
        <button
          ref={triggerRef}
          type="button"
          className={`${styles.chip} ${open ? styles.chipOpen : ""}`}
          onClick={onToggle}
          aria-expanded={open}
          aria-haspopup="menu"
        >
          <span className={styles.chipLabel}>{title}</span>
          <svg className={styles.chevron} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      )}

      {open && (
        <div
          ref={menuRef}
          className={`${styles.menu} ${menuBounds?.placement === "above" ? styles.menuAbove : ""}`}
          style={menuBounds ? { maxHeight: menuBounds.maxHeight } : undefined}
          role="menu"
          aria-label="Proje seç"
          onKeyDown={(event) => handleMenuKeyDown(event, { onEscape: closeAndRestoreFocus })}
        >
          {renderProjects(openProjects, "Açık kökler")}
          {openProjects.length > 0 && recentProjects.length > 0 && <div className={styles.projectDivider} />}
          {renderProjects(recentProjects, "Son kullanılanlar")}

          <div className={styles.divider} />

          <div className={styles.section}>
            <button type="button" role="menuitem" className={styles.item} onClick={onNewProject}>
              <FolderPlus size={14} strokeWidth={1.9} aria-hidden="true" />
              <span>New Project</span>
            </button>
            <button type="button" role="menuitem" className={styles.item} onClick={onQuickStart}>
              <Sparkles size={14} strokeWidth={1.9} aria-hidden="true" />
              <span>Quick Start</span>
            </button>
            <button type="button" role="menuitem" className={`${styles.item} ${noProject ? styles.itemActive : ""}`} onClick={onNoProject}>
              <Ban size={14} strokeWidth={1.9} aria-hidden="true" />
              <span>No Project</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type CreateProjectModalProps = {
  open: boolean;
  onClose: () => void;
  onAddFolder: () => void;
  onSkip: () => void;
};

export function CreateProjectModal({ open, onClose, onAddFolder, onSkip }: CreateProjectModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    // Backdrop dışı / herhangi bir boş alan: capture ile kapat
    const onPointerDown = (e: Event) => {
      const target = e.target as Node | null;
      if (!target) return;
      // Kartın içi → kapatma
      if (dialogRef.current?.contains(target)) return;
      // Backdrop veya başka her şey → kapat
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    // Küçük gecikme: açan tıklama aynı frame'de modalı kapatmasın
    const timer = window.setTimeout(() => {
      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("mousedown", onPointerDown, true);
    }, 0);
    dialogRef.current?.focus();
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("mousedown", onPointerDown, true);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={backdropRef}
      className={styles.modalBackdrop}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="Create Project"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.modalHead}>
          <h2>Create Project</h2>
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Kapat">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <p className={styles.modalHint}>Select Folder(s)</p>
        <button type="button" className={styles.addFolderBtn} onClick={onAddFolder}>
          + Add Folder(s)
        </button>
        <div className={styles.modalFoot}>
          <button type="button" className={styles.skipBtn} onClick={onSkip}>
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}

export default ProjectPicker;
