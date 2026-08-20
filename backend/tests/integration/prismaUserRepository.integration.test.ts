import { beforeEach, describe, expect, it } from "vitest";
import { prismaUserRepository } from "../../src/repositories/prismaUserRepository.js";
import { prisma } from "../../src/lib/prisma.js";
import { resetTestDatabase } from "../helpers/resetTestDatabase.js";

describe("prismaUserRepository integration", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("creates a user with an identity and finds it by identity", async () => {
    const result = await prismaUserRepository.create(
      "user@example.com",
      "google",
      "google-sub-1",
    );

    const identity = await prisma.user_identities.findUnique({
      where: {
        provider_provider_sub: {
          provider: "google",
          provider_sub: "google-sub-1",
        },
      },
    });
    const found = await prismaUserRepository.findByIdentity(
      "google",
      "google-sub-1",
    );

    expect(result.email).toBe("user@example.com");
    expect(result.id).toBeGreaterThan(0);
    expect(identity?.user_id).toBe(result.id);
    expect(found).toEqual(result);
  });

  it("returns undefined when the identity does not exist", async () => {
    const result = await prismaUserRepository.findByIdentity(
      "google",
      "missing-sub",
    );

    expect(result).toBeUndefined();
  });
});
