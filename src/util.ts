import * as fs from 'fs/promises';

export async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

export async function readJson<T = any>(filePath: string): Promise<T> {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
}

/**
 * Parse VS Code/Cursor JSONC (settings.json / .code-workspace allow line/block comments
 * — including trailing inline `//` — and trailing commas). Strict JSON.parse rejects those
 * and would abort Setup incorrectly.
 */
export function parseJsonc<T = any>(text: string): T {
    let out = '';
    let i = 0;
    let inString = false;
    let escape = false;
    while (i < text.length) {
        const c = text[i];
        const next = text[i + 1];
        if (inString) {
            out += c;
            if (escape) {
                escape = false;
            } else if (c === '\\') {
                escape = true;
            } else if (c === '"') {
                inString = false;
            }
            i++;
            continue;
        }
        if (c === '"') {
            inString = true;
            out += c;
            i++;
            continue;
        }
        if (c === '/' && next === '/') {
            i += 2;
            while (i < text.length && text[i] !== '\n' && text[i] !== '\r') {
                i++;
            }
            continue;
        }
        if (c === '/' && next === '*') {
            i += 2;
            while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
                i++;
            }
            i = Math.min(i + 2, text.length);
            continue;
        }
        out += c;
        i++;
    }
    // Strip trailing commas outside of strings only (regex would corrupt ", ]" inside values).
    let cleaned = '';
    inString = false;
    escape = false;
    for (let j = 0; j < out.length; j++) {
        const c = out[j];
        if (inString) {
            cleaned += c;
            if (escape) {
                escape = false;
            } else if (c === '\\') {
                escape = true;
            } else if (c === '"') {
                inString = false;
            }
            continue;
        }
        if (c === '"') {
            inString = true;
            cleaned += c;
            continue;
        }
        if (c === ',') {
            let k = j + 1;
            while (k < out.length && /\s/.test(out[k])) {
                k++;
            }
            if (out[k] === '}' || out[k] === ']') {
                continue; // drop trailing comma
            }
        }
        cleaned += c;
    }
    return JSON.parse(cleaned) as T;
}

export async function readJsonc<T = any>(filePath: string): Promise<T> {
    return parseJsonc<T>(await fs.readFile(filePath, 'utf8'));
}

/** Snapshot file contents for transactional Setup rollback (`null` = did not exist). */
export async function readTextSnapshot(filePath: string): Promise<string | null> {
    try {
        return await fs.readFile(filePath, 'utf8');
    } catch {
        return null;
    }
}

/** Restore a text snapshot (`null` → delete). Returns false if rollback failed. */
export async function restoreTextSnapshot(
    filePath: string,
    previous: string | null
): Promise<boolean> {
    try {
        if (previous === null) {
            try {
                await fs.unlink(filePath);
            } catch (err: unknown) {
                const code = (err as NodeJS.ErrnoException).code;
                if (code !== 'ENOENT') {
                    return false;
                }
            }
            return true;
        }
        await fs.writeFile(filePath, previous, 'utf8');
        return true;
    } catch {
        return false;
    }
}

/**
 * Multi-file Setup transaction: snapshot every hard-path file BEFORE any write,
 * then restore all (checked) on failure. Soft artifacts (clangd, compile_commands,
 * c_cpp_properties, dotnet restore) must run ONLY after commit — never inside.
 */
export class HardDiskTransaction {
    private readonly entries: { filePath: string; snapshot: string | null }[] = [];

    async track(filePath: string): Promise<void> {
        this.entries.push({
            filePath,
            snapshot: await readTextSnapshot(filePath),
        });
    }

    /** Restore in reverse track order. Returns false if any restore failed. */
    async rollback(): Promise<boolean> {
        let ok = true;
        for (let i = this.entries.length - 1; i >= 0; i--) {
            const e = this.entries[i];
            const restored = await restoreTextSnapshot(e.filePath, e.snapshot);
            ok = restored && ok;
        }
        return ok;
    }

    /** Restore only the listed tracked paths (e.g. BuildRules soft-fail). */
    async rollbackOnly(filePaths: string[]): Promise<boolean> {
        const wanted = new Set(filePaths.map((p) => pathNormalize(p)));
        let ok = true;
        for (let i = this.entries.length - 1; i >= 0; i--) {
            const e = this.entries[i];
            if (!wanted.has(pathNormalize(e.filePath))) {
                continue;
            }
            const restored = await restoreTextSnapshot(e.filePath, e.snapshot);
            ok = restored && ok;
        }
        return ok;
    }
}

function pathNormalize(p: string): string {
    return p.replace(/\\/g, '/').toLowerCase();
}

export async function writeJson(filePath: string, data: unknown): Promise<void> {
    await fs.writeFile(filePath, JSON.stringify(data, null, 4), 'utf8');
}

export function normalizeSlashes(p: string): string {
    return p.replace(/\\/g, '/');
}

/** Deep-merge plain objects; arrays and primitives overwrite. `undefined` deletes the key. */
export function mergeSettings(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
    const result = { ...target };
    for (const [key, value] of Object.entries(source)) {
        if (value === undefined) {
            delete result[key];
        } else if (
            value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            result[key] &&
            typeof result[key] === 'object' &&
            !Array.isArray(result[key])
        ) {
            result[key] = mergeSettings(result[key], value);
        } else {
            result[key] = value;
        }
    }
    return result;
}
