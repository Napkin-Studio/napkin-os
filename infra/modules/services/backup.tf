# Backup of napkin-web's workspaces (features/production-in-library).
#
# Every project and library document lives on web's EFS, so a lost volume or a
# bad deploy would lose them. AWS Backup takes a copy every day at 03:00 UTC
# and keeps it 35 days, in a vault of its own encrypted with the stack's key.
# Off unless backup_enabled; the selection is the one EFS, by ARN.
#
# Restoring is a person's job (Backup console or `aws backup start-restore-job`
# into a new file system); the host's own snapshots (snapshots.rs) cover the
# smaller "go back to an earlier save" case without it.

resource "aws_backup_vault" "web" {
  count       = var.backup_enabled ? 1 : 0
  name        = "${var.name}-web"
  kms_key_arn = var.kms_key_arn
  tags        = { Name = "${var.name}-web" }
}

resource "aws_backup_plan" "web" {
  count = var.backup_enabled ? 1 : 0
  name  = "${var.name}-web-daily"

  rule {
    rule_name         = "daily-0300-utc"
    target_vault_name = aws_backup_vault.web[0].name
    schedule          = "cron(0 3 * * ? *)"

    lifecycle {
      delete_after = 35
    }
  }
}

data "aws_iam_policy_document" "backup_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["backup.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "backup" {
  count              = var.backup_enabled ? 1 : 0
  name               = "${var.name}-backup"
  assume_role_policy = data.aws_iam_policy_document.backup_assume.json
}

resource "aws_iam_role_policy_attachment" "backup" {
  count      = var.backup_enabled ? 1 : 0
  role       = aws_iam_role.backup[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}

resource "aws_backup_selection" "web" {
  count        = var.backup_enabled ? 1 : 0
  name         = "${var.name}-web-efs"
  iam_role_arn = aws_iam_role.backup[0].arn
  plan_id      = aws_backup_plan.web[0].id
  resources    = [aws_efs_file_system.web.arn]
}
