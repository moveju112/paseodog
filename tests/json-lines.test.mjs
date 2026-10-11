import test from 'node:test';
import assert from 'node:assert/strict';
import { createJsonLineDecoder, encodeFrame } from '../plugin/server/json-lines.mjs';
test('JSONL decodes UTF-8 split byte-by-byte, including CRLF',()=>{
    const events=[],errors=[];const d=createJsonLineDecoder(x=>events.push(x),x=>errors.push(x));
    const frame=Buffer.from(JSON.stringify({text:'\ud55c\uae00\ud83d\ude80'})+'\r\n');for(const byte of frame)d.write(Buffer.from([byte]));d.end();assert.deepEqual(events,[{text:'\ud55c\uae00\ud83d\ude80'}]);assert.equal(errors.length,0);
});
test('JSONL bounds each frame independently, not an aggregate chunk of valid frames',()=>{
    const events=[],errors=[];const d=createJsonLineDecoder(x=>events.push(x),x=>errors.push(x),10);d.write(Buffer.from('{}\n'.repeat(100)));assert.equal(events.length,100);assert.equal(errors.length,0);
});
test('oversized, malformed and truncated JSONL fail once',()=>{
    for(const data of ['{"x":"'+'a'.repeat(100),'not-json\n','{"x":']){const errors=[];const d=createJsonLineDecoder(()=>{},e=>errors.push(e),30);d.write(data);d.end();assert.equal(errors.length,1);}
});
test('encoder refuses oversized messages rather than allocating an unbounded queue',()=>{
    assert.throws(()=>encodeFrame({data:'x'.repeat(200)},30),/limit/);
});
