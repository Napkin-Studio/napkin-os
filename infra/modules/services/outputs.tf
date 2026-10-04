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
