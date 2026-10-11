import { StringDecoder } from 'node:string_decoder';
import { MAX_FRAME } from './util.mjs';
// Byte-bounded incremental JSONL decoder. It handles UTF-8 split across chunks.
export function createJsonLineDecoder(onValue, onError, maxBytes = MAX_FRAME) {
    const decoder = new StringDecoder('utf8');
    let text = '', pendingBytes = 0, failed = false;
    function fail(error) { if (failed) return; failed = true; onError(error); }
    return {
        write(chunk) {
            if (failed) return;
            // Parse byte segments, not one whole (possibly huge) stream chunk.
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            let offset = 0;
            while (offset < buffer.length) {
                const index = buffer.indexOf(10, offset);
                const end = index < 0 ? buffer.length : index;
                const segment = buffer.subarray(offset, end);
                pendingBytes += segment.length;
                if (pendingBytes > maxBytes) return fail(new Error('IPC frame exceeds size limit'));
                text += decoder.write(segment);
                if (index < 0) return;
                const line = text.trim(); text = ''; pendingBytes = 0;
                if (line) {
                    try { onValue(JSON.parse(line)); }
                    catch (error) { return fail(new Error(`Invalid IPC frame: ${error.message}`)); }
                }
                offset = end + 1;
            }
        },
        end() { if (!failed && (text + decoder.end()).trim()) fail(new Error('Truncated IPC frame')); },
    };
}
export function encodeFrame(value, maxBytes = MAX_FRAME) {
    const data = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(data) > maxBytes) throw new Error('IPC frame exceeds size limit');
    return data;
}
