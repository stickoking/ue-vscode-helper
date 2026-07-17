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

export async function writeJson(filePath: string, data: unknown): Promise<void> {
    await fs.writeFile(filePath, JSON.stringify(data, null, 4), 'utf8');
}

export function normalizeSlashes(p: string): string {
    return p.replace(/\\/g, '/');
}

/** Deep-merge plain objects; arrays and primitives overwrite. */
export function mergeSettings(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
    const result = { ...target };
    for (const [key, value] of Object.entries(source)) {
        if (
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
