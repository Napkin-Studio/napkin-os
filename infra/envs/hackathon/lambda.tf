# Two functions. Terraform creates them with placeholder code; the deploy
# workflow (deploy-production-tool.yml) uploads the real code, publishes a
# version and moves the `live` alias, and attaches the ffmpeg layer to stitch.
# Rollback: point `live` back at the previous version.

data "archive_file" "placeholder" {
  type        = "zip"
  output_path = "${path.module}/.terraform/placeholder.zip"
  source {
    filename = "handler.py"
    content  = <<-PY
      import json
      def handler(event, context):
          return {"statusCode": 503, "headers": {"Content-Type": "application/json"},
                  "body": json.dumps({"error": {"code": "provider_unavailable", "message": "Not deployed yet.", "retryable": True}})}
    PY
  }
  source {
    filename = "stitch.py"
    content  = "def handler(event, context):\n    raise RuntimeError('not deployed yet')\n"
  }
}

data "aws_iam_policy_document" "lambda_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# ── relay ────────────────────────────────────────────────────────────────────

resource "aws_iam_role" "relay" {
  name               = "${local.name}-relay"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "relay" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.relay.arn}:*"]
  }
  statement {
    sid       = "Ledger"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query"]
    resources = [aws_dynamodb_table.jobs.arn, "${aws_dynamodb_table.jobs.arn}/index/*", aws_dynamodb_table.quotas.arn]
  }
  statement {
    sid       = "Blocked"
    actions   = ["dynamodb:GetItem"]
    resources = [aws_dynamodb_table.blocked.arn]
  }
  statement {
    sid     = "Objects"
    actions = ["s3:GetObject", "s3:PutObject"]
    # dogfood/: the beta's record (features/production-tool-dogfood.clan)
    resources = [for p in ["in/*", "out/*", "ads/*", "clan/*", "library/*", "dogfood/*"] : "${aws_s3_bucket.site.arn}/${p}"]
  }
  statement {
    sid       = "Config"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/config.json"]
  }
  # So a HEAD of a missing object is a 404, not a 403.
  statement {
    sid       = "ListForExists"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.site.arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["in/*", "out/*", "ads/*", "library/*", "dogfood/*"]
    }
  }
  statement {
    sid       = "Secrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [for s in aws_secretsmanager_secret.relay : s.arn]
  }
  statement {
    sid       = "PublicBaseUrl"
    actions   = ["ssm:GetParameter"]
    resources = ["arn:aws:ssm:${var.region}:${local.account_id}:parameter${local.public_base_url_param}"]
  }
  statement {
    sid       = "StartStitch"
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.stitch.arn, "${aws_lambda_function.stitch.arn}:*"]
  }
  # The director may call Claude on Bedrock instead of with ANTHROPIC_API_KEY.
  statement {
    sid     = "ClaudeOnBedrock"
    actions = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
    resources = [
      "arn:aws:bedrock:${var.region}:${local.account_id}:inference-profile/eu.anthropic.claude-*",
      "arn:aws:bedrock:${var.region}:${local.account_id}:inference-profile/global.anthropic.claude-*",
      "arn:aws:bedrock:*::foundation-model/anthropic.claude-*",
    ]
  }
}

resource "aws_iam_role_policy" "relay" {
  name   = "relay"
  role   = aws_iam_role.relay.id
  policy = data.aws_iam_policy_document.relay.json
}

resource "aws_lambda_function" "relay" {
  function_name                  = "${local.name}-relay"
  role                           = aws_iam_role.relay.arn
  runtime                        = "python3.12"
  architectures                  = ["x86_64"]
  handler                        = "handler.handler"
  filename                       = data.archive_file.placeholder.output_path
  source_code_hash               = data.archive_file.placeholder.output_base64sha256
  publish                        = true
  memory_size                    = var.relay_memory_mb
  timeout                        = 60
  reserved_concurrent_executions = var.relay_reserved_concurrency

  environment {
    variables = {
      BUCKET                = aws_s3_bucket.site.id
      CONFIG_KEY            = "config.json"
      PUBLIC_BASE_URL_PARAM = local.public_base_url_param
      JOBS_TABLE            = aws_dynamodb_table.jobs.name
      QUOTAS_TABLE          = aws_dynamodb_table.quotas.name
      BLOCKED_TABLE         = aws_dynamodb_table.blocked.name
      STITCH_FUNCTION       = "${aws_lambda_function.stitch.function_name}:live"
      SECRET_ARNS           = jsonencode({ for k, s in aws_secretsmanager_secret.relay : k => s.arn })
      NAPKIN_MODEL_API      = "bedrock" # the director calls Claude on Bedrock with the relay role (IAM), no API key
    }
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash, layers]
  }
  depends_on = [aws_cloudwatch_log_group.relay, aws_iam_role_policy.relay]
}

