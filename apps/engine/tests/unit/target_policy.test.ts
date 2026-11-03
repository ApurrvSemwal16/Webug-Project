import { describe, test, expect } from "bun:test";
import { TargetPolicy } from "../../src/security/TargetPolicy";

describe("TargetPolicy - URL and SSRF Security Enforcement", () => {
  const policy = new TargetPolicy();

  test("Allows valid http and https URLs", () => {
    expect(policy.validateUrl("http://localhost:3000").allowed).toBe(true);
    expect(policy.validateUrl("https://example.com/checkout").allowed).toBe(true);
  });

  test("Rejects dangerous protocols", () => {
    expect(policy.validateUrl("file:///etc/passwd").allowed).toBe(false);
    expect(policy.validateUrl("javascript:alert(1)").allowed).toBe(false);
    expect(policy.validateUrl("data:text/html,<script></script>").allowed).toBe(false);
  });

  test("Blocks cloud metadata services (SSRF protection)", () => {
    expect(policy.validateUrl("http://169.254.169.254/latest/meta-data").allowed).toBe(false);
    expect(policy.validateUrl("http://metadata.google.internal/computeMetadata").allowed).toBe(false);
  });

  test("Enforces allowLocalTargets flag when disabled", () => {
    const strictPolicy = new TargetPolicy({ allowLocalTargets: false });
    expect(strictPolicy.validateUrl("http://localhost:3000").allowed).toBe(false);
    expect(strictPolicy.validateUrl("http://127.0.0.1:8080").allowed).toBe(false);
    expect(strictPolicy.validateUrl("https://mycompany.com").allowed).toBe(true);
  });

  test("Sanitizes page text and removes control characters", () => {
    const dirty = "Welcome\x00to\x07our\x1Bstore!";
    const clean = policy.sanitizePageText(dirty);
    expect(clean).toBe("Welcometoourstore!");
  });
});
