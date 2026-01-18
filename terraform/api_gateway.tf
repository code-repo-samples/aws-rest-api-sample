resource "aws_apigatewayv2_api" "http_api" {
  name          = "sample-http-api-${var.environment}"
  protocol_type = "HTTP"
}
