#!/usr/bin/env bash
# Prove autoscaling and self-healing actually work, on the live cluster.
#
#   ./infra/scripts/loadtest.sh hpa      # traffic -> frontend pods scale out
#   ./infra/scripts/loadtest.sh nodes    # capacity pressure -> a third NODE appears
#   ./infra/scripts/loadtest.sh heal     # kill a pod -> it comes back by itself
#   ./infra/scripts/loadtest.sh all      # all three, in order
#
# WHY THERE ARE TWO SEPARATE SCALING TESTS
#
# "Send lots of requests and watch a node appear" does not work on this cluster, and it
# is worth knowing why before a demo rather than during one.
#
# Cluster Autoscaler reacts to PENDING PODS — pods the scheduler cannot place. It does
# not read CPU graphs. Traffic makes existing pods busy, and the HPA answers that by
# adding replicas; a node is only added if those replicas do not FIT.
#
# Measured on this cluster: 1930m allocatable per node, ~1770m already requested across
# both, so roughly 2090m is free. The HPA tops out at 6 x 100m = 600m. Every replica it
# can create fits on the nodes that already exist, so `hpa` will never add a node no
# matter how hard it is driven. That is the autoscaler working correctly, not failing.
#
# `nodes` therefore applies the pressure that actually forces the decision: pods that
# RESERVE more CPU than is free. They do nothing and use nothing; the reservation alone
# is what the scheduler cannot satisfy.
#
# Everything created here is labelled helpdesk-loadtest and removed on exit, including
# on Ctrl-C.

set -euo pipefail

# Git Bash / MSYS rewrites any argument that looks like a POSIX path into a Windows one
# before the process ever sees it, so `-- /bin/sh -c ...` reaches Kubernetes as
# "C:/Program Files/Git/usr/bin/sh" and every load generator dies at StartError:
#
#   exec: "C:/Program Files/Git/usr/bin/sh": stat ...: no such file or directory
#
# The pods are created, so the test looks like it is running, and then measures nothing
# — CPU stays at 1% and the HPA is blamed for not scaling. Harmless on Linux and macOS,
# where the variable is simply ignored.
export MSYS_NO_PATHCONV=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${REPO_ROOT}/infra/terraform/terraform.env"
NS=helpdesk
MODE="${1:-all}"

[ -f "$ENV_FILE" ] && { . "$ENV_FILE"; } || true

command -v kubectl >/dev/null 2>&1 || { echo "ERROR: kubectl not on PATH." >&2; exit 1; }
kubectl -n "$NS" get deploy frontend >/dev/null 2>&1 || {
  echo "ERROR: no frontend Deployment in '${NS}'. Is the cluster up and deployed?" >&2
  exit 1
}

cleanup() {
  echo
  echo "==> Cleaning up load generators"
  kubectl -n "$NS" delete deploy -l helpdesk-loadtest=true --ignore-not-found --wait=false >/dev/null 2>&1 || true
  echo "    removed (the HPA scales back down on its own after its 5m window)"
}
trap cleanup EXIT INT TERM

snapshot() {
  echo "    nodes:    $(kubectl get nodes --no-headers 2>/dev/null | grep -c Ready)"
  echo "    frontend: $(kubectl -n "$NS" get deploy frontend -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo 0) ready"
  kubectl -n "$NS" get hpa frontend --no-headers 2>/dev/null | awk '{print "    hpa:      cpu="$4" replicas="$7"/"$6}'
}

# ---------------------------------------------------------------------------
# 1. HPA — traffic makes the frontend scale out
# ---------------------------------------------------------------------------
test_hpa() {
  echo
  echo "==============================================================="
  echo " HPA TEST — drive CPU, expect frontend replicas to grow"
  echo "==============================================================="
  echo "==> Before"; snapshot

  # Hits the Service from inside the cluster rather than the public IP: this is a test
  # of pod scaling, and routing it through the single ingress node would measure that
  # node's limits instead.
  echo
  echo "==> Starting 10 load generators against frontend:3000"
  kubectl -n "$NS" create deployment loadgen-hpa \
    --image=busybox:1.36 --replicas=10 \
    -- /bin/sh -c 'while true; do wget -q -O /dev/null http://frontend:3000/login 2>/dev/null || true; done' >/dev/null
  kubectl -n "$NS" label deploy loadgen-hpa helpdesk-loadtest=true --overwrite >/dev/null

  echo "==> Watching the HPA for up to 5 minutes (metrics lag ~60s, be patient)"
  START=$(kubectl -n "$NS" get deploy frontend -o jsonpath='{.spec.replicas}' 2>/dev/null || echo 2)
  for i in $(seq 1 30); do
    sleep 10
    LINE=$(kubectl -n "$NS" get hpa frontend --no-headers 2>/dev/null || echo "")
    REPL=$(kubectl -n "$NS" get deploy frontend -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "$START")
    echo "    [$((i * 10))s] $(printf '%s' "$LINE" | awk '{print "cpu="$4" replicas="$7"/"$6}')"
    if [ "${REPL:-0}" -gt "${START:-2}" ]; then
      echo
      echo "    PASS: frontend scaled ${START} -> ${REPL}"
      return 0
    fi
  done
  echo
  echo "    INCONCLUSIVE: no scale-out within 5 minutes." >&2
  echo "    Check: kubectl -n ${NS} describe hpa frontend" >&2
  echo "    'targets: <unknown>' means metrics-server is not reporting — the HPA cannot" >&2
  echo "    compute a percentage without it, and will never scale." >&2
  return 1
}

