export interface UndoEntry<T> {
  id: string;
  timestamp: number;
  description: string;
  before: T;
  after: T;
}

export class UndoStack<T> {
  private undoStack: UndoEntry<T>[] = [];
  private redoStack: UndoEntry<T>[] = [];
  private maxSize: number;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  push(entry: Omit<UndoEntry<T>, "id" | "timestamp">): void {
    this.undoStack.push({
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: Date.now(),
    });
    this.redoStack = [];
    if (this.undoStack.length > this.maxSize) {
      this.undoStack.shift();
    }
  }

  undo(): UndoEntry<T> | undefined {
    const entry = this.undoStack.pop();
    if (entry) this.redoStack.push(entry);
    return entry;
  }

  redo(): UndoEntry<T> | undefined {
    const entry = this.redoStack.pop();
    if (entry) this.undoStack.push(entry);
    return entry;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  get history(): UndoEntry<T>[] {
    return [...this.undoStack];
  }
}

export class FileUndoManager {
  private stacks = new Map<string, UndoStack<string>>();

  getStack(filePath: string): UndoStack<string> {
    if (!this.stacks.has(filePath)) {
      this.stacks.set(filePath, new UndoStack<string>());
    }
    return this.stacks.get(filePath)!;
  }

  pushEdit(filePath: string, before: string, after: string, description: string): void {
    this.getStack(filePath).push({ description, before, after });
  }

  undo(filePath: string): string | undefined {
    return this.getStack(filePath).undo()?.before;
  }

  redo(filePath: string): string | undefined {
    return this.getStack(filePath).redo()?.after;
  }

  canUndo(filePath: string): boolean {
    return this.getStack(filePath).canUndo();
  }

  canRedo(filePath: string): boolean {
    return this.getStack(filePath).canRedo();
  }

  clear(filePath: string): void {
    this.stacks.get(filePath)?.clear();
  }

  clearAll(): void {
    this.stacks.clear();
  }
}

export const fileUndoManager = new FileUndoManager();
