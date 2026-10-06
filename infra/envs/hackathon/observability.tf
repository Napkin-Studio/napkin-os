# One JSON line per relay request (production-tool/relay/service.py): kind,
# method, route, participant, jobId, op, provider, model, status, latencyMs,
# state, error, costUsd, and jobS once a job is final.

resource "aws_cloudwatch_log_group" "relay" {
  name              = "/aws/lambda/${local.name}-relay"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "stitch" {
  name              = "/aws/lambda/${local.name}-stitch"
  retention_in_days = 14
}

resource "aws_cloudwatch_query_definition" "errors_by_provider" {
  name            = "${local.name}/errors by provider"
  log_group_names = [aws_cloudwatch_log_group.relay.name]
  query_string    = <<-Q
    fields @timestamp, provider, error, op
    | filter kind = "request" and ispresent(error)
    | stats count(*) as errors by provider, error, op
    | sort errors desc
  Q
}

resource "aws_cloudwatch_query_definition" "latency_by_op" {
  name            = "${local.name}/p95 latency by op"
  log_group_names = [aws_cloudwatch_log_group.relay.name]
  query_string    = <<-Q
    fields op, jobS, latencyMs
    | filter kind = "request" and ispresent(op)
    | stats pct(jobS, 50) as job_p50_s, pct(jobS, 95) as job_p95_s,
            pct(latencyMs, 95) as request_p95_ms, count(*) as requests by op, provider
    | sort job_p95_s desc
  Q
}

resource "aws_cloudwatch_query_definition" "jobs_per_participant" {
  name            = "${local.name}/jobs per participant"
  log_group_names = [aws_cloudwatch_log_group.relay.name]
  query_string    = <<-Q
    fields participant, jobId, op
    | filter kind = "request" and method = "POST" and route like /jobs$/ and status = 200
    | stats count_distinct(jobId) as jobs by participant
    | sort jobs desc
  Q
}
