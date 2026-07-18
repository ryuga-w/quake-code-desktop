import React, { useState, useCallback, useRef } from "react";
import { FolderInput } from "lucide-react";
import { apiPost } from "../../lib/api";
import { useAppStore } from "../../state/app-store";
import styles from "./DropZone.module.css";

interface DropZoneProps {
  onFilesUploaded?: (files: string[]) => void;
  children: React.ReactNode;
}

function isComposerDropTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('[data-composer-drop-zone="true"]'));
}

export function DropZone({ onFilesUploaded, children }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const dragCountRef = useRef(0);
  const showToast = useAppStore((s) => s.showToast);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isComposerDropTarget(e.target)) {
      dragCountRef.current = 0;
      setIsDragging(false);
      return;
    }
    dragCountRef.current += 1;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isComposerDropTarget(e.target)) {
      dragCountRef.current = 0;
      setIsDragging(false);
      return;
    }
    dragCountRef.current = Math.max(0, dragCountRef.current - 1);
    if (dragCountRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    if (isComposerDropTarget(e.target)) {
      dragCountRef.current = 0;
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current = 0;
    setIsDragging(false);

    // Composer owns its drop surface. Never upload the same dropped files to
    // the workspace root after they were attached to the prompt.
    if (isComposerDropTarget(e.target)) return;

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const validFiles = files.filter((f) => {
      if (f.size > 10 * 1024 * 1024) {
        showToast(`${f.name} çok büyük (>10MB)`, "warning");
        return false;
      }
      return true;
    });

    if (validFiles.length === 0) return;

    setUploading(true);
    setProgress(0);

    const uploaded: string[] = [];
    for (let i = 0; i < validFiles.length; i++) {
      const file = validFiles[i];
      try {
        const content = await readFileAsText(file);
        const result = await apiPost<{ path: string }>("/api/file/write", {
          path: file.name,
          content,
          createBackup: false,
        });
        uploaded.push(result.path);
      } catch (error: any) {
        showToast(`${file.name} yüklenemedi: ${error.message}`, "error");
      }
      setProgress(Math.round(((i + 1) / validFiles.length) * 100));
    }

    setUploading(false);
    if (uploaded.length > 0) {
      showToast(`${uploaded.length} dosya yüklendi`, "success");
      onFilesUploaded?.(uploaded);
    }
  }, [onFilesUploaded, showToast]);

  return (
    <div
      className={styles.dropZone}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}
      {isDragging && (
        <div className={styles.overlay}>
          <div className={styles.message}>
            <span className={styles.icon} aria-hidden="true"><FolderInput size={28} /></span>
            <span>Dosyaları buraya bırakın</span>
          </div>
        </div>
      )}
      {uploading && (
        <div className={styles.progressBar}>
          <div className={styles.progress} style={{ width: `${progress}%` }} />
          <span className={styles.progressText}>Yükleniyor… {progress}%</span>
        </div>
      )}
    </div>
  );
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Dosya okunamadı"));
    reader.readAsText(file);
  });
}
