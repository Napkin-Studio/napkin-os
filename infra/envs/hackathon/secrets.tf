# Values are never in Terraform. Put each by hand after the apply:
#   aws secretsmanager put-secret-value --secret-id napkin-hackathon/RUNWAY_API_KEY --secret-string '...'
# SERVICE_KEY is napkin-web's service credential (features/production-jobs-via-host.clan): any random
# string of 32+ characters (openssl rand -hex 32). napkin-web sends it as `Authorization: Bearer` and signs
# the X-Napkin-User claim with it; the relay refuses every route but GET /health and GET /config without
# it. The web task reads the same secret (the secret_ids output names it). During a rotation it holds
# 'new,old': the relay accepts either, napkin-web signs with the first.
# TOKEN_SECRET (32+ characters too) signs only the Deck's read-only assets pass (aud 'assets'), which
# napkin-web hands the deck build; it is the one remaining user of the old X-Napkin-Identity header.
# The relay copies them into its environment at a cold start, and the identity check re-reads
# them at most every 5 minutes on a warm instance, so a put takes effect within 5 minutes.

locals {
  secret_names = ["RUNWAY_API_KEY", "ANTHROPIC_API_KEY", "TOKEN_SECRET", "SERVICE_KEY"]
}

resource "aws_secretsmanager_secret" "relay" {
  for_each                = toset(local.secret_names)
  name                    = "${local.name}/${each.key}"
  description             = "Production Tool relay: ${each.key} (value put by hand)"
  recovery_window_in_days = 0
}
