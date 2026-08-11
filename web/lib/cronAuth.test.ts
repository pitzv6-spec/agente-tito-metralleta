import { describe, expect, it } from "vitest";
import { isAuthorized } from "./cronAuth";

describe("isAuthorized", () => {
  it("autoriza siempre si no hay secret configurado (local, sin CRON_SECRET)", () => {
    expect(isAuthorized(null, undefined)).toBe(true);
    expect(isAuthorized("cualquier-cosa", undefined)).toBe(true);
  });

  it("rechaza si hay secret pero el header no coincide", () => {
    expect(isAuthorized(null, "secreto")).toBe(false);
    expect(isAuthorized("otro-valor", "secreto")).toBe(false);
  });

  it("autoriza si el header coincide exactamente con el secret", () => {
    expect(isAuthorized("secreto", "secreto")).toBe(true);
  });
});
