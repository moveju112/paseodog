import { readFileSync, lstatSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DEFAULT_KOREAN_SPEECH_MODEL, KOREAN_SPEECH_MODELS } from '../shared/speech-models.mjs';

const overrides = [
    'PASEO_DICTATION_STT_PROVIDER', 'PASEO_VOICE_STT_PROVIDER',
    'PASEO_DICTATION_LOCAL_STT_MODEL', 'PASEO_VOICE_LOCAL_STT_MODEL',
];
const digest = text => createHash('sha256').update(text).digest('hex');

// 전용 호스트의 STT 설정만 저장한다. 다운로드·재시작·유료 API 호출은 하지 않는다.
export function handleSpeechSettings(request, env = process.env) {
    const home = env.PASEO_HOME;
    if (!home || !isAbsolute(home) || lstatSync(home).isSymbolicLink())
        throw new Error('Dedicated Paseo home required');
    const file = join(home, 'config.json');
    if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink())
        throw new Error('Regular dedicated config required');
    const original = readFileSync(file, 'utf8');
    let config;
    try { config = JSON.parse(original); }
    catch { throw new Error('Invalid daemon configuration'); }
    if (!config?.agents?.providers?.paseodog)
        throw new Error('Dedicated PaseoDog provider required');
    const blocked = overrides.some(key => Boolean(env[key]?.trim()));
    let revision = digest(original);
    if (request.action === 'write') {
        if (blocked) throw new Error('Speech settings are controlled by environment overrides');
        if (!KOREAN_SPEECH_MODELS.some(model => model.id === request.model))
            throw new Error('Unsupported Korean local speech model');
        if (request.revision !== revision) throw new Error('Speech settings changed; refresh before saving');
        config.features ??= {};
        for (const feature of ['dictation', 'voiceMode']) {
            config.features[feature] ??= {};
            config.features[feature].stt = {
                ...config.features[feature].stt,
                provider: 'local', model: request.model, language: 'ko',
            };
        }
        const text = JSON.stringify(config, null, 2) + '\n';
        const temporary = `${file}.${randomUUID()}.tmp`;
        let fd;
        try {
            fd = openSync(temporary, 'wx', 0o600);
            writeFileSync(fd, text);
            fsyncSync(fd);
            closeSync(fd);
            fd = undefined;
            if (digest(readFileSync(file, 'utf8')) !== revision)
                throw new Error('Daemon configuration changed; refresh before saving');
            renameSync(temporary, file);
            revision = digest(text);
        } finally {
            if (fd !== undefined) closeSync(fd);
            try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
    } else if (request.action !== 'read') {
        throw new Error('Unsupported speech settings action');
    }
    const selections = ['dictation', 'voiceMode'].map(feature => {
        const stt = config.features?.[feature]?.stt;
        return (stt?.provider ?? 'local') === 'local'
            ? stt?.model ?? DEFAULT_KOREAN_SPEECH_MODEL : null;
    });
    const model = selections[0] === selections[1] && KOREAN_SPEECH_MODELS.some(item => item.id === selections[0])
        ? selections[0] : null;
    return { model, revision, blocked, models: KOREAN_SPEECH_MODELS };
}
