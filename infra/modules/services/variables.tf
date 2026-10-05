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
