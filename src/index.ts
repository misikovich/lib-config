import { readFileSync, writeFileSync } from "node:fs"
import { z } from "zod"

function config_field_default(key: string, field: z.ZodType): unknown {
    try {
        return field.parse(undefined)
    } catch {
        throw new Error(`config: entry "${key}" is missing/invalid and has no default`)
    }
}

function config_validate(schema: z.ZodObject, j: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {}

    for (const key of Object.keys(j)) {
        if (!(key in schema.shape))
            console.warn(`config: unknown entry "${key}" removed`)
    }

    for (const [key, field] of Object.entries(schema.shape)) {
        if (!(key in j)) {
            const def = config_field_default(key, field)
            console.warn(`config: missing entry "${key}", using default "${def}"`)
            out[key] = def
            continue
        }
        const r = field.safeParse(j[key])
        if (r.success) {
            out[key] = r.data
        } else {
            const def = config_field_default(key, field)
            console.warn(`config: bad value for "${key}" (${r.error.issues[0]?.message}), using default "${def}"`)
            out[key] = def
        }
    }

    return out
}

function config_serialize(data: Record<string, unknown>): string {
    return JSON.stringify(data, null, 4) + "\n"
}

export function config_init<S extends z.ZodObject>(path: string, schema: S, force_overwrite: boolean = false): z.infer<S> {
    let f: string | undefined
    try {
        f = readFileSync(path, "utf8")
    } catch {
        console.warn(`config: "${path}" not found, creating with defaults`)
    }

    let j: Record<string, unknown> = {}
    if (f !== undefined) {
        try {
            const parsed: unknown = JSON.parse(f)
            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
                throw new Error("root is not an object")
            j = parsed as Record<string, unknown>
        } catch (error) {
            if (!force_overwrite)
                throw new Error(`config: "${path}" is not valid JSON (${error instanceof Error ? error.message : error}), fix it manually or pass force_overwrite`)
            console.warn(`config: "${path}" is not valid JSON, overwriting with defaults`)
        }
    }

    const data = config_validate(schema, j)

    // self-heal: persist corrected config if it differs from what was on disk
    if (config_serialize(data) !== f)
        writeFileSync(path, config_serialize(data))

    return new Proxy(data, {
        set(target, key, value) {
            const field = schema.shape[String(key)]
            if (!field)
                throw new Error(`config: unknown entry "${String(key)}"`)
            target[String(key)] = field.parse(value)
            writeFileSync(path, config_serialize(target))
            return true
        },
    }) as z.infer<S>
}
