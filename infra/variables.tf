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

variable "github_repo" {
  description = "GitHub owner/repo allowed to assume the CI/CD deploy role via OIDC"
  type        = string
  default     = "thayagapriyan/agentcore-multiagent"
}
