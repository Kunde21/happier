import type { MMKV } from 'react-native-mmkv';

/**
 * Global byte budget for the DISPOSABLE namespaces this app keeps in the web origin's
 * localStorage (through react-native-mmkv's web adapter), plus the recovery contract for the
 * platform's hard per-origin quota.
 *
 * Why: WebKitGTK enforces roughly 5 MiB per origin on `setItem` with a `QuotaExceededError`
 * and Tauri exposes no knob to raise it (independently corroborated by the block/buzz desktop
 * app's identical finding). Durable small state — settings, permission modes, drafts — shares
 * that origin with warm caches, so an unbounded disposable record eventually breaks every
 * durable write in the app. The budget keeps disposables collectively below a fraction of the
 * ceiling and turns a platform refusal into eviction + one retry, so durable writes keep
 * landing.
 *
 * Ownership: this wrapper is the single budget owner for both web storage choke points
 * (`persistence.getPersistenceStorage`, `warmCachePersistence.getWarmCacheStorage`). Eviction
 * is default-deny: ONLY keys under the caller's `disposablePrefixes` are ever reclaimed;
 * everything else (durable) survives budget pressure and is recovered-for, not evicted.
 */

/**
 * Collective ceiling for disposable records: the ~5 MiB origin quota minus the observed durable
 * footprint (~0.3 MiB: settings, modes, profile caches) leaves ≥2.7 MiB of headroom; holding
 * disposables at 2 MiB keeps the origin comfortably below the refusal point even while durable
 * keys grow or the SQLite layer holds checkpoint state.
 */
export const WEB_STORAGE_DISPOSABLE_BUDGET_BYTES = 2 * 1024 * 1024;

/**
 * Largest single disposable record: a warm-cache entry worth more than a quarter of the
 * collective budget is the wrong shape for this origin (the session-list entries observed in
 * the quota incident were ~140 KiB). Oversized entries are rejected with a warning instead of
 * evicting the rest of the namespace to admit them.
 */
export const WEB_STORAGE_MAX_DISPOSABLE_ENTRY_BYTES = Math.floor(WEB_STORAGE_DISPOSABLE_BUDGET_BYTES / 4);

/** UTF-16 storage cost of a key and its string value: two bytes per code unit, key included. */
export function utf16ByteLength(key: string, value: string): number {
    return 2 * (key.length + value.length);
}

let writeSequence = 0;

interface BudgetIndexEntry {
    seq: number;
    bytes: number;
}

type StorageLike = Pick<MMKV, 'getString' | 'set' | 'delete' | 'getAllKeys'>;

const BUDGET_INDEX_KEY = '__web-storage-budget-index__';

/**
 * One budget owner per underlying store instance: both web storage choke points
 * (`persistence.getPersistenceStorage` and `warmCachePersistence.getWarmCacheStorage`) can
 * target the same localStorage-backed instance, so a second wrap of the same target returns
 * the existing proxy and merges its disposable prefixes into that budget.
 */
const budgetRegistry = new WeakMap<object, {
    proxy: object;
    disposablePrefixes: Set<string>;
}>();

function readIndex(storage: StorageLike): Map<string, BudgetIndexEntry> {
    const raw = storage.getString(BUDGET_INDEX_KEY);
    if (!raw) return new Map();
    try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const entries = new Map<string, BudgetIndexEntry>();
            for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
                if (
                    value
                    && typeof value === 'object'
                    && typeof (value as BudgetIndexEntry).seq === 'number'
                    && typeof (value as BudgetIndexEntry).bytes === 'number'
                ) {
                    entries.set(key, value as BudgetIndexEntry);
                }
            }
            return entries;
        }
    } catch {
        // A corrupt index is rebuildable: fall through and re-derive from live keys.
    }
    return new Map();
}

/** Best-effort index persistence: a refused index write only degrades future accounting. */
function writeIndex(storage: StorageLike, index: Map<string, BudgetIndexEntry>): void {
    try {
        storage.set(BUDGET_INDEX_KEY, JSON.stringify(Object.fromEntries(index)));
    } catch (error) {
        console.warn('[web-storage] budget index write skipped', error);
    }
}

/**
 * Wrap a web storage instance with the budget contract. The returned object is structurally an
 * `MMKV` for the existing call sites (`getString`/`getNumber`/`set`/`delete`/`getAllKeys`/
 * `clearAll`/`trim`); only `set` carries the budget semantics.
 */
