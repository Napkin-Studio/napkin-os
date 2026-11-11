# UAT reads and writes staging's knowledge layers (owner, 2026-11-11: "allow it to hit the same thing as
# staging"; features/uat-environment.clan). UAT's own databases were never migrated, so research stopped
# at its first stage. With layers_from_staging on, the middleware's layer DSNs are staging's secrets,
# the two networks are peered, and staging's Aurora accepts Postgres from UAT's data clients.
# Everything UAT research harvests lands in staging's layers. UAT's own databases stay, unused;
# turning the switch off goes back to them.

variable "layers_from_staging" {
  description = "Use staging's knowledge-layer databases instead of UAT's own (peering + staging's secrets)"
  type        = bool
  default     = true
}

variable "staging_name" {
  description = "Staging's resource prefix: its VPC, route table, Aurora security group and secrets are found by it"
  type        = string
  default     = "napkin-staging"
}

locals {
  from_staging = var.layers_from_staging ? 1 : 0
  # staging's layer secrets by database name: napkin_category, napkin_agency_<slug>
  staging_db_arns = var.layers_from_staging ? {
    for i, n in tolist(data.aws_secretsmanager_secrets.staging_db[0].names) :
    trimprefix(n, "${var.staging_name}/db/") => tolist(data.aws_secretsmanager_secrets.staging_db[0].arns)[i]
  } : {}
  # The middleware's layer DSNs: staging's where staging has that database, else UAT's own.
  layer_secrets = merge({
    NAPKIN_LAYERS_DSN = lookup(local.staging_db_arns, "napkin_category", module.databases.secret_arns["napkin_category"])
    }, {
    for slug in keys(var.agencies) :
    "NAPKIN_LAYERS_AGENCY_DSN_${upper(replace(slug, "-", "_"))}" => lookup(local.staging_db_arns, "napkin_agency_${replace(slug, "-", "_")}", module.databases.secret_arns["napkin_agency_${replace(slug, "-", "_")}"])
  })
}

data "aws_secretsmanager_secrets" "staging_db" {
  count = local.from_staging
  filter {
    name   = "name"
    values = ["${var.staging_name}/db/"]
  }
}

# The keys staging's secrets are encrypted with, so UAT's tasks may read them.
data "aws_secretsmanager_secret" "staging_db" {
  for_each = local.staging_db_arns
  arn      = each.value
}

data "aws_vpc" "staging" {
  count = local.from_staging
  tags  = { Name = var.staging_name }
}

data "aws_route_table" "staging_private" {
  count  = local.from_staging
  vpc_id = data.aws_vpc.staging[0].id
  tags   = { Name = "${var.staging_name}-private" }
}

data "aws_route_table" "uat_private" {
  count  = local.from_staging
  vpc_id = module.network.vpc_id
  tags   = { Name = "${local.name}-private" }
}

data "aws_security_group" "staging_db" {
  count  = local.from_staging
  vpc_id = data.aws_vpc.staging[0].id
  name   = "${var.staging_name}-db"
}

resource "aws_vpc_peering_connection" "staging" {
  count       = local.from_staging
  vpc_id      = module.network.vpc_id
  peer_vpc_id = data.aws_vpc.staging[0].id
  auto_accept = true
  tags        = { Name = "${local.name}-to-staging" }
}

resource "aws_route" "uat_to_staging" {
  count                     = local.from_staging
  route_table_id            = data.aws_route_table.uat_private[0].id
  destination_cidr_block    = data.aws_vpc.staging[0].cidr_block
  vpc_peering_connection_id = aws_vpc_peering_connection.staging[0].id
}

resource "aws_route" "staging_to_uat" {
  count                     = local.from_staging
  route_table_id            = data.aws_route_table.staging_private[0].id
  destination_cidr_block    = var.vpc_cidr
  vpc_peering_connection_id = aws_vpc_peering_connection.staging[0].id
}

resource "aws_vpc_security_group_ingress_rule" "staging_db_from_uat" {
  count                        = local.from_staging
  security_group_id            = data.aws_security_group.staging_db[0].id
  referenced_security_group_id = aws_security_group.data_clients.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "Postgres from napkin-uat data clients (UAT uses staging's layers)"
}
