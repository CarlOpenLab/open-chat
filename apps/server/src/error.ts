/**
 * Gateway errors mirror the OpenAI-style error response shape used by the
 * rust-chat gateway so clients behave consistently across both implementations.
 */
interface GatewayErrorInit {
  status: number;
  message: string;
  type: string;
  code: string;
}

export class GatewayError extends Error {
  status: number;
  type: string;
  code: string;

  constructor(init: GatewayErrorInit) {
    super(init.message);
    this.name = "GatewayError";
    this.status = init.status;
    this.type = init.type;
    this.code = init.code;
  }

  static unauthorized(): GatewayError {
    return new GatewayError({
      status: 401,
      message: "Unauthorized",
      type: "authentication_error",
      code: "invalid_api_key",
    });
  }

  static unsupportedModel(model: string): GatewayError {
    return new GatewayError({
      status: 400,
      message: `Model is not supported: ${model}`,
      type: "invalid_request_error",
      code: "model_not_supported",
    });
  }

  static invalidRequest(message: string): GatewayError {
    return new GatewayError({
      status: 400,
      message,
      type: "invalid_request_error",
      code: "invalid_request",
    });
  }

  static upstream(message: string): GatewayError {
    return new GatewayError({
      status: 502,
      message,
      type: "upstream_error",
      code: "provider_error",
    });
  }

  toResponse(): { error: { message: string; type: string; code: string } } {
    return {
      error: {
        message: this.message,
        type: this.type,
        code: this.code,
      },
    };
  }
}
