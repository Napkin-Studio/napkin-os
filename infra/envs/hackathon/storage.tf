# One bucket, read through CloudFront only:
#   web/          the built app (deploy workflow)       → /
#   in/sha256:…   uploads (presigned PUT from browsers) → /in/*
#   out/sha256:…  provider outputs copied by the relay  → /out/*
#   ads/<id>.mp4  stitched ads                          → /ads/*
#   clan/         server copies of documents
#   config.json   the remote config, uploaded by hand   → /config.json (uncached)
# Providers read /in/* and /out/*: HTTPS, HEAD answers with Content-Type and
# Content-Length, no redirects (Runway's input rules).

resource "aws_s3_bucket" "site" {
  bucket = "${local.name}-${local.account_id}"
}

resource "aws_s3_bucket_versioning" "site" {
  bucket = aws_s3_bucket.site.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "site" {
  bucket = aws_s3_bucket.site.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

# Browsers PUT uploads straight to S3 with the relay's presigned URL.
resource "aws_s3_bucket_cors_configuration" "site" {
  bucket = aws_s3_bucket.site.id
  cors_rule {
    allowed_methods = ["PUT"]
    allowed_origins = concat(["https://${aws_cloudfront_distribution.site.domain_name}"], [for d in var.domain_aliases : "https://${d}"], var.cors_origins)
    allowed_headers = ["Content-Type", "Content-Length"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    id     = "old-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration { noncurrent_days = 30 }
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }
}

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${local.name}-s3"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "CloudFrontReads"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource = [for p in ["web/*", "in/*", "out/*", "ads/*", "config.json"] :
        "${aws_s3_bucket.site.arn}/${p}"]
        Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.site.arn } }
      },
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.site.arn, "${aws_s3_bucket.site.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
    ]
  })
  depends_on = [aws_s3_bucket_public_access_block.site]
}

# AWS managed policies (fixed ids, the same in every account).
locals {
  public_base_url_param      = "/${local.name}/public-base-url"
  cache_optimized            = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  cache_disabled             = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
  all_viewer_except_host     = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
  relay_url_host             = replace(replace(aws_lambda_function_url.relay.function_url, "https://", ""), "/", "")
  s3_web_origin              = "web"
  s3_data_origin             = "data"
  relay_origin               = "relay"
  immutable_paths            = ["/in/*", "/out/*", "/ads/*"]
  cloudfront_default_cert    = length(var.domain_aliases) == 0
  cloudfront_spa_function_js = <<-JS
    function handler(event) {
      var r = event.request;
      if (r.uri.indexOf('.') === -1) { r.uri = '/index.html'; }
      return r;
    }
  JS
}

# A path without a file extension is a route of the single-page app.
resource "aws_cloudfront_function" "spa" {
  name    = "${local.name}-spa"
  runtime = "cloudfront-js-2.0"
  comment = "Serve index.html for app routes"
  publish = true
  code    = local.cloudfront_spa_function_js
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  comment             = "${local.name}: Production Tool"
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  http_version        = "http2and3"
  aliases             = var.domain_aliases

  origin {
    origin_id                = local.s3_web_origin
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_path              = "/web"
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  origin {
    origin_id                = local.s3_data_origin
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  origin {
    origin_id   = local.relay_origin
    domain_name = local.relay_url_host
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 60
    }
  }

  default_cache_behavior {
    target_origin_id       = local.s3_web_origin
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = local.cache_optimized
    compress               = true
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa.arn
    }
  }

  # Inputs and outputs are content-addressed, so they cache forever. No
  # redirect: providers fetch them over HTTPS directly.
  dynamic "ordered_cache_behavior" {
    for_each = local.immutable_paths
    content {
      path_pattern           = ordered_cache_behavior.value
      target_origin_id       = local.s3_data_origin
      viewer_protocol_policy = "https-only"
      allowed_methods        = ["GET", "HEAD", "OPTIONS"]
      cached_methods         = ["GET", "HEAD"]
      cache_policy_id        = local.cache_optimized
      compress               = false
    }
  }

  ordered_cache_behavior {
    path_pattern           = "/config.json"
    target_origin_id       = local.s3_data_origin
    viewer_protocol_policy = "https-only"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = local.cache_disabled
    compress               = true
  }

  ordered_cache_behavior {
    path_pattern             = "/api/*"
    target_origin_id         = local.relay_origin
    viewer_protocol_policy   = "https-only"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = local.cache_disabled
    origin_request_policy_id = local.all_viewer_except_host
    compress                 = true
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    cloudfront_default_certificate = local.cloudfront_default_cert
    acm_certificate_arn            = local.cloudfront_default_cert ? null : var.certificate_arn
    ssl_support_method             = local.cloudfront_default_cert ? null : "sni-only"
    minimum_protocol_version       = local.cloudfront_default_cert ? "TLSv1" : "TLSv1.2_2021"
  }
}

# The relay learns its public base URL here (an env var would make a cycle:
# distribution → Function URL → function → distribution).
resource "aws_ssm_parameter" "public_base_url" {
  name           = local.public_base_url_param
  type           = "String"
  insecure_value = length(var.domain_aliases) > 0 ? "https://${var.domain_aliases[0]}" : "https://${aws_cloudfront_distribution.site.domain_name}"
}
