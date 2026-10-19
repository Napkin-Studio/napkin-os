# The Production Tool: its own stack and state, so nothing here touches staging
# and no staging deploy restarts it. Built for the hackathon (2026-10-07), hence
# the directory and the napkin-hackathon-* names, kept until the production
# environment is designed (features/drop-hackathon-extras.clan, non_goals).
# features/production-tool-infra.clan, design.rollout.
#
#   storage.tf        S3 (web/, in/, out/, ads/, clan/, config.json) + CloudFront
#   data.tf           DynamoDB: jobs ledger, quotas and counters, blocked handles
#   secrets.tf        Secrets Manager entries (values put by hand, never here)
#   lambda.tf         relay (Function URL, alias live) and stitch, the sweep
#   observability.tf  log groups (14 d) and the saved Logs Insights queries
#   deploy.tf         the GitHub OIDC role deploy-production-tool.yml assumes
#
#   terraform init -backend-config=backend.hcl
#   AWS_PROFILE=napkin terraform plan -out=hackathon.tfplan   # a person applies it
#
# Lambda code is a placeholder at create time; the deploy workflow uploads the
# real code and moves the `live` alias, so Terraform ignores code and alias.

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 6.0" }
    archive = { source = "hashicorp/archive", version = "~> 2.4" }
  }
  # Partial configuration: `terraform init -backend-config=backend.hcl`.
  backend "s3" {}
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = "napkin", Env = var.env, ManagedBy = "terraform" }
  }
}

data "aws_caller_identity" "me" {}

locals {
  name       = "napkin-${var.env}"
  account_id = data.aws_caller_identity.me.account_id
}
