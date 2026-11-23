variable "name" {
  description = "Prefix for every resource, e.g. napkin-staging"
  type        = string
}

variable "region" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  description = "Where the load balancer listens"
  type        = list(string)
}

variable "private_subnet_ids" {
  description = "Where the services run (no public IP; out through the NAT)"
  type        = list(string)
}

variable "data_clients_security_group_id" {
  description = "Membership reaches Aurora and Qdrant; given to the middleware"
  type        = string
}

variable "kms_key_arn" {
  description = "The customer key: EFS, logs, secrets"
  type        = string
}

variable "extra_kms_key_arns" {
  description = "Other keys the tasks' secrets are encrypted with (UAT reading staging's layer secrets)"
  type        = list(string)
  default     = []
}

variable "session_secret_arn" {
  description = "NAPKIN_SESSION_SECRET (Secrets Manager), from the identity module"
  type        = string
}

variable "cognito_client_id" {
  type = string
}

variable "github_repository" {
  description = "owner/repo whose main branch may deploy, e.g. Napkin-Studio/napkin-os"
  type        = string
}

variable "github_repository_ids" {
  description = "The same repository as GitHub's immutable OIDC subject names it, owner@id/repo@id (gh api repos/OWNER/REPO/actions/oidc/customization/sub); empty when it uses the name"
  type        = string
  default     = ""
}

variable "deploy_refs" {
  description = "Git refs whose workflow runs may assume the deploy role. Staging and production: main only. The UAT stack also takes develop, where its deploy workflow is run from; the branch to build is a workflow input."
  type        = list(string)
  default     = ["refs/heads/main"]
}

variable "github_oidc_provider_arn" {
  description = "An existing token.actions.githubusercontent.com provider (one per account); empty creates it"
  type        = string
  default     = ""
}

variable "certificate_arn" {
  description = "ACM certificate for HTTPS; empty serves HTTP only (cookies then are not Secure)"
  type        = string
  default     = ""
}

variable "web_auth" {
  description = "How people sign in to napkin-web: cognito (user@agency and a password, the user pool) or roster (a user name and agency on the image's roster, no password; features/no-password-sign-in.clan)"
  type        = string
  default     = "cognito"
  validation {
    condition     = contains(["cognito", "roster"], var.web_auth)
    error_message = "web_auth is cognito or roster"
  }
}

variable "web_dogfood" {
  description = "Record everything consenting accounts do in napkin-web (NAPKIN_DOGFOOD=1; features/dogfood-telemetry.clan). For a dogfood environment only, never production."
  type        = bool
  default     = false
}

variable "production_relay_url" {
  description = "The Production Tool relay napkin-web proxies /production/api to (NAPKIN_PRODUCTION_RELAY_URL; the hackathon stack's relay_function_url). Empty: no /production and no 'Make an ad' card (features/os-sign-in.clan)."
  type        = string
  default     = ""
}

variable "production_relay_secret_arn" {
  description = "Secrets Manager ARN of the key napkin-web signs X-Napkin-Identity with (NAPKIN_PRODUCTION_RELAY_SECRET; the hackathon stack's TOKEN_SECRET). Set together with production_relay_url."
  type        = string
  default     = ""
  validation {
    condition     = (var.production_relay_secret_arn == "") == (var.production_relay_url == "")
    error_message = "production_relay_url and production_relay_secret_arn are set together, or neither"
  }
}

variable "production_service_key_arn" {
  description = "Secrets Manager ARN of napkin-web's service key for the relay (NAPKIN_PRODUCTION_SERVICE_KEY; the hackathon stack's SERVICE_KEY, napkin-hackathon/SERVICE_KEY): every call but the Deck's picture pass carries it as a bearer and signs the user claim with it (features/production-jobs-via-host.clan). Set together with production_relay_url."
  type        = string
  default     = ""
  validation {
    condition     = (var.production_service_key_arn == "") == (var.production_relay_url == "")
    error_message = "production_relay_url and production_service_key_arn are set together, or neither"
  }
}

variable "middleware_runlog" {
  description = "Keep the middleware's per-job run log (sizes and costs; bodies only with middleware_runlog_bodies) on web's EFS under /data/_runlog, where napkin-web serves and purges it (NAPKIN_RUNLOG_DIR; features/dogfood-log-quality.clan). Dogfood environments only."
  type        = bool
  default     = false
}

variable "middleware_runlog_bodies" {
  description = "Also log what each model call and search sent and got back in the run log (NAPKIN_RUNLOG_BODIES=1; middleware-api.md §10.16, features/brief-fact-provenance.clan). Needs middleware_runlog. Staging only, never production: the bodies hold client material."
  type        = bool
  default     = false
}

variable "web_count" {
  description = "Web tasks. One until app-frame tokens are shared between tasks (they live in memory)"
  type        = number
  default     = 1
}

variable "web_cpu" {
  description = "The studio task's CPU units (256 = a quarter vCPU); it waits on the middleware far more than it computes"
  type        = number
  default     = 256
}

variable "web_memory" {
  description = "The studio task's memory in MiB; 1024 leaves room for headless Chromium's PDF exports"
  type        = number
  default     = 1024
}

variable "spot" {
  description = "Run the tasks on Fargate Spot (about 70% cheaper; a task can be reclaimed with two minutes' warning and is replaced)"
  type        = bool
  default     = true
}

variable "middleware_count" {
  description = "Middleware tasks. 0 until the knowledge layers it requires (NAPKIN_LAYERS_URL) run on AWS"
  type        = number
  default     = 0
}

variable "middleware_secrets" {
  description = "The middleware's secrets: environment variable name -> Secrets Manager ARN, read at task start"
  type        = map(string)
  default     = {}
}

variable "middleware_env" {
  description = "Extra environment for the middleware (model, layers, research, retrieval)"
  type        = map(string)
  default     = {}
}

variable "deck_enabled" {
  description = "Run the Deck Maker engine (engine/deck/Dockerfile) as a second container of the middleware task: ECR repository <name>/deck, an EFS access point for its run cache, the middleware's NAPKIN_DECK_ENGINE_URL, and a task of 2048 CPU / 4096 MiB (features/deck-cloud.clan). Off: one container, no repository, no access point."
  type        = bool
  default     = false
}

variable "deck_memory" {
  description = "The deck container's hard memory limit in MiB (it is not essential: past it only the deck container is stopped). The rest of the task's 4096 is the middleware's."
  type        = number
  default     = 2048
}

variable "deck_max_usd" {
  description = "The most one deck run may spend on model calls (NAPKIN_DECK_MAX_USD); a deck costs about 0.50 to 1.25 USD"
  type        = string
  default     = "2.00"
}

variable "backup_enabled" {
  description = "Back up web's EFS (every project and library document) with AWS Backup: daily at 03:00 UTC, kept 35 days, in its own vault (features/production-in-library). Off by default; uat and staging turn it on."
  type        = bool
  default     = false
}

variable "production_media_base" {
  description = "The https base Production's pictures are served from (NAPKIN_PRODUCTION_MEDIA_BASE; the hackathon stack's CloudFront url). napkin-web tells the tool in /api/session as media_base. Empty: media_base is null."
  type        = string
  default     = ""
  validation {
    condition     = var.production_media_base == "" || startswith(var.production_media_base, "https://")
    error_message = "production_media_base is empty or an https:// address"
  }
}
