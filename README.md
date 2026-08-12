# lib-config

Tiny JSON config manager for Node. You describe your config with a [zod](https://zod.dev) schema, point it at a file, and get back a fully typed config object that keeps itself and the file valid.

## Usage

```ts
import { z } from "zod"
import { config_init } from "@misikovich/lib-config"

const CONFIG = config_init("app.json", z.object({
    HOST: z.string().default("0.0.0.0"),
    PORT: z.number().default(8080),
    API_KEY: z.string(),            // no default -> required
}))

CONFIG.PORT                         // number, inferred from the schema
CONFIG.PORT = 3000                  // validated and saved to app.json immediately
```

## What it does for you

**One source of truth.** The schema defines both the runtime validation and the TypeScript type — there is no separate interface to keep in sync.

**Forgiving reads.** The file is validated field by field on load instead of failing on the first problem:

- an unknown entry is removed with a warning
- a missing entry falls back to its default with a warning
- an entry with a wrong type falls back to its default with a warning
- a missing or broken entry with **no** default throws — when creating a file, required entries are first written as `null` placeholders

```
config: unknown entry "JUNK" removed
config: missing entry "HOST", using default
config: bad value for "PORT" (Invalid input: expected number, received string), using default
```

**Self-healing file.** After loading, the corrected config is written back to disk, so typos and stale keys are cleaned up on startup. A missing file is created from the defaults, with `null` placeholders for required entries that have no default. The complete template is written before an error lists the entries you need to fill in. A file with broken JSON throws with the parse error — pass `force_overwrite: true` as the third argument to rebuild it using the same template behavior.

**Live writes, at most one per second.** The returned object is a proxy: assigning to a field validates the new value against the schema (throwing on a bad one) and persists it. Use it like a plain object everywhere else.

Saving is rate limited — the first change is written immediately, and any further changes within the next second are coalesced into a single trailing write of the latest values. A burst of a thousand assignments costs two writes, not a thousand, and the file always catches up within a second.

A pending write is flushed when the process exits normally. Signals do not run exit handlers, so if you handle `SIGINT`/`SIGTERM` yourself, flush explicitly:

```ts
import { config_flush } from "@misikovich/lib-config"

process.on("SIGINT", () => {
    config_flush(CONFIG)
    process.exit(0)
})
```

## Notes

- The config must be a flat JSON object — nested objects, arrays as roots, etc. are out of scope for now.
- Assignments write synchronously on the leading edge and via an `unref`ed 1s timer otherwise, so a pending save never keeps the process alive. Errors from a deferred write are warned, not thrown — nothing is left to catch them.
- Requires Node >= 20. zod v4 is the only dependency.
