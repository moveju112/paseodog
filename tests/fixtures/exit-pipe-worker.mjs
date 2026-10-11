// An actual exited worker whose descendant deliberately keeps its stdout
// pipe alive. Testing only: parent test kills the process group on timeout.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const send = (id, value) => process.stdout.write(JSON.stringify({ v: 1, id, ok: true, value }) + '\n');
createInterface({ input: process.stdin }).on('line', (line) => {
    const frame = JSON.parse(line);
    if (frame.op === 'open') { send(frame.id, { nativeSessionId: 'exit-pipe-session' }); return; }
    if (frame.op !== 'ask') return;
    const code = "const fs=require('node:fs');process.on('SIGTERM',()=>{});setInterval(()=>fs.appendFileSync(process.env.REPRO_HEARTBEAT,'x'),10);";
    const desc = spawn(process.execPath, ['-e', code], { stdio: ['ignore', process.stdout, process.stderr], env: process.env });
    writeFileSync(process.env.REPRO_PIDFILE, String(desc.pid));
    setTimeout(() => process.exit(23), 90);
});
