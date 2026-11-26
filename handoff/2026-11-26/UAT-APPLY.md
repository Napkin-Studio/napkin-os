# Production as a CLAN app on UAT: apply sequence (Stage 3: jobs via napkin-web)

Run after #281, #292 and #304 are merged into develop, from a develop checkout.
An agent plans and reads the plans; a person applies (CLAUDE.md, Infrastructure changes).

## 0. Before anything: does staging share the relay?

There is one relay: `napkin-hackathon-relay`, alias `live`. After step 3, the new relay refuses
every call that lacks napkin-web's service credential (only the Deck's assets pass still uses
TOKEN_SECRET). Today's staging web build sends X-Napkin-Identity, so if staging's web points at
this relay, staging's /production stops working at step 3. It stays down until staging gets the
same release, plus a staging apply that sets production_service_key_arn.

    aws sso login --profile napkin
    TD=$(aws ecs describe-services --profile napkin --cluster napkin-staging --services web --query 'services[0].taskDefinition' --output text)
    aws ecs describe-task-definition --profile napkin --task-definition "$TD" \
      --query 'taskDefinition.containerDefinitions[].environment[?name==`NAPKIN_PRODUCTION_RELAY_URL`]'

If this prints a value, the owner decides before step 3 (a staging outage, a UAT-only relay, or
the staging release with it).

## 1. Hackathon stack: the SERVICE_KEY secret and the relay's SECRET_ARNS

    cd infra/envs/hackathon
    cp backend.hcl.example backend.hcl     # bucket = "napkin-tfstate-741448934623"
    # terraform.tfvars (untracked): cors_origins must include the UAT origin (see terraform.tfvars.example)
    AWS_PROFILE=napkin terraform init -backend-config=backend.hcl
    AWS_PROFILE=napkin terraform plan -out=hack.tfplan

Expected plan: + aws_secretsmanager_secret.relay["SERVICE_KEY"]; ~ aws_lambda_function.relay
(its SECRET_ARNS environment gains SERVICE_KEY); the relay role's secret-read policy gains the new
ARN. Nothing else. Then (a person):

    AWS_PROFILE=napkin terraform apply hack.tfplan

## 2. Put the secret's value (a person; the value is never printed)

    aws secretsmanager put-secret-value --profile napkin --secret-id napkin-hackathon/SERVICE_KEY \
      --secret-string "$(openssl rand -hex 32)"

## 3. UAT stack: web's NAPKIN_PRODUCTION_SERVICE_KEY and NAPKIN_PRODUCTION_UPLOAD_ORIGIN

    cd infra/envs/uat
    cp backend.hcl.example backend.hcl     # bucket = "napkin-tfstate-741448934623"
    # terraform.tfvars: github_oidc_provider_arn (from the example), plus the LIVE values (memory
    # uat-terraform-values: without them the plan strips Production from web):
    #   production_relay_url        = current web task's NAPKIN_PRODUCTION_RELAY_URL
    #   production_relay_secret_arn = current web task's NAPKIN_PRODUCTION_RELAY_SECRET valueFrom
    #   production_service_key_arn  = (new; the plan refuses a relay URL without it):
    aws secretsmanager describe-secret --profile napkin --secret-id napkin-hackathon/SERVICE_KEY --query ARN --output text
    #   production_upload_origin    = default (https://napkin-hackathon-741448934623.s3.eu-west-1.amazonaws.com)
    AWS_PROFILE=napkin terraform init -backend-config=backend.hcl
    AWS_PROFILE=napkin terraform plan -out=uat.tfplan

Expected plan: a new web task definition revision whose environment gains
NAPKIN_PRODUCTION_UPLOAD_ORIGIN and whose secrets gain NAPKIN_PRODUCTION_SERVICE_KEY; the task
execution role's secret ARNs gain SERVICE_KEY. Nothing else. Any change that isn't already
applied from develop (deck engine, backups) also shows up here; read it. Then (a person):

    AWS_PROFILE=napkin terraform apply uat.tfplan

## 4. Deploy the relay, then UAT web, the same hour

    gh workflow run deploy-production-tool.yml -r develop -f parts=relay
    # UAT's /production refuses the old web build from here until the next line lands (minutes; accepted in the design)
    gh workflow run deploy.yml --ref develop -f environment=uat -f ref=develop

## 5. Verify in AWS, not in the workflow

    aws lambda get-function-configuration --profile napkin --function-name napkin-hackathon-relay --qualifier live \
      --query 'Environment.Variables.SECRET_ARNS' --output text | grep -c SERVICE_KEY
    TD=$(aws ecs describe-services --profile napkin --cluster napkin-uat --services web --query 'services[0].taskDefinition' --output text)
    aws ecs describe-task-definition --profile napkin --task-definition "$TD" \
      --query 'taskDefinition.containerDefinitions[].secrets[].name'     # includes NAPKIN_PRODUCTION_SERVICE_KEY

Then on UAT: sign in, open Production, make one frame. Its job posts to
/api/t/<tenant>/d/<doc>/production/jobs, and nothing in the browser calls /production/api. Upload
one picture: it PUTs to the S3 upload origin. Until all of this passes, say "deployed, not yet live".

Rollback: move the relay `live` alias back to the version the deploy summary names, and redeploy
the previous web image, together.
