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

variable "web_count" {
  description = "Web tasks. One until app-frame tokens are shared between tasks (they live in memory)"
  type        = number
  default     = 1
}

variable "middleware_count" {
  description = "Middleware tasks. 0 until the knowledge layers it requires (NAPKIN_LAYERS_URL) run on AWS"
  type        = number
  default     = 0
}

variable "middleware_env" {
  description = "Extra environment for the middleware (model, layers, research, retrieval)"
  type        = map(string)
  default     = {}
}
