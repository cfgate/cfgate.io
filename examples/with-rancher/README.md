# Rancher Integration

Expose Rancher 2.14+ via cfgate using Gateway API.

## Prerequisites

- cfgate installed with tunnel and DNS sync configured
- Rancher Helm chart v2.14.0+ (Gateway API support)

## Key Configuration

Rancher v2.14+ creates its own Gateway and HTTPRoute when using `networkExposure.type: gateway`. The Gateway needs cfgate annotations added **post-install**.

### Helm Values

```yaml
# rancher-values.yaml
replicas: 1

networkExposure:
  type: "gateway"

gateway:
  gatewayClass:
    name: "cfgate"
    ports:
      http: 80
  tls:
    source: external  # Cloudflare terminates TLS

tls: external
hostname: rancher.example.com
```

### Post-Install Annotations

Rancher's Gateway requires cfgate annotations:

```bash
kubectl annotate gateway rancher-gateway -n cattle-system \
  cfgate.io/tunnel-ref=cfgate-system/<tunnel-name> \
  cfgate.io/dns-sync=enabled
```

## Setup

1. **Install cfgate prerequisites**

```bash
kubectl apply -k examples/with-rancher/cfgate
```

2. **Install Rancher**

```bash
helm upgrade --install rancher rancher-alpha/rancher \
  --namespace cattle-system \
  --create-namespace \
  --values examples/with-rancher/rancher-values.yaml \
  --set hostname=rancher.example.com
```

3. **Add Gateway annotations**

```bash
kubectl annotate gateway rancher-gateway -n cattle-system \
  cfgate.io/tunnel-ref=cfgate-system/rancher-tunnel \
  cfgate.io/dns-sync=enabled
```

4. **Verify**

```bash
# Check Gateway status
kubectl get gateway rancher-gateway -n cattle-system -o wide

# Check DNS sync
kubectl get cloudflarednssyncs -n cfgate-system

# Test connectivity
curl -I https://rancher.example.com
```

## TLS Handling

```
Browser ──HTTPS──▶ Cloudflare Edge (TLS termination)
                        │
                        │ X-Forwarded-Proto: https
                        ▼
                   cloudflared ──HTTP──▶ Rancher:80
```

Rancher respects `X-Forwarded-Proto` header and skips HTTPS redirect when `tls: external` is set. Cloudflare edge adds this header automatically.
