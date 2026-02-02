# Multi-Service Example

Multiple services exposed through a single Cloudflare tunnel.

## Overview

```
api.example.com    ──┐
                     ├──▶ cloudflared ──▶ Cloudflare Edge
web.example.com    ──┘
```

## Setup

1. **Create namespace and credentials** (see [basic example](../basic))

2. **Edit hostnames** in `httproutes.yaml`

3. **Apply**

```bash
kubectl apply -k examples/multi-service
```

## Components

- One `CloudflareTunnel` with 2 replicas
- One `Gateway` shared by all routes
- One `CloudflareDNSSync` watching all HTTPRoutes
- Two services: `api` and `web`
- Two HTTPRoutes with different hostnames

## Adding More Services

1. Create deployment + service
2. Add HTTPRoute referencing the shared Gateway
3. DNS record is automatically created by CloudflareDNSSync
