# Stage 2: the services. ECS Fargate runs napkin-web (the studio) behind a
# public load balancer and the middleware on a private address; the images
# come from ECR, pushed by the GitHub pipeline through an OIDC role (no keys
# stored in GitHub). napkin-web keeps its workspaces on EFS.
#
# The pipeline owns the running revision: it registers a new task definition
# per build and points the service at it, so Terraform ignores the service's
# task definition after creating it.

terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
}

data "aws_caller_identity" "me" {}

locals {
  apps    = toset(["web", "middleware"])
  https   = var.certificate_arn != ""
  ns      = "svc.${var.name}"
  mw_port = 8798                                                      # the middleware refuses 8080 (local development keeps it for napkin-web)
  mw_url  = "http://middleware.${local.ns}:${local.mw_port}/v1/tasks" # the endpoint, as workspace.yaml names it
}

# ── images ────────────────────────────────────────────────────────────────────

resource "aws_ecr_repository" "app" {
  for_each             = local.apps
  name                 = "${var.name}/${each.key}"
  image_tag_mutability = "MUTABLE"
  force_delete         = false
  image_scanning_configuration {
    scan_on_push = true
  }
  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  for_each   = local.apps
  repository = aws_ecr_repository.app[each.key].name
  policy = jsonencode({ rules = [{
    rulePriority = 1, description = "keep the last 30 images"
    selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 30 }
    action       = { type = "expire" }
  }] })
}

# ── cluster, logs ─────────────────────────────────────────────────────────────

resource "aws_ecs_cluster" "this" {
  name = var.name
}

# Spot runs the same tasks for about a third of the price; AWS may reclaim one
# with two minutes' warning, and the service starts another.
resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name       = aws_ecs_cluster.this.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]
}

locals {
  capacity = var.spot ? "FARGATE_SPOT" : "FARGATE"
}

resource "aws_cloudwatch_log_group" "app" {
  for_each          = local.apps
  name              = "/napkin/${var.name}/${each.key}"
  retention_in_days = 30
}

