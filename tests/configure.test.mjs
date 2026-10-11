import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,readdirSync,mkdirSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {configure} from '../scripts/configure.mjs';
import {supportedNode} from '../scripts/paths.mjs';
function setup(t){const root=mkdtempSync(join(tmpdir(),'paseodog-config-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return {root,options:{home:join(root,'paseo'),nativeHome:join(root,'mixdog'),stateDir:join(root,'sessions'),enginePath:'/path with space/worker.mjs'}};}
test('configure requires explicit trust and does not enable plugins silently',t=>{const {options}=setup(t);assert.throws(()=>configure(options),/trust-plugins/);});
test('configure preserves unrelated config, backs it up, and uses absolute argv with no shell',t=>{
    const {root,options}=setup(t);mkdirSync(options.home,{mode:0o700});writeFileSync(join(options.home,'config.json'),JSON.stringify({version:1,daemon:{listen:'127.0.0.1:9999'},agents:{providers:{existing:{enabled:true}}}}));
    const file=configure({...options,trustPlugins:true});const config=JSON.parse(readFileSync(file,'utf8'));assert.equal(config.daemon.listen,'127.0.0.1:9999');assert.equal(config.agents.providers.existing.enabled,true);assert.deepEqual(config.agents.providers.paseodog.command,[process.execPath,options.enginePath]);assert.equal(config.plugins,undefined);assert.ok(readdirSync(options.home).some(x=>x.includes('backup')));
});
test('malformed existing config fails without replacing it',t=>{const {options}=setup(t);mkdirSync(options.home,{mode:0o700});const file=join(options.home,'config.json');writeFileSync(file,'broken');assert.throws(()=>configure({...options,trustPlugins:true}));assert.equal(readFileSync(file,'utf8'),'broken');});
test('Node compatibility checker matches upstream supported ranges',()=>{
    for(const version of ['22.19.0','22.20.1','24.0.0','26.1.0'])assert.equal(supportedNode(version),true);
    for(const version of ['20.20.0','22.16.0','23.9.0'])assert.equal(supportedNode(version),false);
});