# ---------------------------------------------------------------------------
# 2. Cluster Autoscaler — unschedulable pods make a node appear
# ---------------------------------------------------------------------------
test_nodes() {
  echo
  echo "==============================================================="
  echo " NODE TEST — reserve more CPU than is free, expect a 3rd node"
  echo "==============================================================="
  echo "==> Before"; snapshot
  BEFORE=$(kubectl get nodes --no-headers 2>/dev/null | grep -c Ready)

  # pause does nothing at all — it exists to hold a resource RESERVATION. 4 x 700m =
  # 2800m against ~2090m free, so the scheduler can place some and not the rest, and
  # the leftovers sit Pending. Pending is the only signal Cluster Autoscaler acts on.
  echo
  echo "==> Requesting 4 x 700m CPU (~2800m against ~2090m free)"
  kubectl -n "$NS" create deployment loadgen-capacity \
    --image=registry.k8s.io/pause:3.9 --replicas=4 >/dev/null
  kubectl -n "$NS" set resources deployment loadgen-capacity --requests=cpu=700m >/dev/null
  kubectl -n "$NS" label deploy loadgen-capacity helpdesk-loadtest=true --overwrite >/dev/null

  echo "==> Watching for a new node for up to 6 minutes (EC2 boot + join takes ~2-4m)"
  for i in $(seq 1 36); do
    sleep 10
    PENDING=$(kubectl -n "$NS" get pods -l app=loadgen-capacity --no-headers 2>/dev/null | grep -c Pending || true)
    NOW=$(kubectl get nodes --no-headers 2>/dev/null | grep -c Ready)
    echo "    [$((i * 10))s] pending=${PENDING} nodes_ready=${NOW}"
    if [ "${NOW:-0}" -gt "${BEFORE:-2}" ]; then
      echo
      echo "    PASS: node count ${BEFORE} -> ${NOW}"
      return 0
    fi
  done
  echo
  echo "    INCONCLUSIVE: no new node within 6 minutes." >&2
  echo "    Check: kubectl -n kube-system logs deploy/cluster-autoscaler --tail=50" >&2
  echo "    'max node group size reached' means node_max_size is already hit." >&2
  return 1
}

# ---------------------------------------------------------------------------
# 3. Self-healing — a deleted pod comes back without help
# ---------------------------------------------------------------------------
test_heal() {
  echo
  echo "==============================================================="
  echo " SELF-HEALING TEST — delete a pod, expect a replacement"
  echo "==============================================================="
  POD=$(kubectl -n "$NS" get pods -l app=frontend -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
  echo "==> Deleting ${POD}"
  kubectl -n "$NS" delete pod "$POD" --wait=false >/dev/null

  for i in $(seq 1 24); do
    sleep 5
    READY=$(kubectl -n "$NS" get deploy frontend -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo 0)
    DESIRED=$(kubectl -n "$NS" get deploy frontend -o jsonpath='{.spec.replicas}' 2>/dev/null || echo 1)
    echo "    [$((i * 5))s] ready=${READY}/${DESIRED}"
    if [ "${READY:-0}" -ge "${DESIRED:-1}" ] && ! kubectl -n "$NS" get pod "$POD" >/dev/null 2>&1; then
      echo
      echo "    PASS: replacement pod is serving and ${POD} is gone"
      return 0
    fi
  done
  echo
  echo "    INCONCLUSIVE: deployment did not return to full readiness in 2 minutes." >&2
  return 1
}

echo "==============================================================="
echo " helpdesk autoscaling / self-healing test — mode: ${MODE}"
echo "==============================================================="

RC=0
case "$MODE" in
  hpa)   test_hpa   || RC=1 ;;
  nodes) test_nodes || RC=1 ;;
  heal)  test_heal  || RC=1 ;;
  all)
    test_heal  || RC=1
    test_hpa   || RC=1
    test_nodes || RC=1
    ;;
  *) echo "usage: $0 [hpa|nodes|heal|all]" >&2; exit 2 ;;
esac

echo
echo "==============================================================="
[ "$RC" -eq 0 ] && echo " RESULT: all requested checks passed" || echo " RESULT: at least one check was inconclusive — see above"
echo "==============================================================="
echo
echo "Scale-down is deliberately slower than scale-up: the HPA holds for 5 minutes and"
echo "the autoscaler removes an idle node after ~2. The extra node keeps billing until"
echo "it goes, so check 'kubectl get nodes' before walking away."
exit "$RC"
