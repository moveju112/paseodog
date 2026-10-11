// Consumes measured runs; never fabricates Mixdog's marketing savings rate.
import {readFileSync} from 'node:fs';
const [basePath,newPath]=process.argv.slice(2);
if(!basePath||!newPath){console.error('Usage: node scripts/benchmark-report.mjs baseline.json candidate.json');process.exit(2);}
function load(path){const rows=JSON.parse(readFileSync(path,'utf8'));if(!Array.isArray(rows)||!rows.length)throw new Error('Each file must contain nonempty measured run records');const ids=new Set();for(const r of rows){if(!r.task||ids.has(r.task)||typeof r.success!=='boolean')throw new Error('Unique task IDs and success booleans required');ids.add(r.task);for(const k of ['inputTokens','cachedInputTokens','outputTokens','wallMs'])if(!Number.isFinite(r[k])||r[k]<0)throw new Error(`Invalid ${k}`);}return rows;}
try{const baseline=load(basePath),candidate=load(newPath);if(baseline.length!==candidate.length)throw new Error('Task sets differ');
const byId=new Map(candidate.map(x=>[x.task,x]));for(const row of baseline){const other=byId.get(row.task);if(!other||other.model!==row.model||other.effort!==row.effort)throw new Error('Tasks must use identical model and effort settings');}
const sum=rows=>rows.reduce((a,r)=>({tokens:a.tokens+r.inputTokens+r.outputTokens,cached:a.cached+r.cachedInputTokens,success:a.success+Number(r.success),wallMs:a.wallMs+r.wallMs}),{tokens:0,cached:0,success:0,wallMs:0});
const b=sum(baseline),c=sum(candidate);console.log(JSON.stringify({baseline:b,candidate:c,totalTokenReduction:b.tokens?1-c.tokens/b.tokens:null,note:'inputTokens must already INCLUDE cachedInputTokens; do not double-count. Token reduction is not dollar-cost reduction. Include cache-write, summary and subagent usage in source measurements.'},null,2));}
catch(e){console.error(e.message);process.exitCode=1;}
