import { describe, expect, it } from "vitest";
import { authHeaders } from "../../web/src/api";

describe("authHeaders", () => {
  it("omits Authorization when the desk has no token, and never sets an identity header", () => {
    expect(authHeaders("")).toEqual({});
    expect(authHeaders("test-token")).toEqual({ authorization: "Bearer test-token" });
    expect(Object.keys(authHeaders("test-token"))).toEqual(["authorization"]);
  });
});
