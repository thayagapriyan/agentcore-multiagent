variable "agent_name" {
  description = "Logical name for this agent — drives ECR repo and IAM role names. Prefixed per agent so deployables don't collide."
  type        = string
}

variable "model_id" {
  description = "Bedrock model id / inference-profile passed to the runtime as MODEL_ID."
  type        = string
}

variable "image_tag" {
  description = "ECR image tag to deploy."
  type        = string
  default     = "latest"
}

variable "account_id" {
  description = "AWS account id, passed from the root so the module doesn't need its own caller-identity data source."
  type        = string
}

variable "description" {
  description = "Human-readable description for the AgentCore runtime."
  type        = string
  default     = ""
}

variable "environment_variables" {
  description = "Extra env vars merged into the runtime (on top of LOG_LEVEL + MODEL_ID). Lets later iterations add Gateway/session/A2A config per agent without restructuring the block."
  type        = map(string)
  default     = {}
}
