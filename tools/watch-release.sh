#!/bin/bash
# usage: tools/watch-release.sh Release <commit-sha-prefix>
# Waits for that commit's run of the workflow to finish, then prints each job, failed steps and error annotations.
API=https://api.github.com/repos/spamadrienneswiss-creator/command-deck
NAME="$1"; SHA="$2"
for i in $(seq 1 120); do
  RUN=$(curl -sS "$API/actions/runs?per_page=10" | python3 -c "
import json,sys
d=json.load(sys.stdin)
r=[x for x in d.get('workflow_runs',[]) if x['name']==sys.argv[1] and x['head_sha'].startswith(sys.argv[2])]
print(f\"{r[0]['id']} {r[0]['status']} {r[0]['conclusion']}\" if r else '')" "$NAME" "$SHA")
  set -- $RUN
  if [ "$2" = "completed" ]; then break; fi
  sleep 20
done
echo "RUN $RUN"
curl -sS "$API/actions/runs/$1/jobs" | python3 -c "
import json,sys
for j in json.load(sys.stdin)['jobs']:
  print('JOB', j['name'], j['conclusion'], j.get('check_run_url','').split('/')[-1])
  for s in j['steps']:
    if s['conclusion'] not in ('success','skipped'): print('   step', s['name'], s['conclusion'])"
for cr in $(curl -sS "$API/actions/runs/$1/jobs" | python3 -c "import json,sys; [print(j['check_run_url'].split('/')[-1]) for j in json.load(sys.stdin)['jobs'] if j['conclusion']!='success']"); do
  curl -sS "$API/check-runs/$cr/annotations" | python3 -c "import json,sys; [print('  ANN', a['annotation_level'], a.get('title',''), a['message'][-1500:]) for a in json.load(sys.stdin)]"
done
