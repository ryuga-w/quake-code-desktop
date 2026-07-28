export class AsyncLock {
  private tail = Promise.resolve();

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export class SingleFlight {
  private active = false;

  async run<T>(label: string, fn: () => Promise<T>): Promise<T> {
    if (this.active) {
      throw new Error(`${label} is already running`);
    }
    this.active = true;
    try {
      return await fn();
    } finally {
      this.active = false;
    }
  }

  get isActive(): boolean {
    return this.active;
  }
}
