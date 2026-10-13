#!/usr/bin/env python3
import argparse, hashlib, json, os, pathlib, platform, subprocess, sys, time

def sha256(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()

def run(cmd, timeout):
    started=time.time()
    p=subprocess.run(cmd, shell=True, text=True, capture_output=True, timeout=timeout)
    return {"command":cmd,"exitCode":p.returncode,"durationSeconds":round(time.time()-started,3),"stdout":p.stdout[-20000:],"stderr":p.stderr[-20000:]}

ap=argparse.ArgumentParser(description='Run an AeroOS assurance command and emit canonical evidence JSON. A PASS claim is emitted only for exit code 0.')
ap.add_argument('--control', required=True)
ap.add_argument('--command', required=True)
ap.add_argument('--output', required=True)
ap.add_argument('--timeout', type=int, default=3600)
ap.add_argument('--target', default='unspecified')
ap.add_argument('--environment', default=os.getenv('AEROOS_ASSURANCE_ENV','unspecified'))
a=ap.parse_args()
res=run(a.command,a.timeout)
manifest=pathlib.Path('RELEASE-MANIFEST.json')
evidence={
  "schema":"aeroos.assurance.evidence/v1",
  "control":a.control,
  "target":a.target,
  "environment":a.environment,
  "recordedAtEpoch":int(time.time()),
  "platformVersion":json.load(open('package.json'))['version'],
  "releaseManifestSha256":sha256(manifest) if manifest.exists() else None,
  "runner":{"hostname":platform.node(),"os":platform.platform(),"python":platform.python_version(),"githubRunId":os.getenv('GITHUB_RUN_ID'),"githubSha":os.getenv('GITHUB_SHA')},
  "result":res,
  "outcome":"PASS" if res['exitCode']==0 else "FAIL"
}
out=pathlib.Path(a.output); out.parent.mkdir(parents=True,exist_ok=True)
out.write_text(json.dumps(evidence,sort_keys=True,separators=(',',':'))+'\n')
print(out)
sys.exit(res['exitCode'])
