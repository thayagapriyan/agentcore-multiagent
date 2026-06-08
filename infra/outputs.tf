output "ecr_repository_url" {
  description = "Push supervisor images here"
  value       = aws_ecr_repository.agent.repository_url
}

output "agent_runtime_role_arn" {
  description = "Supervisor runtime execution role ARN"
  value       = aws_iam_role.agent_runtime.arn
}

output "agent_runtime_arn" {
  description = "Pass to: aws bedrock-agentcore invoke-agent-runtime --agent-runtime-arn"
  value       = aws_bedrockagentcore_agent_runtime.supervisor.agent_runtime_arn
}

output "agent_runtime_id" {
  description = "AgentCore runtime ID"
  value       = aws_bedrockagentcore_agent_runtime.supervisor.agent_runtime_id
}

output "github_deploy_role_arn" {
  description = "Role GitHub Actions assumes via OIDC — set as the AWS_ROLE_ARN Actions var"
  value       = aws_iam_role.github_deploy.arn
}
