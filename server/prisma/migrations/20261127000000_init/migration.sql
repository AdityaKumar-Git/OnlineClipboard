-- CreateEnum
CREATE TYPE "ShareKind" AS ENUM ('TEXT', 'FILE');

-- CreateEnum
CREATE TYPE "ShareMode" AS ENUM ('TEMP', 'HISTORY');

-- CreateEnum
CREATE TYPE "ShareStatus" AS ENUM ('ACTIVE', 'DELETED', 'DELETE_FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "googleSub" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "driveConnected" BOOLEAN NOT NULL DEFAULT false,
    "driveRefreshTokenEnc" TEXT,
    "driveFolderId" TEXT,
    "driveConnectedAt" TIMESTAMP(3),
    "driveTokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Share" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" "ShareKind" NOT NULL,
    "textContent" TEXT,
    "driveFileId" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "sizeBytes" BIGINT,
    "pin" TEXT NOT NULL,
    "mode" "ShareMode" NOT NULL,
    "pinExpiresAt" TIMESTAMP(3) NOT NULL,
    "deleteAfter" TIMESTAMP(3),
    "status" "ShareStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Share_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");

-- CreateIndex
CREATE INDEX "Share_ownerId_createdAt_idx" ON "Share"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "Share_status_deleteAfter_idx" ON "Share"("status", "deleteAfter");

-- AddForeignKey
ALTER TABLE "Share" ADD CONSTRAINT "Share_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

