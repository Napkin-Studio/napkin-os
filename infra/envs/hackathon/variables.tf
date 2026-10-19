variable "env" {
  type    = string
  default = "hackathon"
}

variable "region" {
  type    = string
  default = "eu-west-1"
}

variable "github_repository" {
  description = "owner/repo whose workflow deploys (any branch, by hand)"
  type        = string
  default     = "Napkin-Studio/napkin-os"
}

variable "github_repository_ids" {
  description = "That repository in GitHub's immutable OIDC subject, owner@id/repo@id"
  type        = string
  default     = "Napkin-Studio@333384631/napkin-os@1404617212"
}

variable "cors_origins" {
  description = "Extra origins allowed to PUT uploads straight to S3 (besides the CloudFront domain), e.g. http://localhost:5173"
  type        = list(string)
  default     = ["http://localhost:5173"]
}

variable "domain_aliases" {
  description = "Custom domains for the distribution (e.g. hack.napkin.ie); empty uses the cloudfront.net name"
  type        = list(string)
  default     = []
}

variable "certificate_arn" {
  description = "ACM certificate in us-east-1 for domain_aliases; required when they are set"
  type        = string
  default     = ""
}

variable "relay_memory_mb" {
  type    = number
  default = 1024
}

variable "relay_reserved_concurrency" {
  description = "Upper bound on concurrent relay invocations (-1: no reservation)"
  type        = number
  default     = -1
}
