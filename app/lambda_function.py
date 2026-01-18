"""
AWS Lambda function providing a minimal REST API.

Supports:
- GET  /items
- POST /items

Designed to be triggered by API Gateway HTTP API.
"""

import json

def lambda_handler(event, context):
    """
    Main Lambda handler.

    Args:
        event (dict): API Gateway request payload
        context (LambdaContext): Runtime metadata

    Returns:
        dict: API Gateway compatible response
    """

    # Extract HTTP method safely
    http_method = event.get("requestContext", {}).get("http", {}).get("method")

    if http_method == "GET":
        # Simple GET response
        return {
            "statusCode": 200,
            "body": json.dumps({
                "message": "GET request successful",
                "items": ["item1", "item2"]
            })
        }

    elif http_method == "POST":
        # Parse request body safely
        body = json.loads(event.get("body", "{}"))

        return {
            "statusCode": 201,
            "body": json.dumps({
                "message": "POST request successful",
                "received": body
            })
        }

    # Unsupported method fallback
    return {
        "statusCode": 405,
        "body": json.dumps({"error": "Method not allowed"})
    }
