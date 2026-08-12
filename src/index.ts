import { readFileSync, writeFileSync } from "node:fs"
import { z } from "zod"

const LOGTAG = "[config]"
const WRITE_INTERVAL_MS = 1000

const CONFIG_FLUSH_REGISTRY = new WeakMap<object, () => void>()

function config_field_default(key: string, field: z.ZodType): unknown {
    try {
        return field.parse(undefined)
    } catch {
        throw new Error(`${LOGTAG} entry "${key}" is missing/invalid and has no default`)
    }
}

function config_template(schema: z.ZodObject) {
    const data: Record<string, unknown> = {}
    const required_keys: string[] = []

    for (const [key, field] of Object.entries(schema.shape)) {
        const result = field.safeParse(undefined)
        if (result.success) {
            data[key] = result.data
        } else {
            data[key] = null
            required_keys.push(key)
        }
    }

    return { data, required_keys }
}

function config_validate(schema: z.ZodObject, j: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {}

    for (const key of Object.keys(j)) {
        if (!(key in schema.shape))
            console.warn(`${LOGTAG} unknown entry "${key}" removed`)
    }

    for (const [key, field] of Object.entries(schema.shape)) {
        if (!(key in j)) {
            const def = config_field_default(key, field)
            console.warn(`${LOGTAG} missing entry "${key}", using default ${def}`)
            out[key] = def
            continue
        }
        const r = field.safeParse(j[key])
        if (r.success) {
            out[key] = r.data
        } else {
            const def = config_field_default(key, field)
            console.warn(`${LOGTAG} bad value for "${key}" (${r.error.issues[0]?.message}), using default ${def}`)
            out[key] = def
        }
    }

    return out
}

function config_serialize(data: Record<string, unknown>): string {
    return JSON.stringify(data, null, 4) + "\n"
}

type ConfigWriter = {
    write_now: () => void
    write_request: () => void
    write_flush: () => void
}

// at most one writeFileSync per WRITE_INTERVAL_MS: the first change goes to disk right away,
// further ones inside the window are coalesced into a single trailing write of the latest data
function config_writer_create(path: string, data: Record<string, unknown>): ConfigWriter {
    let timer: NodeJS.Timeout | undefined
    let last_ms = 0
    let exit_hook = false

    const write_now = () => {
        last_ms = Date.now()
        writeFileSync(path, config_serialize(data))
    }

    // doubles as the timer callback: clearTimeout on an already fired timer is a no-op
    const write_flush = () => {
        if (!timer) return
        clearTimeout(timer)
        timer = undefined
        try {
            write_now()
        } catch (error) {
            console.warn(`${LOGTAG} could not persist "${path}" (${error instanceof Error ? error.message : error})`)
        }
    }

    const write_request = () => {
        if (timer) return // trailing write pending, it serializes the latest data anyway
        const wait = WRITE_INTERVAL_MS - (Date.now() - last_ms)
        if (wait <= 0) {
            write_now() // leading edge, stays synchronous so write errors reach the assigner
            return
        }
        if (!exit_hook) {
            process.on("exit", write_flush)
            exit_hook = true
        }
        timer = setTimeout(write_flush, wait).unref()
    }

    return { write_now, write_request, write_flush }
}

// writes the pending change, if any, immediately — for signal handlers, which never reach "exit"
export function config_flush(config: object): void {
    const flush = CONFIG_FLUSH_REGISTRY.get(config)
    if (!flush)
        throw new Error(`${LOGTAG} config_flush() called on something that is not a config`)
    flush()
}

export function config_init<S extends z.ZodObject>(path: string, schema: S, force_overwrite: boolean = false): z.infer<S> {
    let f: string | undefined
    try {
        f = readFileSync(path, "utf8")
    } catch {
        console.warn(`${LOGTAG} "${path}" not found, creating with defaults`)
    }

    let create_template = f === undefined
    let template_action: "created" | "rebuilt" = "created"
    let j: Record<string, unknown> = {}
    if (f !== undefined) {
        try {
            const parsed: unknown = JSON.parse(f)
            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
                throw new Error("root is not an object")
            j = parsed as Record<string, unknown>
        } catch (error) {
            if (!force_overwrite)
                throw new Error(`${LOGTAG} "${path}" is not valid JSON (${error instanceof Error ? error.message : error}), fix it manually or pass force_overwrite`)
            console.warn(`${LOGTAG} "${path}" is not valid JSON, overwriting with defaults`)
            create_template = true
            template_action = "rebuilt"
        }
    }

    let data: Record<string, unknown>
    let required_keys: string[] = []
    let dirty: boolean
    if (create_template) {
        const template = config_template(schema)
        data = template.data
        required_keys = template.required_keys
        dirty = true
    } else {
        data = config_validate(schema, j)
        // self-heal: persist corrected config if it differs from what was on disk
        dirty = config_serialize(data) !== f
    }

    const writer = config_writer_create(path, data)
    if (dirty)
        writer.write_now()

    if (required_keys.length > 0) {
        const required_entries = required_keys.map((key) => `"${key}"`).join(", ")
        throw new Error(`${LOGTAG} ${template_action} "${path}", but required entries need values: ${required_entries}. Fill them in and restart`)
    }

    const config = new Proxy(data, {
        set(target, key, value) {
            const field = schema.shape[String(key)]
            if (!field)
                throw new Error(`${LOGTAG} unknown entry "${String(key)}"`)
            target[String(key)] = field.parse(value)
            writer.write_request()
            return true
        },
    }) as z.infer<S>

    CONFIG_FLUSH_REGISTRY.set(config, writer.write_flush)
    return config
}
