import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const serverRoot = join(import.meta.dirname, "..", "..");
const migrationId = "20261027090000_add_connected_service_auth_group_member_role";

describe("connected service auth group member role migration", () => {
    it.each(["prisma/schema.prisma", "prisma/sqlite/schema.prisma", "prisma/mysql/schema.prisma"])(
        "declares the pool member tier on the auth group member model in %s", async (path) => {
            const schema = await readFile(join(serverRoot, path), "utf8");
            const model = schema.match(/model ConnectedServiceAuthGroupMember \{[\s\S]*?\n\}/)?.[0];
            expect(model).toBeDefined();
            expect(model).toMatch(/role\s+String\s+@default\("primary"\)/);
            // The tier never replaces the ordering key: priority stays the canonical pool order.
            expect(model).toMatch(/priority\s+Int\s+@default\(100\)/);
        },
    );

    it.each(["prisma", "prisma/sqlite", "prisma/mysql"])("adds a defaulted role column in %s", async (path) => {
        const sql = await readFile(join(serverRoot, path, "migrations", migrationId, "migration.sql"), "utf8");
        const normalized = sql.replaceAll("`", '"');
        // Existing pools keep the released single-tier behaviour: every stored member is primary.
        expect(normalized).toContain(
            'ALTER TABLE "ConnectedServiceAuthGroupMember" ADD COLUMN "role" '
            + (path.includes("mysql") ? "VARCHAR(191)" : "TEXT")
            + ` NOT NULL DEFAULT 'primary'`,
        );
    });
});
