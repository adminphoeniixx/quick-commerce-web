const base = process.env.LOAD_BASE_URL || "http://127.0.0.1:3000";
const cookie = process.env.LOAD_COOKIE;
const concurrency = Math.max(1, Number(process.env.LOAD_CONCURRENCY || 10));
const requests = Math.max(1, Number(process.env.LOAD_REQUESTS || 100));
if (!cookie) throw new Error("Set LOAD_COOKIE to a non-production test session cookie");
let cursor = 0, ok = 0, failed = 0; const latencies = [];
async function runner() { while (cursor++ < requests) { const started = performance.now(); const response = await fetch(`${base}/api/imports?page_size=20`, { headers: { cookie } }); latencies.push(performance.now()-started); response.ok ? ok++ : failed++; } }
await Promise.all(Array.from({length:concurrency},runner));
latencies.sort((a,b)=>a-b); const percentile = p => Math.round(latencies[Math.min(latencies.length-1,Math.floor(latencies.length*p))]||0);
console.log(JSON.stringify({requests,concurrency,ok,failed,p50Ms:percentile(.5),p95Ms:percentile(.95),p99Ms:percentile(.99)}));
if (failed) process.exitCode=1;
