export const ACCESS_REQUIRED_EVENT = "open-chat:access-required";

let gatewayAccessGranted = false;

export function setGatewayAccessGranted(granted: boolean): void {
  gatewayAccessGranted = granted;
}

export function requireGatewayAccess(): void {
  if (!gatewayAccessGranted) throw new Error("请输入访问密码");
}

/** Revoke browser access once; concurrent 401 responses must not fan out events. */
export function handleGatewayUnauthorized(response: Response): void {
  if (response.status !== 401 || !gatewayAccessGranted) return;
  gatewayAccessGranted = false;
  window.dispatchEvent(new Event(ACCESS_REQUIRED_EVENT));
}
