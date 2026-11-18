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

# Its own ARN, so the tests can tell which statements reach it (the mock gives every table the same one).
override_resource {
  target = aws_dynamodb_table.tenants
  values = { arn = "arn:aws:dynamodb:eu-west-1:111111111111:table/napkin-hackathon-tenants" }
}

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
    condition     = length(aws_secretsmanager_secret.relay) == 3 && contains(keys(aws_secretsmanager_secret.relay), "TOKEN_SECRET") && !contains(keys(aws_secretsmanager_secret.relay), "FAL_KEY")
    error_message = "three secrets (Runway, Anthropic, token), values put by hand; fal and HeyGen are gone"
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
    condition     = anytrue([for s in data.aws_iam_policy_document.relay.statement : anytrue([for r in s.resources : endswith(r, "/dogfood/*")]) if s.sid == "Objects"]) && anytrue([for s in data.aws_iam_policy_document.relay.statement : contains(one(s.condition).values, "dogfood/*") if s.sid == "ListForExists"])
    error_message = "the relay may write and check the beta's record under dogfood/ (features/production-tool-dogfood.clan)"
  }
  assert {
    # Every prefix the relay reads must also be listable, or S3 answers a missing object with 403, not 404:
    # 2026-10-09, sign-in failed for every new workspace (clan/<pid>/projects.json absent, AccessDenied).
    condition     = alltrue([for p in ["in/*", "out/*", "ads/*", "clan/*", "library/*", "dogfood/*", "cards/*", "tenants/*"] : anytrue([for s in data.aws_iam_policy_document.relay.statement : contains(one(s.condition).values, p) if s.sid == "ListForExists"])])
    error_message = "the relay may list every prefix it reads, so a missing object is a 404"
  }
  assert {
    condition     = anytrue([for s in data.aws_iam_policy_document.relay.statement : anytrue([for r in s.resources : endswith(r, "/cards/*")]) if s.sid == "Objects"])
    error_message = "the relay may read and write character cards under cards/ (features/character-cards.clan)"
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

  # features/os-sign-in.clan
  assert {
    condition     = aws_dynamodb_table.tenants.name == "napkin-hackathon-tenants" && aws_dynamodb_table.tenants.hash_key == "tenantId" && aws_dynamodb_table.tenants.billing_mode == "PAY_PER_REQUEST"
    error_message = "the tenants table: pk tenantId, on demand"
  }
  assert {
    condition     = one([for s in data.aws_iam_policy_document.relay.statement : s.actions if s.sid == "Tenants"]) == toset(["dynamodb:GetItem"]) && one([for s in data.aws_iam_policy_document.relay.statement : s.resources if s.sid == "Tenants"]) == toset([aws_dynamodb_table.tenants.arn])
    error_message = "the relay only reads the tenants table; a person writes it"
  }
  assert {
    condition     = alltrue([for s in data.aws_iam_policy_document.relay.statement : !contains(s.resources, aws_dynamodb_table.tenants.arn) if s.sid != "Tenants"])
    error_message = "no other relay statement reaches the tenants table"
  }
  assert {
    condition     = aws_lambda_function.relay.environment[0].variables["TENANTS_TABLE"] == "napkin-hackathon-tenants"
    error_message = "the relay learns its tenants table from TENANTS_TABLE"
  }
  assert {
    condition     = anytrue([for s in data.aws_iam_policy_document.relay.statement : anytrue([for r in s.resources : endswith(r, "/tenants/*")]) if s.sid == "Objects"])
    error_message = "the relay may write each agency's projects and library under tenants/"
  }
  assert {
    condition     = length(aws_cloudfront_response_headers_policy.studio_cors) == 0 && alltrue([for b in aws_cloudfront_distribution.site.ordered_cache_behavior : b.response_headers_policy_id == null || b.response_headers_policy_id == ""])
    error_message = "no studio origin, no CORS policy"
  }
}

# The studio at <origin>/production reads and uploads across origins (features/os-sign-in.clan).
run "allows_the_studio_origin" {
  command = apply

  variables {
    studio_origins = ["https://studio.example.com"]
  }

  assert {
    condition     = contains(one(aws_s3_bucket_cors_configuration.site.cors_rule).allowed_origins, "https://studio.example.com")
    error_message = "the studio's browsers PUT uploads straight to S3"
  }
  assert {
    condition     = contains(one(aws_s3_bucket_cors_configuration.site.cors_rule).allowed_headers, "x-amz-checksum-sha256")
    error_message = "a presigned upload carries its checksum header across origins (features/tenant-limits.clan)"
  }
  assert {
    condition     = one(one(one(aws_cloudfront_response_headers_policy.studio_cors).cors_config).access_control_allow_origins).items == toset(["https://studio.example.com"])
    error_message = "the CORS response-headers policy allows the studio origin"
  }
  assert {
    condition     = alltrue([for b in aws_cloudfront_distribution.site.ordered_cache_behavior : b.response_headers_policy_id == one(aws_cloudfront_response_headers_policy.studio_cors).id if contains(["/in/*", "/out/*", "/ads/*"], b.path_pattern)])
    error_message = "/in/*, /out/* and /ads/* answer the studio with CORS"
  }
  assert {
    condition     = alltrue([for b in aws_cloudfront_distribution.site.ordered_cache_behavior : b.response_headers_policy_id == null || b.response_headers_policy_id == "" if !contains(["/in/*", "/out/*", "/ads/*"], b.path_pattern)])
    error_message = "only the asset paths carry the studio's CORS"
  }
}

run "refuses_a_studio_origin_with_a_path" {
  command = plan

  variables {
    studio_origins = ["https://studio.example.com/production/"]
  }

  expect_failures = [var.studio_origins]
}
