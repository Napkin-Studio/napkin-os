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
  description = "Every web origin, besides the distribution itself, that runs the Production Tool: the Napkin OS studios serving it at /production (UAT, staging, production; features/os-sign-in.clan) and the dev server. Their browsers PUT uploads straight to S3 and read /in/*, /out/* and /ads/* across origins (frames, clips, canvas exports, downloads); both rules come from this one list. Set the real ones in terraform.tfvars (terraform.tfvars.example)."
  type        = list(string)
  default     = ["http://localhost:5173"]
  validation {
    condition     = alltrue([for o in var.cors_origins : can(regex("^https?://[^/]+$", o))])
    error_message = "cors_origins are origins: scheme and host, no path or trailing slash (https://studio.example.com)"
  }
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
