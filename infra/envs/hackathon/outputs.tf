output "url" {
  description = "The Production Tool"
  value       = aws_ssm_parameter.public_base_url.insecure_value
}

output "relay_function_url" {
  description = "The relay's own URL (CloudFront /api/* is the way in)"
  value       = aws_lambda_function_url.relay.function_url
}

output "bucket" {
  value = aws_s3_bucket.site.id
}

output "distribution_id" {
  value = aws_cloudfront_distribution.site.id
}

output "jobs_table" {
  value = aws_dynamodb_table.jobs.name
}

output "quotas_table" {
  value = aws_dynamodb_table.quotas.name
}

output "blocked_table" {
  value = aws_dynamodb_table.blocked.name
}

output "relay_function" {
  value = aws_lambda_function.relay.function_name
}

output "stitch_function" {
  value = aws_lambda_function.stitch.function_name
}

output "deploy_role_arn" {
  description = "Repository variable AWS_DEPLOY_ROLE_ARN_HACKATHON"
  value       = aws_iam_role.deploy.arn
}

output "secret_ids" {
  description = "Put each value by hand (secrets.tf)"
  value       = { for k, s in aws_secretsmanager_secret.relay : k => s.name }
}
