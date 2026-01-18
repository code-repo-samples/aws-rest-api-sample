output "api_url" {
  description = "Base URL for the deployed HTTP API"
  value       = aws_apigatewayv2_api.http_api.api_endpoint
}
