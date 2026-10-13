output "url" {
  description = "The studio"
  value       = "${var.certificate_arn != "" ? "https" : "http"}://${aws_lb.web.dns_name}"
}

output "deploy_role_arn" {
  description = "GitHub variable AWS_DEPLOY_ROLE_ARN"
  value       = aws_iam_role.deploy.arn
}

output "cluster" {
  value = aws_ecs_cluster.this.name
}

output "ecr" {
  value = { for k, r in aws_ecr_repository.app : k => r.repository_url }
}

output "web_environment" {
  description = "napkin-web's task environment, by name (no secrets)"
  value       = { for e in local.web_environment : e.name => e.value }
}

output "middleware_environment" {
  description = "The middleware's task environment, by name (no secrets)"
  value       = local.middleware_environment
}

output "middleware_mounts" {
  description = "The middleware container's mount points"
  value       = local.middleware_mounts
}

output "web_secrets" {
  description = "napkin-web's task secrets: name to the Secrets Manager ARN it is read from (never a value)"
  value       = { for s in local.web_secrets : s.name => s.valueFrom }
}

output "execution_secret_arns" {
  description = "The secrets the execution role may read (GetSecretValue) to start the tasks"
  value       = concat([var.session_secret_arn], values(var.middleware_secrets), local.production_secret_arns)
}
