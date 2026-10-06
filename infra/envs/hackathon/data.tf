# The relay's state (production-tool/relay/store.py has the key layout).

resource "aws_dynamodb_table" "jobs" {
  name         = "${local.name}-jobs"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "jobId"

  attribute {
    name = "jobId"
    type = "S"
  }
  attribute {
    name = "participantId"
    type = "S"
  }
  attribute {
    name = "createdAt"
    type = "S"
  }
  attribute {
    name = "queue"
    type = "S"
  }

  # A participant's jobs, for the organiser queries.
  global_secondary_index {
    name            = "participant"
    hash_key        = "participantId"
    range_key       = "createdAt"
    projection_type = "ALL"
  }

  # Sparse: only jobs waiting (queue = q) or at a provider (queue = r).
  global_secondary_index {
    name            = "active"
    hash_key        = "queue"
    range_key       = "createdAt"
    projection_type = "ALL"
  }

  point_in_time_recovery { enabled = true }
}

# Per-participant daily usage, in-flight counts, provider slots, global spend.
resource "aws_dynamodb_table" "quotas" {
  name         = "${local.name}-quotas"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  attribute {
    name = "pk"
    type = "S"
  }
}

# Blocked handles (lowercase). Blocking is a put-item; it applies at once.
resource "aws_dynamodb_table" "blocked" {
  name         = "${local.name}-blocked"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "handle"
  attribute {
    name = "handle"
    type = "S"
  }
}