resource "aws_lambda_alias" "relay_live" {
  name             = "live"
  function_name    = aws_lambda_function.relay.function_name
  function_version = aws_lambda_function.relay.version
  lifecycle {
    ignore_changes = [function_version]
  }
}

# Public: the relay checks its own tokens. CloudFront sends /api/* here.
resource "aws_lambda_function_url" "relay" {
  function_name      = aws_lambda_function.relay.function_name
  qualifier          = aws_lambda_alias.relay_live.name
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "relay_url" {
  statement_id           = "FunctionUrlPublic"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.relay.function_name
  qualifier              = aws_lambda_alias.relay_live.name
  principal              = "*"
  function_url_auth_type = "NONE"
}

resource "aws_lambda_permission" "relay_url_invoke" {
  statement_id             = "FunctionUrlInvoke"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.relay.function_name
  qualifier                = aws_lambda_alias.relay_live.name
  principal                = "*"
  invoked_via_function_url = true
}

# The sweep: advances jobs nobody polls (closed tabs) so slots come back.
resource "aws_cloudwatch_event_rule" "sweep" {
  name                = "${local.name}-relay-sweep"
  description         = "Advance unpolled Production Tool jobs"
  schedule_expression = "rate(1 minute)"
}

resource "aws_cloudwatch_event_target" "sweep" {
  rule  = aws_cloudwatch_event_rule.sweep.name
  arn   = aws_lambda_alias.relay_live.arn
  input = jsonencode({ sweep = true })
}

resource "aws_lambda_permission" "sweep" {
  statement_id  = "EventBridgeSweep"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.relay.function_name
  qualifier     = aws_lambda_alias.relay_live.name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.sweep.arn
}

# ── stitch ───────────────────────────────────────────────────────────────────

resource "aws_iam_role" "stitch" {
  name               = "${local.name}-stitch"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "stitch" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.stitch.arn}:*"]
  }
  statement {
    sid       = "ReadClips"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/out/*", "${aws_s3_bucket.site.arn}/in/*"]
  }
  statement {
    sid       = "WriteAds"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.site.arn}/ads/*"]
  }
}

resource "aws_iam_role_policy" "stitch" {
  name   = "stitch"
  role   = aws_iam_role.stitch.id
  policy = data.aws_iam_policy_document.stitch.json
}

resource "aws_lambda_function" "stitch" {
  function_name    = "${local.name}-stitch"
  role             = aws_iam_role.stitch.arn
  runtime          = "python3.12"
  architectures    = ["x86_64"]
  handler          = "stitch.handler"
  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256
  publish          = true
  memory_size      = 3008
  timeout          = 600

  ephemeral_storage {
    size = 2048
  }

  environment {
    variables = {
      BUCKET     = aws_s3_bucket.site.id
      FFMPEG_DIR = "/opt/bin"
      FONT_FILE  = "/opt/fonts/DejaVuSans-Bold.ttf"
    }
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash, layers]
  }
  depends_on = [aws_cloudwatch_log_group.stitch, aws_iam_role_policy.stitch]
}

resource "aws_lambda_alias" "stitch_live" {
  name             = "live"
  function_name    = aws_lambda_function.stitch.function_name
  function_version = aws_lambda_function.stitch.version
  lifecycle {
    ignore_changes = [function_version]
  }
}

# The relay starts it asynchronously; a failed stitch is not retried (the
# relay reports it and the participant presses the button again).
resource "aws_lambda_function_event_invoke_config" "stitch" {
  function_name          = aws_lambda_function.stitch.function_name
  qualifier              = aws_lambda_alias.stitch_live.name
  maximum_retry_attempts = 0
}
