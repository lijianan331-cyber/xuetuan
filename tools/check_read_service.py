"""Small read-only probe. Outputs timings/counts only; never saves content or images.

Use --live for the configured project, or --endpoint for the isolated fixture server.
Stops when errors or long latencies indicate this should not be scaled further.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import re
import statistics
import time
import urllib.error
import urllib.request

def probe(endpoint, headers, concurrency, per_stage=16):
    kinds = [('boot', {}), ('feed', {'limit':20,'days':30}), ('map', {'mode':'food','west':101.67,'east':101.75,'south':2.80,'north':2.88,'zoom':14})]
    def once(i):
        kind, args = kinds[i % len(kinds)]
        body = json.dumps({'kind':kind,'args':args}).encode()
        req = urllib.request.Request(endpoint, data=body, headers=headers, method='POST')
        start = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                payload = r.read(); data = json.loads(payload)
                # The fixture wraps responses. Production PostgREST returns the JSON directly.
                data = data.get('data',data)
                ok = isinstance(data,dict) and data.get('version') == 2
                rows = len(data.get('rows',[])) if ok else 0
                return {'ok':ok,'status':r.status,'ms':round((time.monotonic()-start)*1000,1),'bytes':len(payload),'kind':kind,'rows':rows}
        except (urllib.error.URLError, TimeoutError, ValueError):
            return {'ok':False,'status':0,'ms':round((time.monotonic()-start)*1000,1),'bytes':0,'kind':kind,'rows':0}
    started=time.monotonic()
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        results=list(pool.map(once,range(per_stage)))
    ms=sorted(r['ms'] for r in results)
    return {'concurrency':concurrency,'requests':len(results),'errors':sum(not r['ok'] for r in results),
            'p50_ms':round(statistics.median(ms),1),'p95_ms':ms[max(0,__import__('math').ceil(len(ms)*.95)-1)],
            'max_ms':max(ms),'response_bytes':sum(r['bytes'] for r in results),'elapsed_seconds':round(time.monotonic()-started,2)}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--live',action='store_true');parser.add_argument('--endpoint');parser.add_argument('--output',required=True)
    args=parser.parse_args()
    if args.live == bool(args.endpoint): parser.error('Choose either --live or --endpoint')
    headers={'Content-Type':'application/json'}
    if args.live:
        source=(Path(__file__).resolve().parents[1]/'js/01-core.js').read_text(encoding='utf8')
        url=re.search(r"var SUPABASE_URL = '([^']+)'",source).group(1)
        key=re.search(r"var SUPABASE_KEY = '([^']+)'",source).group(1)
        endpoint=url+'/rest/v1/rpc/xuetuan_read_page';headers['apikey']=key
    else: endpoint=args.endpoint
    stages=[]
    for concurrent in [1,4,8]:
        result=probe(endpoint,headers,concurrent);stages.append(result);print(json.dumps(result),flush=True)
        if result['errors'] or result['p95_ms']>5000:break
    report={'environment':'production current data, anonymous read-only' if args.live else 'isolated synthetic HTTP/PostgreSQL fixture',
            'stages':stages,'note':'No uploads or production writes. This does not establish a maximum user capacity.'}
    Path(args.output).write_text(json.dumps(report,indent=2),encoding='utf8')
    raise SystemExit(1 if any(s['errors'] for s in stages) else 0)
