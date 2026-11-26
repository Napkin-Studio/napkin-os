# terraform test, against mocked providers: no AWS account, no cost.
#   cd infra/modules/services && terraform init -backend=false && terraform test
# The backup of web's EFS (features/production-in-library, S0-10).

mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = { names = ["eu-west-1a", "eu-west-1b", "eu-west-1c"] }
  }
  mock_data "aws_subnet" {
    defaults = { availability_zone = "eu-west-1a" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "111111111111" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
}

variables {
  name                           = "napkin-test"
  region                         = "eu-west-1"
  vpc_id                         = "vpc-1"
  public_subnet_ids              = ["subnet-a", "subnet-b"]
  private_subnet_ids             = ["subnet-c", "subnet-d"]
  data_clients_security_group_id = "sg-1"
  kms_key_arn                    = "arn:aws:kms:eu-west-1:111111111111:key/data"
  session_secret_arn             = "arn:aws:secretsmanager:eu-west-1:111111111111:secret:session"
  cognito_client_id              = "client"
  github_repository              = "Napkin-Studio/napkin-os"
  github_repository_ids          = "1234"
  github_oidc_provider_arn       = "arn:aws:iam::111111111111:oidc-provider/token.actions.githubusercontent.com"
}

run "backup_is_planned_daily_at_0300_utc_for_35_days_on_the_web_efs" {
  command = plan
  variables {
    backup_enabled           = true
    production_media_base    = "https://media.example.com"
    production_upload_origin = "https://bucket.s3.eu-west-1.amazonaws.com"
  }

  assert {
    condition     = one([for r in aws_backup_plan.web[0].rule : r.schedule]) == "cron(0 3 * * ? *)"
    error_message = "daily at 03:00 UTC"
  }
  assert {
    condition     = one([for r in aws_backup_plan.web[0].rule : r.lifecycle[0].delete_after]) == 35
    error_message = "kept 35 days"
  }
  assert {
    condition     = length(aws_backup_selection.web[0].resources) == 1 && aws_backup_selection.web[0].name == "napkin-test-web-efs"
    error_message = "one resource is selected (the web EFS, by ARN: main.tf wires aws_efs_file_system.web.arn)"
  }
  assert {
    condition     = aws_backup_vault.web[0].kms_key_arn == var.kms_key_arn
    error_message = "the vault uses the stack's key"
  }
  assert {
    condition     = local.web_environment[length(local.web_environment) - 1].name == "NAPKIN_PRODUCTION_MEDIA_BASE"
    error_message = "napkin-web is told where pictures live"
  }
  assert {
    condition     = contains([for e in local.web_environment : "${e.name}=${e.value}"], "NAPKIN_PRODUCTION_UPLOAD_ORIGIN=https://bucket.s3.eu-west-1.amazonaws.com")
    error_message = "napkin-web is told where uploads go (the CSP names it)"
  }
}

run "backup_is_absent_when_not_enabled" {
  command = plan
  variables {
    backup_enabled = false
  }

  assert {
    condition     = length(aws_backup_plan.web) == 0 && length(aws_backup_vault.web) == 0 && length(aws_backup_selection.web) == 0 && length(aws_iam_role.backup) == 0
    error_message = "nothing is planned for backup when it is off"
  }
  assert {
    condition     = !contains([for e in local.web_environment : e.name], "NAPKIN_PRODUCTION_MEDIA_BASE")
    error_message = "no media base unless given"
  }
  assert {
    condition     = !contains([for e in local.web_environment : e.name], "NAPKIN_PRODUCTION_UPLOAD_ORIGIN")
    error_message = "no upload origin unless given"
  }
}
