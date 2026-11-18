# Values are never in Terraform. Put each by hand after the apply:
#   aws secretsmanager put-secret-value --secret-id napkin-hackathon/RUNWAY_API_KEY --secret-string '...'
# TOKEN_SECRET is any random string of 32+ characters (openssl rand -hex 32). napkin-web's
# /production/api proxy signs X-Napkin-Identity with it (the staging web task reads the same
# secret), and the relay checks it (features/os-sign-in.clan). During a rotation it holds
# 'new,old': the relay accepts either, napkin-web signs with the first.
# The relay copies them into its environment at a cold start, and the identity check re-reads
# them at most every 5 minutes on a warm instance, so a put takes effect within 5 minutes.

locals {
  secret_names = ["RUNWAY_API_KEY", "ANTHROPIC_API_KEY", "TOKEN_SECRET"]
}

resource "aws_secretsmanager_secret" "relay" {
  for_each                = toset(local.secret_names)
  name                    = "${local.name}/${each.key}"
  description             = "Production Tool relay: ${each.key} (value put by hand)"
  recovery_window_in_days = 0
}
