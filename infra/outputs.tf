output "ecr_repository_url" {
  description = "Push supervisor images here"
  value       = module.supervisor.ecr_repository_url
}

output "agent_runtime_role_arn" {
  description = "Supervisor runtime execution role ARN"
  value       = module.supervisor.runtime_role_arn
}

output "agent_runtime_arn" {
  description = "Supervisor HTTP runtime ARN. Kept for backward compatibility; new callers should prefer runtime_arns[\"supervisor\"]."
  value       = module.supervisor.agent_runtime_arn
}

output "agent_runtime_id" {
  description = "AgentCore runtime ID"
  value       = module.supervisor.agent_runtime_id
}

# Per-agent HTTP-runtime ARN map (iter 5): the first iteration with >1 deployable.
# Smoke tests and callers select by agent — `terraform output -json runtime_arns |
# jq -r .<agent>` — instead of the flat single-agent output. Every future agent
# adds one entry here.
output "runtime_arns" {
  description = "Map of agent name → its HTTP-runtime ARN (invoke-agent-runtime target). Keyed by agent: supervisor, router, critic, ..."
  value = {
    supervisor = module.supervisor.agent_runtime_arn
    router     = module.router.agent_runtime_arn
    critic     = module.critic.agent_runtime_arn
  }
}

output "router_ecr_repository_url" {
  description = "Push router images here"
  value       = module.router.ecr_repository_url
}

output "router_runtime_arn" {
  description = "Router HTTP runtime ARN (also in runtime_arns[\"router\"])"
  value       = module.router.agent_runtime_arn
}

output "critic_ecr_repository_url" {
  description = "Push critic images here"
  value       = module.critic.ecr_repository_url
}

output "critic_runtime_arn" {
  description = "Critic HTTP runtime ARN (also in runtime_arns[\"critic\"])"
  value       = module.critic.agent_runtime_arn
}

output "github_deploy_role_arn" {
  description = "Role GitHub Actions assumes via OIDC — set as the AWS_ROLE_ARN Actions var"
  value       = aws_iam_role.github_deploy.arn
}
