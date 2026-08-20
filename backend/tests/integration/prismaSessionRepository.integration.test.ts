import { beforeEach, describe, expect, it } from "vitest";
import { prismaSessionRepository } from "../../src/repositories/prismaSessionRepository.js";
import { prisma } from "../../src/lib/prisma.js";
import { resetTestDatabase } from "../helpers/resetTestDatabase.js";

async function createUser() {
  return prisma.users.create({
    data: { email: "user@example.com" },
  });
}

describe("prismaSessionRepository integration", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("creates a session and retrieves it by user", async () => {
    const user = await createUser();
    const expiresAt = new Date("2030-01-01T00:00:00.000Z");

    const created = await prismaSessionRepository.create(user.id, expiresAt);
    const found = await prismaSessionRepository.getByUserId(user.id);

    expect(created).toMatchObject({
      id: expect.any(Number),
      userId: user.id,
      expiresAt,
      revokedAt: null,
    });
    expect(found).toEqual(created);
  });

  it("returns undefined when a user has no session", async () => {
    const user = await createUser();

    const result = await prismaSessionRepository.getByUserId(user.id);

    expect(result).toBeUndefined();
  });

  it("updates a session expiration and clears its revocation", async () => {
    const user = await createUser();
    const session = await prisma.sessions.create({
      data: {
        user_id: user.id,
        expires_at: new Date("2030-01-01T00:00:00.000Z"),
        revoked_at: new Date("2029-01-01T00:00:00.000Z"),
      },
    });
    const newExpiresAt = new Date("2031-01-01T00:00:00.000Z");

    const result = await prismaSessionRepository.updateSession(
      session.id,
      newExpiresAt,
    );
    const persisted = await prisma.sessions.findUnique({
      where: { id: session.id },
    });

    expect(result.expiresAt).toEqual(newExpiresAt);
    expect(result.revokedAt).toBeNull();
    expect(persisted).toMatchObject({
      expires_at: newExpiresAt,
      revoked_at: null,
    });
  });

  it("revokes a session and updates its expiration", async () => {
    const user = await createUser();
    const session = await prisma.sessions.create({
      data: {
        user_id: user.id,
        expires_at: new Date("2030-01-01T00:00:00.000Z"),
      },
    });
    const newExpiresAt = new Date("2031-01-01T00:00:00.000Z");

    await prismaSessionRepository.revokeSession(session.id);
    await prismaSessionRepository.updateExpiresAt(session.id, newExpiresAt);
    const persisted = await prisma.sessions.findUnique({
      where: { id: session.id },
    });

    expect(persisted?.revoked_at).toBeInstanceOf(Date);
    expect(persisted?.expires_at).toEqual(newExpiresAt);
  });

  it("saves, finds, and revokes a refresh token", async () => {
    const user = await createUser();
    const session = await prisma.sessions.create({
      data: {
        user_id: user.id,
        expires_at: new Date("2030-01-01T00:00:00.000Z"),
      },
    });

    await prismaSessionRepository.saveRefreshToken(session.id, "hash-1");
    const found = await prismaSessionRepository.findRefreshToken("hash-1");
    await prismaSessionRepository.revokeRefreshToken(found!.id);
    const persisted = await prisma.refresh_tokens.findUnique({
      where: { token_hash: "hash-1" },
    });

    expect(found?.token_hash).toBe("hash-1");
    expect(found?.sessions.id).toBe(session.id);
    expect(persisted?.revoked_at).toBeInstanceOf(Date);
  });

  it("revokes only active refresh tokens for a session", async () => {
    const user = await createUser();
    const session = await prisma.sessions.create({
      data: {
        user_id: user.id,
        expires_at: new Date("2030-01-01T00:00:00.000Z"),
      },
    });
    const revokedAt = new Date("2029-01-01T00:00:00.000Z");
    await prisma.refresh_tokens.createMany({
      data: [
        { session_id: session.id, token_hash: "active-hash" },
        {
          session_id: session.id,
          token_hash: "already-revoked-hash",
          revoked_at: revokedAt,
        },
      ],
    });

    await prismaSessionRepository.revokeRefreshTokens(session.id);
    const tokens = await prisma.refresh_tokens.findMany({
      where: { session_id: session.id },
      orderBy: { token_hash: "asc" },
    });

    expect(tokens[0]?.revoked_at).toBeInstanceOf(Date);
    expect(tokens[1]?.revoked_at).toEqual(revokedAt);
  });
});
