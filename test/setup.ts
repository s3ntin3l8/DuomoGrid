import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { afterAll, beforeEach, vi } from "vitest";

// Give every test file an isolated SQLite database so parallel workers never
// contend on the default ./data/app.db file. Tests that need specific values
// (e.g. the env defaults test) override or delete these before building the app.
const tmpDb = path.join(
  os.tmpdir(),
  `vitest-${process.pid}-${crypto.randomBytes(4).toString("hex")}.db`,
);

process.env.DATABASE_URL = `file:${tmpDb}`;

// The suite must not depend on an external service. The server reads the Bundesbank's
// interest rates and the Destatis energy prices, so a request to /assumptions would
// otherwise reach out over the network on every run. Every test gets a fetch that
// fails, which is the case the server has to survive anyway: a market that cannot be
// read keeps the last known values. A test that needs real figures stubs its own.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      throw new Error(`The test suite must not reach the network (${url}).`);
    }),
  );
});

afterAll(() => {
  fs.rmSync(tmpDb, { force: true });
});
