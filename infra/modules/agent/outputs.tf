output "ecr_repository_url" {
  description = "Push this agent's images here"
  value       = aws_ecr_repository.this.repository_url
}

output "runtime_role_arn" {
  description = "Runtime execution role ARN"
  value       = aws_iam_role.runtime.arn
}

output "agent_runtime_arn" {
  description = "Pass to: aws bedrock-agentcore invoke-agent-runtime --agent-runtime-arn"
  value       = aws_bedrockagentcore_agent_runtime.this.agent_runtime_arn
}

output "agent_runtime_id" {
  description = "AgentCore runtime ID"
  value       = aws_bedrockagentcore_agent_runtime.this.agent_runtime_id
}
