import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const shell = read("src/client/src/app/AppShell.tsx");
const files = read("src/client/src/components/files/FilesPanel.tsx");
const fileStyles = read("src/client/src/components/files/FilesPanel.module.css");
const preview = read("src/client/src/components/preview/PreviewPanel.tsx");
const globalStyles = read("src/client/styles.css");

describe("Codex-style files workbench", () => {
  it("keeps an always-mounted preview beside a narrow tree in wide layouts", () => {
    expect(shell).toContain('className={`files-workbench ${filePreview.path ? "has-preview" : ""} ${filesTreeOpen ? "files-tree-open" : "files-tree-closed"}`}');
    expect(shell).toContain('<div className="files-workbench-preview"><PreviewPanel');
    expect(globalStyles).toMatch(/\.files-workbench\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) 7px var\(--files-tree-width, 190px\)/);
    expect(globalStyles).toMatch(/\.files-workbench-preview\s*\{[\s\S]*?display:\s*block/);
    expect(globalStyles).toContain("backdrop-filter: none");
  });

  it("shows the reference empty file surface before a file is selected", () => {
    expect(preview).toContain('className="preview-panel-github preview-empty-shell"');
    expect(preview).toContain('className="preview-empty-path">/</div>');
    expect(preview).toContain("<FolderOpen");
    expect(preview).toContain("Çalışma alanı ağacından bir dosya seç");
  });

  it("reduces explorer chrome to search plus one options menu", () => {
    expect(files).toContain('placeholder="Dosyaları filtrele…"');
    expect(files).toContain('className={styles.optionsMenu}');
    expect(files).toContain('FILE_TREE_REFERENCE_DEFAULTS_KEY = "quake-web:fileTreeReferenceDefaultsV1"');
    expect(files).toContain('writeStorageValue("quake-web:showHiddenFiles", "1")');
    expect(files).toContain('writeStorageValue("quake-web:showGeneratedFiles", "1")');
    expect(files).not.toContain("styles.breadcrumb");
    expect(files).not.toContain("styles.filterBar");
    expect(files).not.toContain("styles.statusBar");
    expect(fileStyles).toMatch(/\.directory \.fileIcon\s*\{[\s\S]*?display:\s*none/);
  });

  it("previews on one click and uses a single-surface mobile fallback", () => {
    expect(files).toContain("if (!isDirectory) props.onOpenFile(entry.path)");
    expect(globalStyles).toContain(".files-workbench.files-tree-closed .files-workbench-tree { display: none; }");
    expect(globalStyles).toContain(".files-workbench.files-tree-open .files-workbench-preview { display: none; }");
    expect(globalStyles).toContain("@media (max-width: 640px)");
  });

  it("renders Markdown as a document and names the active file tab", () => {
    expect(preview).toContain('isMarkdown = language === "markdown"');
    expect(preview).toContain("<MarkdownContent");
    expect(preview).toContain("Kaynağı görüntüle");
    expect(shell).toContain('filesTitle={filePreview.path ?');
    expect(globalStyles).toContain(".preview-markdown-document");
  });

  it("toggles and resizes the right tree with persisted pointer and keyboard controls", () => {
    expect(shell).toContain('readStorageValue("quake-web:filesTreeOpen", "1")');
    expect(shell).toContain('readStorageValue("quake-web:filesTreeWidth"');
    expect(shell).toContain('writeStorageValue("quake-web:filesTreeWidth"');
    expect(shell).toContain("handleFilesTreeResizeStart");
    expect(shell).toContain("handleFilesTreeResizeKey");
    expect(shell).toContain('className="files-tree-resize-handle"');
    expect(shell).toContain('role="separator"');
    expect(shell).toContain('filesTreeOpen={filesTreeOpen}');
    expect(globalStyles).toContain(".files-tree-resize-handle");
    expect(globalStyles).toContain("cursor: col-resize");
  });
});