# ── roles ─────────────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "ecs_tasks" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Starts the containers: pulls the images, writes the logs, reads the secrets.
resource "aws_iam_role" "execution" {
  name               = "${var.name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = concat([var.session_secret_arn], values(var.middleware_secrets))
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = [var.kms_key_arn]
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# What napkin-web itself may do: its workspaces on EFS.
resource "aws_iam_role" "web" {
  name               = "${var.name}-web"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks.json
}

data "aws_iam_policy_document" "web" {
  statement {
    actions   = ["elasticfilesystem:ClientMount", "elasticfilesystem:ClientWrite"]
    resources = [aws_efs_file_system.web.arn]
  }
}

resource "aws_iam_role_policy" "web" {
  name   = "efs"
  role   = aws_iam_role.web.id
  policy = data.aws_iam_policy_document.web.json
}

# What the middleware itself may do: call Claude on Bedrock.
resource "aws_iam_role" "middleware" {
  name               = "${var.name}-middleware"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks.json
}

data "aws_iam_policy_document" "middleware" {
  statement {
    actions = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
    resources = [
      "arn:aws:bedrock:*::foundation-model/anthropic.claude-*",
      "arn:aws:bedrock:*:${data.aws_caller_identity.me.account_id}:inference-profile/*anthropic.claude-*",
    ]
  }
  # Research's failover: Nova 2 Lite with web grounding, on its US profile only
  # (the only place grounding runs). The query text is all that goes there.
  statement {
    actions = ["bedrock:InvokeModel"]
    resources = [
      "arn:aws:bedrock:us-*::foundation-model/amazon.nova-2-lite-*",
      "arn:aws:bedrock:us-*:${data.aws_caller_identity.me.account_id}:inference-profile/us.amazon.nova-2-lite-*",
    ]
  }
  statement {
    actions   = ["bedrock:InvokeTool"]
    resources = ["arn:aws:bedrock::${data.aws_caller_identity.me.account_id}:system-tool/amazon.nova_grounding"]
  }
}

resource "aws_iam_role_policy" "middleware" {
  name   = "bedrock"
  role   = aws_iam_role.middleware.id
  policy = data.aws_iam_policy_document.middleware.json
}

# ── network ───────────────────────────────────────────────────────────────────

resource "aws_security_group" "alb" {
  name        = "${var.name}-alb"
  description = "The public load balancer"
  vpc_id      = var.vpc_id
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "web" {
  name        = "${var.name}-web"
  description = "napkin-web tasks: reached by the load balancer only"
  vpc_id      = var.vpc_id
  ingress {
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "middleware" {
  name        = "${var.name}-middleware"
  description = "Middleware tasks: reached by napkin-web only"
  vpc_id      = var.vpc_id
  ingress {
    from_port       = local.mw_port
    to_port         = local.mw_port
    protocol        = "tcp"
    security_groups = [aws_security_group.web.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_service_discovery_private_dns_namespace" "svc" {
  name = local.ns
  vpc  = var.vpc_id
}

resource "aws_service_discovery_service" "middleware" {
  name = "middleware"
  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.svc.id
    dns_records {
      type = "A"
      ttl  = 10
    }
  }
}

# ── napkin-web's workspaces ───────────────────────────────────────────────────

resource "aws_efs_file_system" "web" {
  creation_token  = "${var.name}-web"
  encrypted       = true
  kms_key_id      = var.kms_key_arn
  throughput_mode = "elastic"
  tags            = { Name = "${var.name}-web" }
}

resource "aws_security_group" "efs" {
  name        = "${var.name}-efs"
  description = "napkin-web workspaces: NFS from web tasks"
  vpc_id      = var.vpc_id
  ingress {
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [aws_security_group.web.id]
  }
}

resource "aws_efs_mount_target" "web" {
  count           = length(var.private_subnet_ids)
  file_system_id  = aws_efs_file_system.web.id
  subnet_id       = var.private_subnet_ids[count.index]
  security_groups = [aws_security_group.efs.id]
}

resource "aws_efs_access_point" "web" {
  file_system_id = aws_efs_file_system.web.id
  posix_user {
    uid = 10001
    gid = 10001
  }
  root_directory {
    path = "/napkin-web"
    creation_info {
      owner_uid   = 10001
      owner_gid   = 10001
      permissions = "750"
    }
  }
}

# ── the load balancer ─────────────────────────────────────────────────────────

resource "aws_lb" "web" {
  name               = "${var.name}-web"
  load_balancer_type = "application"
  subnets            = var.public_subnet_ids
  security_groups    = [aws_security_group.alb.id]
  idle_timeout       = 300 # the studio holds an event stream open
}

resource "aws_lb_target_group" "web" {
  name        = "${var.name}-web"
  port        = 8080
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id
  health_check {
    path    = "/api/healthz"
    matcher = "200"
  }
  # app frames' tokens live in one task's memory: a person stays on one task
  stickiness {
    type            = "lb_cookie"
    cookie_duration = 43200
  }
  deregistration_delay = 30
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.web.arn
  port              = 80
  protocol          = "HTTP"
  dynamic "default_action" {
    for_each = local.https ? [1] : []
    content {
      type = "redirect"
      redirect {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }
  dynamic "default_action" {
    for_each = local.https ? [] : [1]
    content {
      type             = "forward"
      target_group_arn = aws_lb_target_group.web.arn
    }
  }
}

resource "aws_lb_listener" "https" {
  count             = local.https ? 1 : 0
  load_balancer_arn = aws_lb.web.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

# ── task definitions (the pipeline registers new revisions) ───────────────────

locals {
  # Sign-in: the Cognito pool (passwords), or the roster the image carries
  # (/srv/napkin/accounts.tsv, from infra/scripts/accounts.napkin.tsv; no passwords).
  web_auth_env = var.web_auth == "roster" ? [
    { name = "NAPKIN_AUTH", value = "roster" },
    { name = "NAPKIN_AUTH_ROSTER", value = "/srv/napkin/accounts.tsv" },
    ] : [
    { name = "NAPKIN_AUTH", value = "cognito" },
    { name = "NAPKIN_COGNITO_REGION", value = var.region },
    { name = "NAPKIN_COGNITO_CLIENT_ID", value = var.cognito_client_id },
  ]
  web_environment = concat(
    [{ name = "PORT", value = "8080" }],
    local.web_auth_env,
    [
      { name = "NAPKIN_PROXY_MIDDLEWARE_URL", value = local.mw_url },
      { name = "NAPKIN_AGENT_CAP", value = "400" }, # task submissions per agency per server start (meter.rs)
    ],
    local.https ? [{ name = "NAPKIN_WEB_SECURE_COOKIE", value = "1" }] : [],
    # the dogfood record, on the task's EFS under /data/_dogfood
    var.web_dogfood ? [{ name = "NAPKIN_DOGFOOD", value = "1" }] : [],
  )
}

resource "aws_ecs_task_definition" "web" {
  family                   = "${var.name}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.web_cpu
  memory                   = var.web_memory # headless Chromium renders the PDF exports
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.web.arn
  volume {
    name = "data"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.web.id
      transit_encryption = "ENABLED"
      authorization_config {
        access_point_id = aws_efs_access_point.web.id
        iam             = "ENABLED"
      }
    }
  }
  container_definitions = jsonencode([{
    name         = "web"
    image        = "${aws_ecr_repository.app["web"].repository_url}:bootstrap"
    essential    = true
    portMappings = [{ containerPort = 8080, protocol = "tcp" }]
    mountPoints  = [{ sourceVolume = "data", containerPath = "/data" }]
    environment  = local.web_environment
    secrets      = [{ name = "NAPKIN_SESSION_SECRET", valueFrom = var.session_secret_arn }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.app["web"].name
        awslogs-region        = var.region
        awslogs-stream-prefix = "web"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "middleware" {
  family                   = "${var.name}-middleware"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 1024
  memory                   = 2048
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.middleware.arn
  container_definitions = jsonencode([{
    name         = "middleware"
    image        = "${aws_ecr_repository.app["middleware"].repository_url}:bootstrap"
    essential    = true
    portMappings = [{ containerPort = local.mw_port, protocol = "tcp" }]
    environment = [for k, v in merge({
      NAPKIN_HOST         = "0.0.0.0"
      NAPKIN_PORT         = tostring(local.mw_port)
      NAPKIN_MODEL_API    = "bedrock"
      NAPKIN_MODEL_REGION = var.region
    }, var.middleware_env) : { name = k, value = v }]
    secrets = [for k, v in var.middleware_secrets : { name = k, valueFrom = v }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.app["middleware"].name
        awslogs-region        = var.region
        awslogs-stream-prefix = "middleware"
      }
    }
  }])
}

# ── services ──────────────────────────────────────────────────────────────────

resource "aws_ecs_service" "web" {
  name            = "web"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = var.web_count
  capacity_provider_strategy {
    capacity_provider = local.capacity
    weight            = 1
  }
  health_check_grace_period_seconds = 60
  enable_execute_command            = true
  network_configuration {
    subnets         = var.private_subnet_ids
    security_groups = [aws_security_group.web.id]
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 8080
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  lifecycle {
    ignore_changes = [task_definition] # the pipeline deploys revisions
  }
  depends_on = [aws_lb_listener.http, aws_efs_mount_target.web, aws_ecs_cluster_capacity_providers.this]
}

resource "aws_ecs_service" "middleware" {
  name            = "middleware"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.middleware.arn
  desired_count   = var.middleware_count
  capacity_provider_strategy {
    capacity_provider = local.capacity
    weight            = 1
  }
  network_configuration {
    subnets         = var.private_subnet_ids
    security_groups = [aws_security_group.middleware.id, var.data_clients_security_group_id]
  }
  service_registries {
    registry_arn = aws_service_discovery_service.middleware.arn
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  lifecycle {
    ignore_changes = [task_definition]
  }
  depends_on = [aws_ecs_cluster_capacity_providers.this]
}

# ── the pipeline's way in: GitHub OIDC, main branch only ──────────────────────

resource "aws_iam_openid_connect_provider" "github" {
  count          = var.github_oidc_provider_arn == "" ? 1 : 0
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

locals {
  oidc_arn = var.github_oidc_provider_arn != "" ? var.github_oidc_provider_arn : aws_iam_openid_connect_provider.github[0].arn
}

data "aws_iam_policy_document" "deploy_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.oidc_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    # main only: a push to main, or a run of a workflow on main. GitHub names
    # the repository by its ids in the subject (immutable subjects), by name
    # in older repositories; either form is accepted.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values = [for r in compact([var.github_repository, var.github_repository_ids]) :
      "repo:${r}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name               = "${var.name}-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.deploy_trust.json
}

data "aws_iam_policy_document" "deploy" {
  statement {
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    actions = [
      "ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload", "ecr:PutImage", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer",
    ]
    resources = [for r in aws_ecr_repository.app : r.arn]
  }
  statement {
    actions   = ["ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition"]
    resources = ["*"]
  }
  statement {
    actions   = ["ecs:UpdateService", "ecs:DescribeServices"]
    resources = [aws_ecs_service.web.id, aws_ecs_service.middleware.id]
  }
  statement {
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.execution.arn, aws_iam_role.web.arn, aws_iam_role.middleware.arn]
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}
