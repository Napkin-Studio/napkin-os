# The whole staging stack planned against mocked providers: catches AWS-side
# argument rules (names, descriptions, enums) without an account.
#   cd infra/envs/staging && terraform init -backend=false && terraform test

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
  mock_resource "aws_rds_cluster" {
    defaults = {
      master_user_secret = [{ secret_arn = "arn:aws:secretsmanager:eu-west-1:111111111111:secret:master", kms_key_id = "k", secret_status = "active" }]
      port               = 5432
      endpoint           = "napkin-staging.cluster-x.eu-west-1.rds.amazonaws.com"
    }
  }
}
mock_provider "random" {}

variables {
  budget_emails = ["alerts@example.com", "hello@example.com"]
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
    error_message = "staging signs in from the roster, with no password (features/no-password-sign-in.clan)"
  }
  assert {
    condition     = lookup(module.services.web_environment, "NAPKIN_DOGFOOD", "") == "1"
    error_message = "staging is the dogfood build (features/dogfood-telemetry.clan)"
  }
  assert {
    condition     = lookup(module.services.middleware_environment, "NAPKIN_RUNLOG_DIR", "") == "/runlog" && !contains(keys(module.services.middleware_environment), "NAPKIN_RUNLOG_BODIES")
    error_message = "staging keeps the middleware's run log, sizes only (features/dogfood-log-quality.clan)"
  }
  assert {
    condition     = length(module.services.middleware_mounts) == 1 && module.services.middleware_mounts[0].sourceVolume == "runlog" && module.services.middleware_mounts[0].containerPath == "/runlog"
    error_message = "the run log is on EFS, so it outlives a task and napkin-web can read it"
  }
}
