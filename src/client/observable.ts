/**
 * 最小可观测引擎 + localStorage 容错读写 —— 摘自 dsh-trading
 * packages/client-ui-trading/src/client/store.ts L16-50（源 commit 70ca2d8）。
 * 摘取范围：通用观测引擎与 storage 容错段；该文件的终端 store
 * （instrument selection / watchlists）不搬（归属见 docs/carryover.md 台账）。
 * 原文照搬，未改逻辑。
 */

/** Minimal observable face — matches the slot kit's HostObservable contract. */
export interface Observable<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

export interface WritableObservable<T> extends Observable<T> {
  set(next: T): void
  update(mutator: (current: T) => T): void
}

export function createObservable<T>(initial: T): WritableObservable<T> {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(next) {
      snapshot = next
      for (const listener of [...listeners]) listener()
    },
    update(mutator) {
      this.set(mutator(snapshot))
    },
  }
}

/** localStorage read that survives unavailable storage (privacy mode) and corrupt JSON. */
export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** localStorage write that survives unavailable storage. */
export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable — session-only degradation */
  }
}
