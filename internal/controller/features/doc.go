// Package features provides CRD detection and feature flags for optional
// Gateway API resources, enabling graceful degradation when experimental
// CRDs are unavailable.
//
// cfgate supports multiple Gateway API route types, but not all CRDs are
// required or present in every cluster. This package detects which optional
// CRDs are installed and exposes feature flags for conditional behavior.
//
// # Detected CRDs
//
// The package checks for these optional Gateway API CRDs:
//
//   - TCPRoute (v1alpha2/experimental): TCP proxy support via Cloudflare Spectrum
//   - UDPRoute (v1alpha2/experimental): UDP proxy support via Cloudflare Spectrum
//   - GRPCRoute (v1/GA): gRPC routing (GA but may not be installed in minimal deployments)
//   - ReferenceGrant (v1beta1/standard): Cross-namespace secret/service references
//
// HTTPRoute (v1/GA) is assumed always present since Gateway API is a prerequisite.
//
// # Usage
//
// Detect features at manager startup using the discovery client:
//
//	dc, err := discovery.NewDiscoveryClientForConfig(mgr.GetConfig())
//	if err != nil {
//	    return err
//	}
//	gates, err := features.DetectFeatures(dc)
//	if err != nil {
//	    return err
//	}
//	gates.LogFeatures(setupLog)
//
// Pass FeatureGates to reconcilers that need conditional behavior:
//
//	reconciler := &CloudflareAccessPolicyReconciler{
//	    Client:       mgr.GetClient(),
//	    FeatureGates: gates,
//	}
//
// # Conditional Watches
//
// Use feature gates to conditionally register watches in SetupWithManager:
//
//	if r.FeatureGates != nil && r.FeatureGates.HasGRPCRouteSupport() {
//	    controllerBuilder = controllerBuilder.Watches(
//	        &gateway.GRPCRoute{},
//	        handler.EnqueueRequestsFromMapFunc(r.findPoliciesForGRPCRoute),
//	    )
//	}
//
// # Defensive Checks
//
// Controllers for optional CRDs should verify the CRD exists before registration:
//
//	func (r *TCPRouteReconciler) SetupWithManager(mgr ctrl.Manager) error {
//	    if r.FeatureGates != nil && !r.FeatureGates.HasTCPRouteSupport() {
//	        log.V(1).Info("TCPRoute CRD not found, skipping controller registration")
//	        return nil
//	    }
//	    return ctrl.NewControllerManagedBy(mgr).
//	        For(&gwapiv1alpha2.TCPRoute{}).
//	        Complete(r)
//	}
//
// # Nil Safety
//
// All FeatureGates checks include nil guards to support testing without
// feature detection:
//
//	if r.FeatureGates != nil && r.FeatureGates.HasGRPCRouteSupport() {
//	    // Feature available
//	}
//
// This allows tests to skip feature gate injection and provides backward
// compatibility during gradual integration.
//
// # Detection Behavior
//
// Detection failures are non-fatal; features default to disabled. This ensures
// the controller can start even if detection fails for some CRDs. If the API
// server is unreachable, DetectFeatures returns an error and the manager should
// fail fast rather than start with incomplete feature state.
//
// CRD availability is detected once at startup and cached for the controller
// lifetime, since CRDs don't typically change at runtime.
//
// # Logging
//
// LogFeatures logs detection results at Info level:
//
//	gates.LogFeatures(setupLog)
//	// Output: "Gateway API feature detection complete" tcpRouteAvailable=true ...
//
// Missing experimental features are logged at V(1) with install hints:
//
//	// V(1): "TCPRoute CRD not found, TCP routing disabled"
//	//       requiredVersion=v1alpha2 installHint="Install Gateway API experimental channel CRDs"
package features
