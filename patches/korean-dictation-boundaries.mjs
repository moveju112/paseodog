// 한국어 받침/어미를 문자열 규칙으로 붙이지 않고 오디오 절단 시점을 보정한다.
export const KOREAN_DICTATION_BOUNDARY_PATCH = {
    file: 'dictation/dictation-stream-manager.js',
    blob: 'eb7f4fac1cbfe65a1083bfda39faf986a04d2f74',
    previousEdits: [],
    edits: [
        ['const DEFAULT_DICTATION_AUTO_COMMIT_SECONDS = 15;',
            'const DEFAULT_DICTATION_AUTO_COMMIT_SECONDS = 15;\n'
            + 'const KOREAN_DICTATION_SILENCE_SECONDS = 0.3;\n'
            + 'const KOREAN_DICTATION_MAX_WAIT_SECONDS = 3;'],
        ['            peakSinceCommit: 0,',
            '            peakSinceCommit: 0,\n            trailingSilenceBytes: 0,'],
        ['                state.finalTranscriptSegmentIds.add(segmentId);',
            '                state.finalTranscriptSegmentIds.add(segmentId);\n'
            + '                this.logger.debug({ dictationId, segmentId, textLength: transcript.length,\n'
            + '                    whitespaceCount: (transcript.match(/\\s/g) ?? []).length }, "Dictation segment transcription");'],
        ['                state.peakSinceCommit = Math.max(state.peakSinceCommit, pcm16lePeakAbs(resampled));',
            `                state.peakSinceCommit = Math.max(state.peakSinceCommit, pcm16lePeakAbs(resampled));
                let trailingSilenceBytes = 0;
                for (let offset = resampled.length - 2; offset >= 0; offset -= 2) {
                    if (Math.abs(resampled.readInt16LE(offset)) >= DICTATION_SILENCE_PEAK_THRESHOLD) break;
                    trailingSilenceBytes += 2;
                }
                state.trailingSilenceBytes = trailingSilenceBytes === resampled.length
                    ? state.trailingSilenceBytes + trailingSilenceBytes : trailingSilenceBytes;`],
        ['            state.peakSinceCommit = 0;\n            return;\n        }\n        this.requestDictationCommit(state);',
            `            state.peakSinceCommit = 0;
            state.trailingSilenceBytes = 0;
            return;
        }
        let reason = "interval";
        if (/^ko(?:-|$)/i.test(this.language)) {
            const bytesPerSecond = state.outputRate * 2;
            const atSilence = state.trailingSilenceBytes >= bytesPerSecond * KOREAN_DICTATION_SILENCE_SECONDS;
            const atLimit = state.bytesSinceCommit >= state.autoCommitBytes + bytesPerSecond * KOREAN_DICTATION_MAX_WAIT_SECONDS;
            if (!atSilence && !atLimit) return;
            reason = atSilence ? "silence" : "max-wait";
        }
        this.requestDictationCommit(state, reason);`],
        ['    requestDictationCommit(state) {\n        state.bytesSinceCommit = 0;\n        state.peakSinceCommit = 0;',
            `    requestDictationCommit(state, reason = "finish") {
        this.logger.debug({ dictationId: state.dictationId, reason,
            audioSeconds: state.bytesSinceCommit / (state.outputRate * 2),
            trailingSilenceSeconds: state.trailingSilenceBytes / (state.outputRate * 2) }, "Dictation segment commit");
        state.bytesSinceCommit = 0;
        state.peakSinceCommit = 0;
        state.trailingSilenceBytes = 0;`],
        ['                state.peakSinceCommit = 0;\n                state.awaitingFinalCommit = false;',
            '                state.peakSinceCommit = 0;\n                state.trailingSilenceBytes = 0;\n                state.awaitingFinalCommit = false;'],
    ],
};
