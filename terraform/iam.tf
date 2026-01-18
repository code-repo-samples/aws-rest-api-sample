# Try to read existing IAM role
data "aws_iam_role" "existing_lambda_role" {
  name = var.lambda_role_name
  # Ignore error if role does not exist
  # Using Terraform >= 1.5, can wrap in try() later
}

# Create role only if it doesn't exist
resource "aws_iam_role" "lambda_role" {
  count = can(data.aws_iam_role.existing_lambda_role.arn) ? 0 : 1

  name = var.lambda_role_name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# Resolve ARN for Lambda regardless of whether created or reused
locals {
  lambda_role_arn = can(data.aws_iam_role.existing_lambda_role.arn)
    ? data.aws_iam_role.existing_lambda_role.arn
    : aws_iam_role.lambda_role[0].arn
}

# Attach basic Lambda execution policy
resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = local.lambda_role_arn
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}
