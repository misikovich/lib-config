Simple TypeScript config manager lib. Working prototype implemented in `src/index.ts`.

# What it does

Single entry point: `config_init(path, schema, force_overwrite = false)`.

- Schema is the source of truth: a zod (v4) `ZodObject`, static type inferred via `z.infer` — no separate type declarations.
- Reads a JSON config file, validates it per-field (lenient): unknown entries are dropped, missing/bad values fall back to their `.default()` — each with a `console.warn`. A missing/bad field with no default throws.
- Self-heals: the corrected config is written back to disk whenever it differs from what was read.
- Missing file is created from defaults. Invalid JSON throws unless `force_overwrite` is set (then it's rebuilt from defaults).
- Returns a `Proxy`: assignments (`CONFIG.FOO = "x"`) validate the field against the schema and persist to the file immediately.

# Conventions

- No semicolons.
- Functions/locals: lowercase_snake_case, prefixed by module (`config_*`). Constants: UPPERCASE_SNAKE_CASE. Types: PascalCase.
- Keep it flat and simple — no nested config support until actually needed. No backward compatibility concerns.
- Build with `npm run build` (tsc, TypeScript 7). `"types": ["node"]` in tsconfig is required for `@types/node` pickup.
