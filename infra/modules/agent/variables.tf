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

# Iter 8: the AgentCore runtime's inbound wire protocol. Defaults to HTTP (the
# /ping+/invocations contract every agent through iter 7 uses), so existing module
# instances are unchanged. The knowledge agent sets this to "MCP" so its runtime
# serves the Model Context Protocol instead — the first non-HTTP runtime in the repo.
variable "server_protocol" {
  description = "AgentCore runtime inbound protocol: HTTP (default, /ping+/invocations) or MCP (serves the Model Context Protocol)."
  type        = string
  default     = "HTTP"

  validation {
    condition     = contains(["HTTP", "MCP"], var.server_protocol)
    error_message = "server_protocol must be \"HTTP\" or \"MCP\"."
  }
}

# Iter 8: optional Cognito JWT inbound authorizer for the runtime. When unset (default),
# the runtime has NO authorizer block → AgentCore's SigV4 floor (every agent through
# iter 7 relies on this for the /invocations door). When set, the runtime accepts
# Cognito bearer tokens for the listed clients — used by the knowledge MCP runtime,
# because AgentCore Runtime has no no-auth mode and the Strands McpClient can't
# SigV4-sign, so the caller authenticates with a JWT instead.
variable "jwt_authorizer" {
  description = "Optional Cognito JWT authorizer: { discovery_url, allowed_clients }. Null (default) leaves the runtime on AgentCore's SigV4 floor."
  type = object({
    discovery_url   = string
    allowed_clients = list(string)
  })
  default = null
}
