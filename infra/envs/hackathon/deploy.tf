# The role deploy-production-tool.yml assumes. Staging's stack created the
# account's GitHub OIDC provider (infra/modules/services); this reuses it.
# Any branch of the repository may deploy, because the workflow is run by hand
# (workflow_dispatch) by people with write access, from feat/production-tool.

data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

data "aws_iam_policy_document" "deploy_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [for r in compact([var.github_repository, var.github_repository_ids]) :
      "repo:${r}:ref:refs/heads/*"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name               = "${local.name}-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.deploy_trust.json
}

data "aws_iam_policy_document" "deploy" {
  statement {
    sid       = "WebAndLayerUploads"
    actions   = ["s3:PutObject", "s3:DeleteObject", "s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/web/*", "${aws_s3_bucket.site.arn}/build/*"]
  }
  statement {
    sid       = "SyncLists"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.site.arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["web/*", "web", "build/*"]
    }
  }
  statement {
    sid       = "Invalidate"
    actions   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"]
    resources = [aws_cloudfront_distribution.site.arn]
  }
  statement {
    sid = "Functions"
    actions = [
      "lambda:GetFunction", "lambda:GetFunctionConfiguration", "lambda:UpdateFunctionCode",
      "lambda:UpdateFunctionConfiguration", "lambda:PublishVersion", "lambda:GetAlias",
      "lambda:UpdateAlias", "lambda:ListVersionsByFunction",
    ]
    resources = [
      aws_lambda_function.relay.arn, "${aws_lambda_function.relay.arn}:*",
      aws_lambda_function.stitch.arn, "${aws_lambda_function.stitch.arn}:*",
    ]
  }
  statement {
    sid       = "FfmpegLayer"
    actions   = ["lambda:PublishLayerVersion", "lambda:GetLayerVersion"]
    resources = ["arn:aws:lambda:${var.region}:${local.account_id}:layer:${local.name}-ffmpeg", "arn:aws:lambda:${var.region}:${local.account_id}:layer:${local.name}-ffmpeg:*"]
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}
