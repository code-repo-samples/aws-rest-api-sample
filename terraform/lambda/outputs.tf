output "api_url" {
  description = "Base URL of the deployed REST API"
  value       = aws_apigatewayv2_api.http_api.api_endpoint
}
