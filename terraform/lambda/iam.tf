data "aws_iam_role" "existing_lambda_role" {
  name = var.lambda_role_name
}

locals {
  lambda_role_arn = data.aws_iam_role.existing_lambda_role.arn
}
