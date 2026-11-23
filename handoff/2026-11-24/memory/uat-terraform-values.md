---
name: uat-terraform-values
description: UAT Terraform must be planned with the real production_relay_url / production_relay_secret_arn; the repo's tfvars example lacks them and a plan from it removes the Production Tool from UAT web
metadata:
  type: reference
---

infra/envs/uat: backend bucket napkin-tfstate-741448934623, key uat/terraform.tfstate (backend.hcl.example with the account id). terraform.tfvars needs github_oidc_provider_arn (from the example) plus the live values production_relay_url and production_relay_secret_arn (read them from the current web task definition's env/secrets before planning). On 2026-11-23 a plan without them showed web task def replaced and execution_secrets losing the relay secret; with them only the deck changes remained. Agents may plan/read, the owner applies. A prepared checkout was at ~/Documents/Code/napkin-wt-develop-tf/infra/envs/uat.