export function wrapWebStorageBudget<TStorage extends object>(
    storage: TStorage & StorageLike,
    options: Readonly<{ disposablePrefixes: readonly string[] }>,
): TStorage {
    const registered = budgetRegistry.get(storage);
    if (registered) {
        for (const prefix of options.disposablePrefixes) registered.disposablePrefixes.add(prefix);
        return registered.proxy as TStorage;
    }
    const disposablePrefixes = new Set(options.disposablePrefixes);
    const isDisposable = (key: string): boolean => {
        for (const prefix of disposablePrefixes) {
            if (key.startsWith(prefix)) return true;
        }
        return false;
    };

    const underlyingSet = (key: string, value: unknown): void => {
        (storage.set as (key: string, value: unknown) => void)(key, value);
    };
    const underlyingDelete = (key: string): void => {
        (storage.delete as (key: string) => void)(key);
    };

    /**
     * Best-effort recovery for one write: when the platform refuses, reclaim every OTHER
     * disposable byte from the caller's shared index map (deleting from the store and the map),
     * then retry the write once. Returns whether the write landed; a still-refused write is
     * warned once and never propagated.
     */
    const writeWithQuotaRecovery = (key: string, value: unknown, index: Map<string, BudgetIndexEntry>): boolean => {
        try {
            underlyingSet(key, value);
            return true;
        } catch (firstError) {
            for (const indexedKey of [...index.keys()]) {
                if (indexedKey !== key && isDisposable(indexedKey)) {
                    underlyingDelete(indexedKey);
                    index.delete(indexedKey);
                }
            }
            try {
                underlyingSet(key, value);
                console.warn(
                    `[web-storage] quota refusal recovered by evicting disposable records; key \"${key}\" landed`,
                    firstError,
                );
                return true;
            } catch (secondError) {
                console.warn(
                    `[web-storage] quota refusal persisted for \"${key}\"; write skipped`,
                    secondError,
                );
                return false;
            }
        }
    };

    const proxy: TStorage = new Proxy(storage, {
        get(target, property, _receiver) {
            if (property === 'set') {
                return (key: string, value: unknown): void => {
                    if (key === BUDGET_INDEX_KEY) {
                        underlyingSet(key, value);
                        return;
                    }
                    const serialized = typeof value === 'string' ? value : String(value);
                    const entryBytes = utf16ByteLength(key, serialized);
                    const index = readIndex(storage);

                    if (isDisposable(key)) {
                        if (entryBytes > WEB_STORAGE_MAX_DISPOSABLE_ENTRY_BYTES) {
                            console.warn(
                                `[web-storage] rejecting ${entryBytes}-byte disposable record \"${key}\" over the ${WEB_STORAGE_MAX_DISPOSABLE_ENTRY_BYTES}-byte entry cap`,
                            );
                            return;
                        }
                        index.delete(key);
                        let disposableBytes = 0;
                        for (const entry of index.values()) {
                            if (entry === index.get(key)) continue;
                            disposableBytes += entry.bytes;
                        }
                        // Oldest-write-first eviction until the projected total fits.
                        const ordered = [...index.entries()].sort((a, b) => a[1].seq - b[1].seq);
                        let projected = disposableBytes + entryBytes;
                        let cursor = 0;
                        while (projected > WEB_STORAGE_DISPOSABLE_BUDGET_BYTES && cursor < ordered.length) {
                            const [victimKey] = ordered[cursor]!;
                            const victim = index.get(victimKey);
                            if (victim && isDisposable(victimKey)) {
                                underlyingDelete(victimKey);
                                index.delete(victimKey);
                                projected -= victim.bytes;
                            }
                            cursor += 1;
                        }
                        if (!writeWithQuotaRecovery(key, value, index)) {
                            index.delete(key);
                        } else {
                            index.set(key, { seq: ++writeSequence, bytes: entryBytes });
                        }
                        writeIndex(storage, index);
                        return;
                    }

                    // Durable key: always attempted, recovered-for, never evicted.
                    if (!writeWithQuotaRecovery(key, value, index)) return;
                    index.set(key, { seq: ++writeSequence, bytes: entryBytes });
                    writeIndex(storage, index);
                };
            }
            if (property === 'delete') {
                return (key: string): void => {
                    underlyingDelete(key);
                    const index = readIndex(storage);
                    if (index.delete(key)) writeIndex(storage, index);
                };
            }
            const field = Reflect.get(target, property, target);
            return typeof field === 'function'
                ? (field as (...args: unknown[]) => unknown).bind(target)
                : field;
        },
    });
    budgetRegistry.set(storage, { proxy, disposablePrefixes });
    return proxy;
}
