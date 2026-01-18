variable "environment" {
  description = "Deployment environment (dev or staging)"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "lambda_role_name" {
  description = "IAM role name for Lambda"
  type        = string
}
