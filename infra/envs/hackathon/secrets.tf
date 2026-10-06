# Values are never in Terraform. Put each by hand after the apply:
#   aws secretsmanager put-secret-value --secret-id napkin-hackathon/RUNWAY_API_KEY --secret-string '...'
# EVENT_CODES is JSON: {"participant": ["..."], "organiser": ["..."]}
# TOKEN_SECRET is any random string of 32+ characters (openssl rand -hex 32).
# The relay copies them into its environment and re-reads them every 5 minutes.

locals {
  secret_names = ["RUNWAY_API_KEY", "FAL_KEY", "HEYGEN_API_KEY", "ANTHROPIC_API_KEY", "EVENT_CODES", "TOKEN_SECRET"]
}

resource "aws_secretsmanager_secret" "relay" {
  for_each                = toset(local.secret_names)
  name                    = "${local.name}/${each.key}"
  description             = "Production Tool relay: ${each.key} (value put by hand)"
  recovery_window_in_days = 0
}
