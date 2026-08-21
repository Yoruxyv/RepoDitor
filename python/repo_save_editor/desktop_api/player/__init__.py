"""Desktop adapters for player identity, avatars, and dynamic upgrades.

The package converts player service results into renderer-safe DTOs. Health and
upgrade rules remain service-owned, while optional Steam enrichment must stay
fail-soft and must never become save data.
"""
