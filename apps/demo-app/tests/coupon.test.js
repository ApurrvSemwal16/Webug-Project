import { describe, test, expect, beforeAll, afterAll } from "bun:test";

const BASE_URL = process.env.DEMO_APP_URL || "http://localhost:3000";

describe("Demo Application - Coupon Regression Test Suite", () => {
  // Ensure fix is reset before tests
  beforeAll(async () => {
    const res = await fetch(`${BASE_URL}/api/admin/reset-fix`, { method: "POST" });
    expect(res.status).toBe(200);
  });

  // Ensure fix is reset after tests as well
  afterAll(async () => {
    await fetch(`${BASE_URL}/api/admin/reset-fix`, { method: "POST" });
  });

  test("1. Demo app health endpoint is healthy", async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.timestamp).toBe("number");
  });

  test("2. Initial state: isFixApplied is false", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/fix-status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isFixApplied).toBe(false);
  });

  test("3. Initial state: SAVE10 intentionally returns HTTP 500", async () => {
    const res = await fetch(`${BASE_URL}/api/coupon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "SAVE10" }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.message).toContain("Coupon validation service unavailable");
  });

  test("4. Initial state: Ordinary valid coupon WELCOME10 works (HTTP 200)", async () => {
    const res = await fetch(`${BASE_URL}/api/coupon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "WELCOME10" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.discount).toBe(10);
    expect(body.type).toBe("percent");
  });

  test("5. Initial state: Ordinary valid coupon SAVE20 works (HTTP 200)", async () => {
    const res = await fetch(`${BASE_URL}/api/coupon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "SAVE20" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.discount).toBe(20);
    expect(body.type).toBe("percent");
  });

  test("6. Initial state: Invalid coupon returns HTTP 400", async () => {
    const res = await fetch(`${BASE_URL}/api/coupon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "INVALID" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(body.message).toBe("Invalid coupon code");
  });

  test("7. Apply demo fix: POST /api/admin/apply-fix succeeds", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/apply-fix`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.isFixApplied).toBe(true);
  });

  test("8. Post-fix state: fix-status endpoint confirms isFixApplied is true", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/fix-status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isFixApplied).toBe(true);
  });

  test("9. Post-fix state: SAVE10 succeeds with HTTP 200 and 10% discount", async () => {
    const res = await fetch(`${BASE_URL}/api/coupon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "SAVE10" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.discount).toBe(10);
    expect(body.type).toBe("percent");
  });

  test("10. Post-fix state: Existing valid coupon WELCOME10 still works (HTTP 200)", async () => {
    const res = await fetch(`${BASE_URL}/api/coupon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "WELCOME10" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.discount).toBe(10);
  });

  test("11. Post-fix state: Existing invalid coupon behavior unchanged (HTTP 400)", async () => {
    const res = await fetch(`${BASE_URL}/api/coupon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "NONEXISTENT" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.valid).toBe(false);
  });

  test("12. Reset fix: POST /api/admin/reset-fix restores initial failure behavior", async () => {
    const resetRes = await fetch(`${BASE_URL}/api/admin/reset-fix`, { method: "POST" });
    expect(resetRes.status).toBe(200);

    const couponRes = await fetch(`${BASE_URL}/api/coupon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "SAVE10" }),
    });
    expect(couponRes.status).toBe(500);
  });
});
