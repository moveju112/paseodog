import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
const reply=(id,value)=>process.stdout.write(JSON.stringify({v:1,id,ok:true,value})+'\n');
createInterface({input:process.stdin}).on('line',line=>{
 const f=JSON.parse(line);
 if(f.op==='open')reply(f.id,{nativeSessionId:'sess_orphan_probe'});
 if(f.op==='ask'){
  const code="const fs=require('node:fs');setInterval(()=>fs.appendFileSync(process.env.REPRO_HEARTBEAT,'x'),15);";
  const child=spawn(process.execPath,['-e',code],{stdio:'ignore',env:{...process.env}});
  writeFileSync(process.env.REPRO_PIDFILE,String(child.pid));
 }
});
