import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    WEB_STORAGE_DISPOSABLE_BUDGET_BYTES,
    WEB_STORAGE_MAX_DISPOSABLE_ENTRY_BYTES,
    utf16ByteLength,
    wrapWebStorageBudget,
} from './webStorageBudget';

/**
 * The budget wrapper's contract is the acceptance brief's: durable keys always survive, the
 * disposable namespaces live under a global UTF-16 byte budget with oldest-write-first eviction,
 * a single oversized disposable entry is rejected rather than evicting everything else, and a
 * quota refusal from the platform recovers by evicting disposable namespaces and retrying the
 * write once — never propagating into the caller.
 */

/**
 * A localStorage-shaped fake: a real byte capacity that throws QuotaExceededError while the
 * store is over it, so eviction genuinely frees the retry (plus a hard-fail override for the
 * still-refuses case).
 */
class FakeStorage {
    readonly values = new Map<string, unknown>();
    capacityBytes: number;
    hardFail = false;

    constructor(capacityBytes: number) {
        this.capacityBytes = capacityBytes;
    }

    private totalBytes(): number {
        let total = 0;
        for (const [key, value] of this.values) total += 2 * (key.length + String(value).length);
        return total;
    }

    getString(key: string): string | undefined {
        const value = this.values.get(key);
        return typeof value === 'string' ? value : undefined;
    }
    getNumber(key: string): number | undefined {
        const value = this.values.get(key);
        return typeof value === 'number' ? value : undefined;
    }
    set(key: string, value: unknown): void {
        const previous = this.values.get(key);
        this.values.set(key, value);
        if (this.hardFail || this.totalBytes() > this.capacityBytes) {
            if (previous === undefined) this.values.delete(key);
            else this.values.set(key, previous);
            throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        }
    }
    delete(key: string): void { this.values.delete(key); }
    getAllKeys(): string[] { return [...this.values.keys()]; }
    clearAll(): void { this.values.clear(); }
    trim(): void {}
}

const DISPOSABLE_PREFIXES = ['session-list-warm-cache-v1:', 'machine-display-warm-cache-v1:'] as const;

function makeBudgetedStorage(capacityBytes = WEB_STORAGE_DISPOSABLE_BUDGET_BYTES * 2) {
    const inner = new FakeStorage(capacityBytes);
    const budgeted = wrapWebStorageBudget(inner as never, {
        disposablePrefixes: [...DISPOSABLE_PREFIXES],
    });
    return { inner, budgeted };
}

function blob(bytePairs: number): string {
    // UTF-16 byte length is 2 per code unit, so a string of N ASCII chars is 2N bytes.
    return 'x'.repeat(bytePairs / 2);
}

describe('utf16ByteLength', () => {
    it('accounts for key and value at two bytes per UTF-16 code unit', () => {
        expect(utf16ByteLength('ab', 'cdef')).toBe(2 * (2 + 4));
        // Surrogate pairs still count every code unit at 2 bytes.
        expect(utf16ByteLength('😀', '')).toBe(2 * 2);
    });
});

describe('wrapWebStorageBudget', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('admits durable writes regardless of budget pressure and never evicts them', () => {
        const { inner, budgeted } = makeBudgetedStorage();
        budgeted.set('local-settings', blob(WEB_STORAGE_DISPOSABLE_BUDGET_BYTES));
        expect(inner.values.has('local-settings')).toBe(true);

        // Budget pressure from disposables must not reclaim the durable key.
        budgeted.set('session-list-warm-cache-v1:s:a', blob(WEB_STORAGE_DISPOSABLE_BUDGET_BYTES));
        expect(inner.values.has('local-settings')).toBe(true);
    });

    it('evicts the oldest disposable writes first once the budget is exceeded', () => {
        const { inner, budgeted } = makeBudgetedStorage();
        const half = Math.floor(WEB_STORAGE_DISPOSABLE_BUDGET_BYTES / 2);
        budgeted.set('session-list-warm-cache-v1:old', blob(half));
        budgeted.set('machine-display-warm-cache-v1:mid', blob(half));
        // Over budget: the oldest disposable write is reclaimed to admit the new one.
        budgeted.set('session-list-warm-cache-v1:new', blob(half));

        expect(inner.values.has('session-list-warm-cache-v1:old')).toBe(false);
        expect(inner.values.has('machine-display-warm-cache-v1:mid')).toBe(true);
        expect(inner.values.has('session-list-warm-cache-v1:new')).toBe(true);
    });

    it('rejects a single oversized disposable entry instead of evicting the namespace', () => {
        const { inner, budgeted } = makeBudgetedStorage();
        budgeted.set(
            'session-list-warm-cache-v1:huge',
            blob(WEB_STORAGE_MAX_DISPOSABLE_ENTRY_BYTES + 2),
        );
        expect(inner.values.has('session-list-warm-cache-v1:huge')).toBe(false);
        expect(console.warn).toHaveBeenCalled();
    });

    it('recovers from a platform quota refusal by evicting disposables and retrying once', () => {
        // Capacity sized so the disposable record fits alone but the durable write on top
        // exceeds it: the platform refuses until eviction actually frees the bytes.
        const { inner, budgeted } = makeBudgetedStorage(1300);
        budgeted.set('session-list-warm-cache-v1:s:a', blob(1024));

        expect(() => budgeted.set('local-settings', blob(64))).not.toThrow();
        expect(inner.values.has('session-list-warm-cache-v1:s:a')).toBe(false);
        expect(inner.values.has('local-settings')).toBe(true);
    });

    it('warns and keeps going when the quota still refuses after recovery', () => {
        const { inner, budgeted } = makeBudgetedStorage();
        budgeted.set('session-list-warm-cache-v1:s:a', blob(1024));
        inner.hardFail = true;
        expect(() => budgeted.set('local-settings', blob(64))).not.toThrow();
        expect(console.warn).toHaveBeenCalled();
    });

    it("accounts value growth by re-deriving a key's footprint on rewrite", () => {
        const { inner, budgeted } = makeBudgetedStorage();
        const half = Math.floor(WEB_STORAGE_DISPOSABLE_BUDGET_BYTES / 2);
        budgeted.set('session-list-warm-cache-v1:grow', blob(64));
        budgeted.set('session-list-warm-cache-v1:grow', blob(half + half));
        // The rewrite alone exceeds the budget and must evict itself down / reject the growth:
        // a single entry over the entry cap is rejected.
        expect(inner.values.get('session-list-warm-cache-v1:grow')).toBe(blob(64));
    });
});
