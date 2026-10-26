import { mkdirSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_TURN_MINUTES, validateTurnMinutes } from '../shared/turn-duration.mjs';

function settingsPath(env) {
    const root = env.MIXDOG_DATA_DIR;
    if (!root || !isAbsolute(root)) throw new Error('Dedicated engine data directory required');
    return join(root, 'paseodog-turn-duration.json');
}

export function readTurnMinutes(env = {}) {
    if (!env.MIXDOG_DATA_DIR) return DEFAULT_TURN_MINUTES;
    const path = settingsPath(env);
    let text;
    try { text = readFileSync(path, 'utf8'); }
    catch (error) {
        if (error.code === 'ENOENT') return DEFAULT_TURN_MINUTES;
        throw error;
    }
    return validateTurnMinutes(JSON.parse(text).maxTurnMinutes);
}

export function writeTurnMinutes(env, value) {
    validateTurnMinutes(value);
    const path = settingsPath(env);
    mkdirSync(env.MIXDOG_DATA_DIR, { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    let fd;
    try {
        fd = openSync(temporary, 'wx', 0o600);
        writeFileSync(fd, JSON.stringify({ maxTurnMinutes: value }) + '\n');
        fsyncSync(fd);
        closeSync(fd);
        fd = undefined;
        renameSync(temporary, path);
        if (process.platform !== 'win32') {
            fd = openSync(env.MIXDOG_DATA_DIR, 'r');
            fsyncSync(fd);
        }
    } finally {
        if (fd !== undefined) closeSync(fd);
        try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
}
