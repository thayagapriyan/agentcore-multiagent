variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "agent_name" {
  description = "Logical name for the supervisor agent — drives ECR repo and IAM role names. Prefixed per agent so future deployables (iter 5) don't collide."
  type        = string
  default     = "multiagent-supervisor"
}

variable "image_tag" {
  description = "ECR image tag to deploy"
  type        = string
  default     = "latest"
}

variable "model_id" {
  description = "Bedrock model id / inference-profile passed to the runtime as MODEL_ID. Haiku 4.5 is inference-profile-only, hence the global. prefix."
  type        = string
  default     = "global.anthropic.claude-haiku-4-5-20251001-v1:0"
}

variable "supervisor_a2a_enabled" {
  description = "Start the A2A server inside the HTTP supervisor's container (Agent Card + JSON-RPC on A2A_PORT, default 9000). Not externally reachable on the HTTP-protocol runtime — the public A2A door is the separate A2A-protocol runtime in supervisor-a2a.tf."
  type        = bool
  default     = false
}

variable "supervisor_a2a_public_url" {
  description = "Externally reachable URL of the A2A runtime (https://bedrock-agentcore.<region>.amazonaws.com/runtimes/<url-encoded-arn>/invocations/), advertised on the Agent Card. The ARN only exists after the first apply, so: apply once, read a2a_endpoint_url, set this, apply again. Empty = card advertises a placeholder; clients that use the URL they were given (not the card's) work regardless."
  type        = string
  default     = ""
}

variable "supervisor_a2a_sigv4_public_url" {
  description = "Manual override for the Agent Card URL of the SigV4 A2A runtime. Normally leave empty: AgentCore injects AGENTCORE_RUNTIME_URL into the container, so the card advertises the real endpoint without it (see iter-4 findings; mirrors supervisor_a2a_public_url)."
  type        = string
  default     = ""
}

variable "github_repo" {
  description = "GitHub owner/repo allowed to assume the CI/CD deploy role via OIDC"
  type        = string
  default     = "thayagapriyan/agentcore-multiagent"
}
