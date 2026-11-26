variable "env" {
  type    = string
  default = "uat"
}

# Ireland: close to the team, EU data for EU agencies. No residency constraint
# is known yet; changing region later means recreating the stack.
variable "region" {
  type    = string
  default = "eu-west-1"
}

variable "vpc_cidr" {
  type    = string
  default = "10.41.0.0/16"
}

variable "aurora_engine_version" {
  type    = string
  default = "16.15"
}

variable "aurora_min_acu" {
  type    = number
  default = 0
}

variable "aurora_max_acu" {
  type    = number
  default = 4
}

variable "aurora_seconds_until_auto_pause" {
  type    = number
  default = 1800
}

variable "deletion_protection" {
  type    = bool
  default = true
}

variable "rag_instance_type" {
  type    = string
  default = "t4g.medium"
}

variable "house_volume_gb" {
  type    = number
  default = 20
}

# The agencies this stack serves, keyed by org slug. Each gets a RAG learnings
# store (its own Qdrant, disk, key and port) and napkin_agency_<slug>.
# See modules/rag-host/variables.tf for the fields and the offboarding order.
variable "agencies" {
  type = map(object({
    slot        = number
    volume_gb   = optional(number, 5)
    memory_mb   = optional(number, 512)
    own_kms_key = optional(bool, true)
    state       = optional(string, "active")
  }))
  default = {}
}

variable "qdrant_version" {
  type    = string
  default = "v1.19.1"
}

variable "budget_emails" {
  description = "Where budget alerts go; empty = no budgets."
  type        = list(string)
  default     = []
}

# Two budgets, because promotional credits pay most of the bill:
#   burn  everything the stack uses, credits or not: are we spending the credit
#         faster than planned?
#   card  only what the credits do not cover: is real money leaving the card?
variable "monthly_budget_usd" {
  description = "The burn budget: gross monthly cost, credits ignored."
  type        = number
  default     = 150
}

variable "monthly_card_budget_usd" {
  description = "The card budget: monthly cost after credits."
  type        = number
  default     = 5
}

variable "github_repository" {
  description = "owner/repo whose main branch deploys"
  type        = string
  default     = "Napkin-Studio/napkin-os"
}

variable "github_repository_ids" {
  description = "That repository in GitHub's immutable OIDC subject, owner@id/repo@id"
  type        = string
  default     = "Napkin-Studio@333384631/napkin-os@1404617212"
}

variable "certificate_arn" {
  description = "ACM certificate for the studio's HTTPS; empty serves HTTP on the load balancer's own name"
  type        = string
  default     = ""
}

variable "middleware_count" {
  description = "Middleware tasks (the knowledge layers run in it, on Aurora: server/napkin/layers/pg.py)"
  type        = number
  default     = 1
}

variable "deck_enabled" {
  description = "Run the Deck Maker engine beside the middleware (a second container, 2 vCPU / 4 GB task). false drops the container and the middleware's NAPKIN_DECK_ENGINE_URL; build_deck then says the engine is off."
  type        = bool
  default     = true
}

variable "github_oidc_provider_arn" {
  description = "The account's existing token.actions.githubusercontent.com provider (staging's stack owns it; AWS allows one per account)"
  type        = string
}

variable "production_relay_url" {
  description = "The hackathon stack's relay_function_url: napkin-web proxies /production/api to it. Empty: no /production on UAT."
  type        = string
  default     = ""
}

variable "production_relay_secret_arn" {
  description = "The ARN of napkin-hackathon/TOKEN_SECRET (the hackathon stack's secret_ids output), which napkin-web signs X-Napkin-Identity with"
  type        = string
  default     = ""
  validation {
    condition     = (var.production_relay_secret_arn == "") == (var.production_relay_url == "")
    error_message = "production_relay_url and production_relay_secret_arn are set together, or neither"
  }
}

variable "production_service_key_arn" {
  description = "The ARN of napkin-hackathon/SERVICE_KEY (the hackathon stack's secret_ids output), which napkin-web calls the relay with (bearer plus signed user claim)"
  type        = string
  default     = ""
  validation {
    condition     = (var.production_service_key_arn == "") == (var.production_relay_url == "")
    error_message = "production_relay_url and production_service_key_arn are set together, or neither"
  }
}

variable "production_upload_origin" {
  description = "The S3 origin the relay's presigned upload links point at: the hackathon bucket on its regional endpoint. The Production page's CSP connect-src names it."
  type        = string
  default     = "https://napkin-hackathon-741448934623.s3.eu-west-1.amazonaws.com"
}

variable "production_media_base" {
  description = "The https base Production's pictures are served from: the hackathon stack's CloudFront address (its url output). napkin-web tells the tool in /api/session as media_base."
  type        = string
  default     = "https://d1kyxuk8u2ulz5.cloudfront.net"
}

variable "territory_enabled" {
  description = "Keep the Territories store (NAPKIN_TERRITORY_DATA) on EFS (features/territories-cloud.clan; owner, 2026-11-26). false: the task's scratch disk, wiped by every deploy."
  type        = bool
  default     = true
}

variable "territory_images" {
  description = "Territories makes pictures (Runway frames for the greenlit routes) on UAT: NAPKIN_TERRITORY_IMAGES=1, a cap of USD 2.00 per document, and the Runway key as RUNWAYML_API_SECRET on the middleware (owner, 2026-11-26: on, $2 per document). Off until the frames reach the document's pictures in the browser (features/territories-cloud.clan open question)."
  type        = bool
  default     = false
}

variable "runway_secret_name" {
  description = "The Secrets Manager secret holding the Runway key, read by name: the Production Tool relay's own (infra/envs/hackathon/secrets.tf), so UAT keeps one Runway key and no second copy. Read only when territory_images is on."
  type        = string
  default     = "napkin-hackathon/RUNWAY_API_KEY"
}
