export interface ExclusiveLock {
  run<T>(name: string, operation: () => Promise<T>): Promise<T>;
}

export class InProcessExclusiveLock implements ExclusiveLock {
  private static readonly tails = new Map<string, Promise<void>>();

  async run<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const previous = InProcessExclusiveLock.tails.get(name) ?? Promise.resolve();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => gate);
    InProcessExclusiveLock.tails.set(name, tail);

    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (InProcessExclusiveLock.tails.get(name) === tail) {
        InProcessExclusiveLock.tails.delete(name);
      }
    }
  }
}

interface BrowserLockManager {
  request<T>(
    name: string,
    options: { mode: "exclusive" },
    operation: () => Promise<T>,
  ): Promise<T>;
}

export class WebLocksExclusiveLock implements ExclusiveLock {
  constructor(private readonly locks: BrowserLockManager) {}

  run<T>(name: string, operation: () => Promise<T>): Promise<T> {
    return this.locks.request(name, { mode: "exclusive" }, operation);
  }
}

const inProcessLock = new InProcessExclusiveLock();

export function createBrowserExclusiveLock(): ExclusiveLock {
  const browserNavigator = globalThis.navigator as Navigator & {
    locks?: BrowserLockManager;
  };
  return browserNavigator.locks
    ? new WebLocksExclusiveLock(browserNavigator.locks)
    : inProcessLock;
}

export const defaultExclusiveLock: ExclusiveLock = inProcessLock;
