import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const clientRoot = join(root, "src/client");

function collectTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectTsxFiles(path);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [path] : [];
  });
}

function containsJsx(sourceFile: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function hasReactRuntimeBinding(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some((statement) => (
    ts.isImportDeclaration(statement)
    && statement.moduleSpecifier.getText(sourceFile) === '"react"'
    && statement.importClause?.name?.text === "React"
  ));
}

describe("desktop React runtime source contract", () => {
  it("keeps a React binding in every TSX module that renders JSX", () => {
    const missingBindings = collectTsxFiles(clientRoot).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      return containsJsx(sourceFile) && !hasReactRuntimeBinding(sourceFile)
        ? [relative(root, path).replaceAll("\\", "/")]
        : [];
    });

    expect(missingBindings).toEqual([]);
  });
});
