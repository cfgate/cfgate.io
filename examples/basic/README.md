# Basic Example

Minimal cfgate setup with a single tunnel exposing one service.

## Prerequisites

- cfgate controller installed (`kubectl apply -k config/default`)
- Gateway API CRDs installed
- Cloudflare credentials

## Setup

1. **Create namespace and secret**

```bash
kubectl create namespace demo
kubectl create secret generic cloudflare-credentials \
  -n cfgate-system \
  --from-literal=CLOUDFLARE_API_TOKEN=<your-token>
```

2. **Edit configuration**

Update `kustomization.yaml`:
- Set `CLOUDFLARE_ACCOUNT_ID`
- Set hostname in `httproute.yaml`

3. **Apply**

```bash
kubectl apply -k examples/basic
```

4. **Verify**

```bash
# Check tunnel status
kubectl get cloudflaretunnel -n cfgate-system

# Check DNS sync
kubectl get cloudflarednssyncs -n cfgate-system -o wide

# Check HTTPRoute
kubectl get httproute -n demo
```

## Components

| File | Purpose |
|------|---------|
| `tunnel.yaml` | Creates Cloudflare tunnel, deploys cloudflared pods |
| `gateway.yaml` | GatewayClass + Gateway with tunnel reference |
| `dnssync.yaml` | Syncs HTTPRoute hostnames to Cloudflare DNS |
| `echo-service.yaml` | Demo echo server |
| `httproute.yaml` | Routes `echo.example.com` to echo service |

## Cleanup

```bash
kubectl delete -k examples/basic
```
