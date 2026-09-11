import { describe, expect, it } from 'vitest';

import { resolveRpcForwardTimeoutMs } from './rpcForwardTimeout';

describe('resolveRpcForwardTimeoutMs', () => {
    it('keeps execution-run starts and waits under caller and lifecycle cancellation without widening ordinary RPC calls', () => {
        expect(resolveRpcForwardTimeoutMs('sess_1:execution.run.start')).toBe(2_147_483_647);
        expect(resolveRpcForwardTimeoutMs('sess_1:execution.run.wait')).toBe(2_147_483_647);
        expect(resolveRpcForwardTimeoutMs('sess_1:execution.run.wait', 180_000)).toBe(2_147_483_647);
        expect(resolveRpcForwardTimeoutMs('sess_1:execution.run.get')).toBe(30_000);
    });
});
