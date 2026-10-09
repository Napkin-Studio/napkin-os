# The hackathon stack applied against mocked providers (nothing reaches AWS): catches AWS-side
# argument rules without an account.
#   cd infra/envs/hackathon && terraform init -backend=false && terraform test

mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "111111111111" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  mock_data "aws_iam_openid_connect_provider" {
    defaults = { arn = "arn:aws:iam::111111111111:oidc-provider/token.actions.githubusercontent.com" }
  }
  mock_resource "aws_lambda_function_url" {
    defaults = { function_url = "https://abc123.lambda-url.eu-west-1.on.aws/" }
  }
  mock_resource "aws_cloudfront_distribution" {
    defaults = { domain_name = "d111.cloudfront.net", arn = "arn:aws:cloudfront::111111111111:distribution/E111" }
  }
  mock_resource "aws_s3_bucket" {
    defaults = { arn = "arn:aws:s3:::napkin-hackathon-111111111111", bucket_regional_domain_name = "napkin-hackathon-111111111111.s3.eu-west-1.amazonaws.com" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:eu-west-1:111111111111:log-group:x" }
  }
  mock_resource "aws_lambda_function" {
    defaults = { arn = "arn:aws:lambda:eu-west-1:111111111111:function:x", version = "1" }
  }
  mock_resource "aws_lambda_alias" {
    defaults = { arn = "arn:aws:lambda:eu-west-1:111111111111:function:x:live" }
  }
  mock_resource "aws_cloudwatch_event_rule" {
    defaults = { arn = "arn:aws:events:eu-west-1:111111111111:rule/x" }
  }
  mock_resource "aws_cloudfront_function" {
    defaults = { arn = "arn:aws:cloudfront::111111111111:function/x" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::111111111111:role/x" }
  }
  mock_resource "aws_secretsmanager_secret" {
    defaults = { arn = "arn:aws:secretsmanager:eu-west-1:111111111111:secret:x" }
  }
  mock_resource "aws_dynamodb_table" {
    defaults = { arn = "arn:aws:dynamodb:eu-west-1:111111111111:table/x" }
  }
  mock_resource "aws_ssm_parameter" {
    defaults = { arn = "arn:aws:ssm:eu-west-1:111111111111:parameter/x" }
  }
}
mock_provider "archive" {}

run "plans_the_hackathon_stack" {
  # apply against the mocks: computed values (the Function URL host) come from the defaults above
  command = apply

  assert {
    condition     = aws_s3_bucket_versioning.site.versioning_configuration[0].status == "Enabled"
    error_message = "the bucket is versioned (rollback of config.json and the web build)"
  }
  assert {
    condition     = toset([for b in aws_cloudfront_distribution.site.ordered_cache_behavior : b.path_pattern]) == toset(["/in/*", "/out/*", "/ads/*", "/config.json", "/api/*"])
    error_message = "CloudFront serves inputs, outputs, ads, config.json and the relay"
  }
  assert {
    condition     = one([for b in aws_cloudfront_distribution.site.ordered_cache_behavior : b.target_origin_id if b.path_pattern == "/api/*"]) == "relay"
    error_message = "/api/* goes to the relay"
  }
  assert {
    condition     = one([for o in aws_cloudfront_distribution.site.origin : o.domain_name if o.origin_id == "relay"]) == "abc123.lambda-url.eu-west-1.on.aws"
    error_message = "the relay origin is the Function URL host"
  }
  assert {
    condition     = alltrue([for b in aws_cloudfront_distribution.site.ordered_cache_behavior : b.viewer_protocol_policy == "https-only" if b.path_pattern != "/api/*" && b.path_pattern != "/config.json"])
    error_message = "providers read inputs over HTTPS with no redirect"
  }
  assert {
    condition     = length(aws_secretsmanager_secret.relay) == 6 && contains(keys(aws_secretsmanager_secret.relay), "TOKEN_SECRET")
    error_message = "six secrets, values put by hand"
  }
  assert {
    condition     = aws_cloudwatch_log_group.relay.retention_in_days == 14 && aws_cloudwatch_log_group.stitch.retention_in_days == 14
    error_message = "logs kept 14 days"
  }
  assert {
    condition     = toset([for g in aws_dynamodb_table.jobs.global_secondary_index : g.name]) == toset(["participant", "active"])
    error_message = "jobs ledger has the participant and active indexes"
  }
  assert {
    condition     = aws_lambda_function_url.relay.qualifier == "live" && aws_cloudwatch_event_rule.sweep.schedule_expression == "rate(1 minute)"
    error_message = "the Function URL and the sweep both use the live alias"
  }
  assert {
    condition     = aws_lambda_function.relay.environment[0].variables["STITCH_FUNCTION"] == "napkin-hackathon-stitch:live"
    error_message = "the relay starts the stitch alias"
  }
  assert {
    condition     = aws_iam_role.deploy.name == "napkin-hackathon-github-deploy"
    error_message = "deploy role for deploy-production-tool.yml"
  }
}
