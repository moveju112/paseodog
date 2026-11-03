import { DEFAULT_TURN_MINUTES, validateTurnMinutes } from '../shared/turn-duration.mjs';
import { readDedicatedSetting, writeDedicatedSetting } from './dedicated-setting.mjs';

const SETTING_FILE = 'paseodog-turn-duration.json';

export function readTurnMinutes(env = {}) {
    const saved = readDedicatedSetting(env, SETTING_FILE);
    return saved === undefined ? DEFAULT_TURN_MINUTES : validateTurnMinutes(saved.maxTurnMinutes);
}

export function writeTurnMinutes(env, value) {
    validateTurnMinutes(value);
    writeDedicatedSetting(env, SETTING_FILE, { maxTurnMinutes: value });
}
