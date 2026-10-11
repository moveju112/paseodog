import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
test('source archive has valid hashes, safe paths and no runtime state or dependencies',t=>{
    const dir=mkdtempSync(join(tmpdir(),'paseodog-package-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
    const output=join(dir,'release.zip');const built=spawnSync('python3',['scripts/package.py','--output',output],{cwd:root,encoding:'utf8'});assert.equal(built.status,0,built.stderr);
    const check=spawnSync('python3',['-c',`import zipfile,hashlib,sys\nwith zipfile.ZipFile(sys.argv[1]) as z:\n names=z.namelist()\n assert all(n.startswith('paseodog/') and '..' not in n.split('/') for n in names)\n assert all('node_modules/' not in n and '.local.' not in n for n in names)\n for line in z.read('paseodog/MANIFEST.sha256').decode().splitlines():\n  digest,name=line.split('  ',1)\n  assert hashlib.sha256(z.read('paseodog/'+name)).hexdigest()==digest\n assert z.testzip() is None\n`,output],{encoding:'utf8'});assert.equal(check.status,0,check.stderr);
});
