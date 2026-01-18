data "archive_file" "lambda_zip" {
  type        = "zip"
  source_file = "../lambda/lambda_function.py"
  output_path = "lambda.zip"
}

resource "aws_lambda_function" "api_lambda" {
  function_name = "sample-rest-api-${var.environment}"
  runtime       = "python3.11"
  handler       = "lambda_function.lambda_handler"
  role          = local.lambda_role_arn
  filename      = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = {
      ENVIRONMENT = var.environment
    }
  }
}
