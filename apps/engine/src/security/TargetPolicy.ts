/**
 * Target Access Policy & Security Safeguards
 * Enforces safe target URLs and prevents SSRF / unsafe navigation
 */

export interface TargetPolicyOptions {
  allowLocalTargets?: boolean;
  blockedHosts?: string[];
  allowedProtocols?: string[];
}

export class TargetPolicy {
  private allowLocalTargets: boolean;
  private blockedHosts: Set<string>;
  private allowedProtocols: Set<string>;

  constructor(options: TargetPolicyOptions = {}) {
    this.allowLocalTargets = options.allowLocalTargets ?? true;
    this.allowedProtocols = new Set(options.allowedProtocols ?? ["http:", "https:"]);
    this.blockedHosts = new Set([
      "169.254.169.254", // Cloud metadata service (AWS/GCP/Azure)
      "metadata.google.internal",
      "instance-data",
      ...(options.blockedHosts ?? []),
    ]);
  }

  validateUrl(inputUrl: string): { allowed: boolean; reason?: string; sanitizedUrl?: string } {
    try {
      const parsed = new URL(inputUrl);

      // Protocol check
      if (!this.allowedProtocols.has(parsed.protocol)) {
        return {
          allowed: false,
          reason: "Protocol \"" + parsed.protocol + "\" is forbidden. Only HTTP/HTTPS targets are allowed.",
        };
      }

      // Metadata / SSRF check
      const hostname = parsed.hostname.toLowerCase();
      if (this.blockedHosts.has(hostname)) {
        return {
          allowed: false,
          reason: "Host \"" + hostname + "\" is blocked for security (Cloud metadata endpoint).",
        };
      }

      // Localhost check if disabled
      const isLocal =
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "::1" ||
        hostname.endsWith(".localhost") ||
        hostname === "demo-app";

      if (isLocal && !this.allowLocalTargets) {
        return {
          allowed: false,
          reason: "Localhost access is disabled by security policy.",
        };
      }

      return {
        allowed: true,
        sanitizedUrl: parsed.toString(),
      };
    } catch (e) {
      return {
        allowed: false,
        reason: "Invalid target URL: " + (e instanceof Error ? e.message : String(e)),
      };
    }
  }

  sanitizePageText(input: string, maxLength = 2000): string {
    if (!input) return "";
    return input
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
      .substring(0, maxLength);
  }
}
