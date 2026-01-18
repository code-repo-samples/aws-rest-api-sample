"""
AWS Lambda REST  API with fault injection.

Features:
- GET /items
- POST /items
- ~0.1% of requests randomly fail
- Returns realistic HTTP 4xx and 5xx responses
"""

import json
import random

# Probability configuration
# 0.001 = 0.1% chance
FAILURE_PROBABILITY = 0.001


def should_fail_request():
    """
    Determine whether the current request should fail.

    Uses a random float between 0.0 and 1.0 and compares
    it against FAILURE_PROBABILITY.

    Returns:
        bool: True if request should fail, False otherwise
    """
    return random.random() < FAILURE_PROBABILITY


def generate_error_response():
    """
    Randomly generate a client-side (400) or server-side (500) error.

    Returns:
        dict: API Gateway compatible error response
    """

    # Randomly choose between 400 and 500 class errors
    error_type = random.choice(["400", "500"])

    if error_type == "400":
        return {
            "statusCode": 400,
            "body": json.dumps({
                "error": "BadRequest",
                "message": "Simulated client error"
            })
        }

    return {
        "statusCode": 500,
        "body": json.dumps({
            "error": "InternalServerError",
            "message": "Simulated server error"
        })
    }


def lambda_handler(event, context):
    """
    Main Lambda entry point.

    Args:
        event (dict): API Gateway request
        context (LambdaContext): Runtime context

    Returns:
        dict: API Gateway compatible response
    """

    # Inject random failure BEFORE normal processing
    if should_fail_request():
        return generate_error_response()

    # Extract HTTP method safely
    http_method = event.get("requestContext", {}) \
                       .get("http", {}) \
                       .get("method")

    if http_method == "GET":
        return {
            "statusCode": 200,
            "body": json.dumps({
                "message": "GET request successful",
                "items": ["item1", "item2"]
            })
        }

    if http_method == "POST":
        body = json.loads(event.get("body", "{}"))

        return {
            "statusCode": 201,
            "body": json.dumps({
                "message": "POST request successful",
                "received": body
            })
        }

    return {
        "statusCode": 405,
        "body": json.dumps({
            "error": "MethodNotAllowed",
            "message": "Unsupported HTTP method"
        })
    }
