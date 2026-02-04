package cloudflare

import (
	"context"
	"fmt"

	"github.com/go-logr/logr"
)

// TunnelService handles tunnel-specific operations.
// It wraps the unified Client interface with cfgate-specific logic for
// idempotent tunnel lifecycle management including ensure, configure, and delete.
type TunnelService struct {
	client Client
	log    logr.Logger
}

// NewTunnelService creates a new TunnelService with the given client and logger.
// The logger is named "tunnel-service" for structured logging context.
func NewTunnelService(client Client, log logr.Logger) *TunnelService {
	return &TunnelService{
		client: client,
		log:    log.WithName("tunnel-service"),
	}
}

// EnsureTunnel ensures a tunnel exists with the given name.
// If a tunnel with the name exists, it is adopted. Otherwise, a new tunnel is created.
// Uses ConfigSrc "cloudflare" for remote management via the Cloudflare dashboard.
// Returns the tunnel, whether it was created (true) or adopted (false), and any error.
func (s *TunnelService) EnsureTunnel(ctx context.Context, accountID, name string) (*Tunnel, bool, error) {
	s.log.Info("ensuring tunnel exists",
		"accountID", accountID,
		"name", name,
	)

	// Try to find existing tunnel by name
	existing, err := s.client.GetTunnelByName(ctx, accountID, name)
	if err != nil {
		return nil, false, fmt.Errorf("failed to check for existing tunnel: %w", err)
	}

	// Tunnel exists, adopt it
	if existing != nil {
		s.log.V(1).Info("tunnel already exists, adopting",
			"tunnelId", existing.ID,
		)
		return existing, false, nil
	}

	// Create new tunnel with remote management
	tunnel, err := s.client.CreateTunnel(ctx, accountID, CreateTunnelParams{
		Name:      name,
		ConfigSrc: "cloudflare", // Remote management
	})
	if err != nil {
		return nil, false, fmt.Errorf("failed to create tunnel: %w", err)
	}

	s.log.Info("created new tunnel",
		"accountID", accountID,
		"name", name,
		"tunnelId", tunnel.ID,
	)

	return tunnel, true, nil
}

// GetToken retrieves the tunnel token for cloudflared authentication.
// The token is used by cloudflared deployments to connect to Cloudflare's edge.
func (s *TunnelService) GetToken(ctx context.Context, accountID, tunnelID string) (string, error) {
	s.log.V(1).Info("retrieving tunnel token",
		"tunnelId", tunnelID,
	)

	token, err := s.client.GetTunnelToken(ctx, accountID, tunnelID)
	if err != nil {
		return "", fmt.Errorf("failed to get tunnel token: %w", err)
	}

	return token, nil
}

// UpdateConfiguration updates the tunnel's ingress configuration.
// It performs an atomic replacement of the entire configuration.
// A catch-all rule is automatically added if not present.
func (s *TunnelService) UpdateConfiguration(ctx context.Context, accountID, tunnelID string, config TunnelConfiguration) error {
	s.log.Info("updating tunnel configuration",
		"tunnelId", tunnelID,
		"ingressCount", len(config.Ingress),
	)

	// Ensure catch-all rule exists
	config = ensureCatchAllRule(config)

	err := s.client.UpdateTunnelConfiguration(ctx, accountID, tunnelID, config)
	if err != nil {
		return fmt.Errorf("failed to update tunnel configuration: %w", err)
	}

	return nil
}

// Delete deletes a tunnel and all its connections.
// It first deletes all connections (required by Cloudflare API), then deletes the tunnel.
// If the tunnel is already deleted, this operation succeeds (idempotent).
func (s *TunnelService) Delete(ctx context.Context, accountID, tunnelID string) error {
	s.log.Info("deleting tunnel",
		"tunnelId", tunnelID,
	)

	// First, delete all connections
	err := s.client.DeleteTunnelConnections(ctx, accountID, tunnelID)
	if err != nil {
		s.log.Error(err, "failed to delete tunnel connections, continuing with tunnel deletion",
			"tunnelId", tunnelID,
		)
		// Continue with tunnel deletion even if connection deletion fails
	}

	// Then delete the tunnel
	err = s.client.DeleteTunnel(ctx, accountID, tunnelID)
	if err != nil {
		return fmt.Errorf("failed to delete tunnel: %w", err)
	}

	return nil
}

// IsHealthy checks if a tunnel has healthy connections.
// Health is determined by the tunnel's status field, which reflects connection state.
// Returns true for "healthy" or "active" status, false otherwise.
// If the tunnel doesn't exist, returns false with no error.
func (s *TunnelService) IsHealthy(ctx context.Context, accountID, tunnelID string) (bool, error) {
	tunnel, err := s.client.GetTunnel(ctx, accountID, tunnelID)
	if err != nil {
		return false, fmt.Errorf("failed to get tunnel: %w", err)
	}

	if tunnel == nil {
		return false, nil
	}

	healthy := tunnel.Status == "healthy" || tunnel.Status == "active"
	s.log.V(1).Info("checked tunnel health",
		"tunnelId", tunnelID,
		"status", tunnel.Status,
		"healthy", healthy,
	)

	return healthy, nil
}

// BuildConfiguration builds a TunnelConfiguration from ingress rules.
// It adds the required catch-all rule if not present.
func BuildConfiguration(rules []IngressRule, defaults *OriginRequestConfig) TunnelConfiguration {
	config := TunnelConfiguration{
		Ingress:       rules,
		OriginRequest: defaults,
	}

	return ensureCatchAllRule(config)
}

// ensureCatchAllRule ensures the configuration has a catch-all rule at the end.
func ensureCatchAllRule(config TunnelConfiguration) TunnelConfiguration {
	if len(config.Ingress) == 0 {
		// Add a catch-all rule
		config.Ingress = append(config.Ingress, IngressRule{
			Service: "http_status:404",
		})
		return config
	}

	// Check if last rule is a catch-all (no hostname)
	lastRule := config.Ingress[len(config.Ingress)-1]
	if lastRule.Hostname == "" && lastRule.Path == "" {
		// Already has catch-all
		return config
	}

	// Add catch-all rule at the end
	config.Ingress = append(config.Ingress, IngressRule{
		Service: "http_status:404",
	})

	return config
}

// TunnelDomain returns the CNAME target domain for a tunnel.
func TunnelDomain(tunnelID string) string {
	return fmt.Sprintf("%s.cfargotunnel.com", tunnelID)
}
