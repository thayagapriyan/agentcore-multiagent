# Shared account identity, consumed by cicd.tf and passed into agent modules.
# The per-agent runtime role + policies live in infra/modules/agent (iter 3 refactor).
data "aws_caller_identity" "current" {}
