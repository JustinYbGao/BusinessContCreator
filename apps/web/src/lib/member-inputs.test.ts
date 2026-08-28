import { describe, expect, it } from "vitest";
import {
  MEMBER_DISPLAY_NAME_MAX_LENGTH,
  MEMBER_PASSWORD_MIN_LENGTH,
  parseMemberCreateInput,
  parseMemberPasswordResetInput,
  parseMemberRoleChangeInput,
  parseMemberStatusChangeInput,
} from "./member-inputs.js";

describe("member input boundaries", () => {
  it("normalizes email and trims the display name within the database limit", () => {
    expect(parseMemberCreateInput({
      email: " Admin@Example.com ",
      displayName: "  Ada Lovelace  ",
      role: "admin",
      password: "temporary-pass",
    })).toEqual({
      email: "admin@example.com",
      displayName: "Ada Lovelace",
      role: "admin",
      password: "temporary-pass",
    });

    expect(parseMemberCreateInput({
      email: "member@example.com",
      displayName: ` ${"a".repeat(MEMBER_DISPLAY_NAME_MAX_LENGTH)} `,
      role: "member",
      password: "temporary-pass",
    }).displayName).toBe("a".repeat(MEMBER_DISPLAY_NAME_MAX_LENGTH));
  });

  it("rejects owner role, revoked status outside its boundary, and invalid password input without echoing the password", () => {
    expect(() => parseMemberRoleChangeInput({ role: "owner" })).toThrow("INVALID_MEMBER_ROLE_INPUT");
    expect(() => parseMemberStatusChangeInput({ status: "disabled" })).toThrow("INVALID_MEMBER_STATUS_INPUT");

    const weakPassword = "too-short";
    expect(() => parseMemberCreateInput({
      email: "member@example.com",
      role: "member",
      password: weakPassword,
    })).toThrow("INVALID_MEMBER_CREATE_INPUT");
    expect(() => parseMemberPasswordResetInput({ password: weakPassword })).toThrow("INVALID_MEMBER_PASSWORD_INPUT");

    for (const action of [
      () => parseMemberCreateInput({
        email: "member@example.com",
        role: "member",
        password: weakPassword,
      }),
      () => parseMemberPasswordResetInput({ password: weakPassword }),
    ]) {
      try {
        action();
      } catch (error) {
        expect(String(error)).not.toContain(weakPassword);
      }
    }
  });

  it("keeps the password minimum at 12 characters and treats password confirmation as out of scope for the API", () => {
    expect(MEMBER_PASSWORD_MIN_LENGTH).toBe(12);
    expect(parseMemberPasswordResetInput({ password: "123456789012" })).toEqual({
      password: "123456789012",
    });
    expect(() => parseMemberPasswordResetInput({
      password: "123456789012",
      confirmPassword: "123456789012",
    })).toThrow("INVALID_MEMBER_PASSWORD_INPUT");
  });
});
