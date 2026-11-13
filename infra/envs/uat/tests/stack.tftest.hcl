# The whole uat stack planned against mocked providers: catches AWS-side
# argument rules (names, descriptions, enums) without an account.
#   cd infra/envs/uat && terraform init -backend=false && terraform test

mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = { names = ["eu-west-1a", "eu-west-1b", "eu-west-1c"] }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "111111111111" }
  }
  mock_data "aws_subnet" {
    defaults = { availability_zone = "eu-west-1a" }
  }
  # a policy document plans as a JSON policy, as the real one renders
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  # staging's layer secrets, found by name (staging-layers.tf)
  mock_data "aws_secretsmanager_secrets" {
    defaults = {
      names = ["napkin-staging/db/napkin_agency_acme", "napkin-staging/db/napkin_category"]
      arns  = ["arn:aws:secretsmanager:eu-west-1:111111111111:secret:napkin-staging/db/napkin_agency_acme-a", "arn:aws:secretsmanager:eu-west-1:111111111111:secret:napkin-staging/db/napkin_category-c"]
    }
  }
  mock_data "aws_secretsmanager_secret" {
    defaults = { kms_key_id = "arn:aws:kms:eu-west-1:111111111111:key/staging" }
  }
  mock_data "aws_vpc" {
    defaults = { id = "vpc-staging", cidr_block = "10.40.0.0/16" }
  }
  mock_resource "aws_rds_cluster" {
    defaults = {
      master_user_secret = [{ secret_arn = "arn:aws:secretsmanager:eu-west-1:111111111111:secret:master", kms_key_id = "k", secret_status = "active" }]
      port               = 5432
      endpoint           = "napkin-uat.cluster-x.eu-west-1.rds.amazonaws.com"
    }
  }
}
mock_provider "random" {}

variables {
  github_oidc_provider_arn = "arn:aws:iam::111111111111:oidc-provider/token.actions.githubusercontent.com"
  budget_emails            = ["alerts@example.com", "hello@example.com"]
  agencies = {
    acme   = { slot = 1 }
    globex = { slot = 2 }
  }
}

run "plans_with_two_agencies" {
  command = plan

  assert {
    condition     = keys(module.databases.secret_arns) == ["napkin_agency_acme", "napkin_agency_globex", "napkin_category"]
    error_message = "S3: one category database plus one per agency"
  }
  assert {
    condition     = length(module.rag.store_secret_arns) == 4
    error_message = "house read-write + house read-only + one key per agency"
  }
  assert {
    condition     = contains(jsondecode(aws_iam_policy.model_invoke.policy).Statement[0].Action, "bedrock:InvokeModel")
    error_message = "the admin host (seeding) may call Claude on Bedrock"
  }
  assert {
    condition     = aws_budgets_budget.monthly["card"].cost_types[0].include_credit && !aws_budgets_budget.monthly["burn"].cost_types[0].include_credit
    error_message = "card = after credits, burn = before credits"
  }
  assert {
    condition     = module.services.web_environment["NAPKIN_AUTH"] == "roster" && module.services.web_environment["NAPKIN_AUTH_ROSTER"] == "/srv/napkin/accounts.tsv" && !contains(keys(module.services.web_environment), "NAPKIN_COGNITO_CLIENT_ID")
    error_message = "uat signs in from the roster, with no password (features/no-password-sign-in.clan)"
  }
  assert {
    condition     = lookup(module.services.web_environment, "NAPKIN_DOGFOOD", "") == "1"
    error_message = "uat is the dogfood build (features/dogfood-telemetry.clan)"
  }
  assert {
    condition     = lookup(module.services.middleware_environment, "NAPKIN_RUNLOG_DIR", "") == "/runlog"
    error_message = "uat keeps the middleware's run log (features/dogfood-log-quality.clan)"
  }
  assert {
    condition     = lookup(module.services.middleware_environment, "NAPKIN_RUNLOG_BODIES", "") == "1"
    error_message = "uat's run log holds what the models and searches saw (features/brief-fact-provenance.clan)"
  }
  assert {
    condition     = length(module.services.middleware_mounts) == 1 && module.services.middleware_mounts[0].sourceVolume == "runlog" && module.services.middleware_mounts[0].containerPath == "/runlog"
    error_message = "the run log is on EFS, so it outlives a task and napkin-web can read it"
  }
}

run "uat_is_its_own_stack_and_takes_any_branch" {
  command = plan

  assert {
    condition     = local.name == "napkin-uat"
    error_message = "UAT's resources are all named napkin-uat-*, never staging's"
  }
  assert {
    condition     = var.vpc_cidr == "10.41.0.0/16"
    error_message = "UAT's network does not overlap staging's 10.40.0.0/16"
  }
}

# Owner, 2026-11-11: "allow it to hit the same thing as staging". UAT's middleware uses staging's layer
# databases where staging has them, over a peering, and keeps its own for the rest.
run "uat_uses_staging_layers" {
  command = plan

  assert {
    condition     = module.services.middleware_secret_arns["NAPKIN_LAYERS_DSN"] == "arn:aws:secretsmanager:eu-west-1:111111111111:secret:napkin-staging/db/napkin_category-c"
    error_message = "the category layer is staging's"
  }
  assert {
    condition     = module.services.middleware_secret_arns["NAPKIN_LAYERS_AGENCY_DSN_ACME"] == "arn:aws:secretsmanager:eu-west-1:111111111111:secret:napkin-staging/db/napkin_agency_acme-a"
    error_message = "an agency staging has is staging's"
  }
  assert {
    condition     = !contains(keys(local.staging_db_arns), "napkin_agency_globex") && contains(keys(module.services.middleware_secret_arns), "NAPKIN_LAYERS_AGENCY_DSN_GLOBEX")
    error_message = "an agency staging lacks keeps UAT's own database"
  }
  assert {
    condition     = length(aws_vpc_peering_connection.staging) == 1 && aws_route.staging_to_uat[0].destination_cidr_block == "10.41.0.0/16" && aws_vpc_security_group_ingress_rule.staging_db_from_uat[0].from_port == 5432
    error_message = "peered, routed both ways, and staging's Aurora takes Postgres from UAT"
  }
  assert {
    condition     = can(regex("^[a-zA-Z0-9. _:/()#,@+=&;{}!$*\\[\\]-]{0,255}$", aws_vpc_security_group_ingress_rule.staging_db_from_uat[0].description))
    error_message = "a security group rule's description takes only the characters EC2 allows (no apostrophe)"
  }
}

run "uat_can_go_back_to_its_own_layers" {
  command = plan
  variables {
    layers_from_staging = false
  }

  assert {
    condition     = length(local.staging_db_arns) == 0 && length(aws_vpc_peering_connection.staging) == 0 && length(aws_vpc_security_group_ingress_rule.staging_db_from_uat) == 0
    error_message = "off: UAT's own databases, no peering"
  }
}
