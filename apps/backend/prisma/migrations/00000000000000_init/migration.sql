-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "testnetAddress" TEXT,
    "displayName" TEXT,
    "nameKey" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "passwordHash" TEXT,
    "chatRole" TEXT,
    "frozen" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "showOwnerName" BOOLEAN NOT NULL DEFAULT false,
    "sudobud" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "reservedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "via" TEXT NOT NULL DEFAULT 'login',
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastIp" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAddress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthChallenge" (
    "network" TEXT NOT NULL DEFAULT 'mainnet',
    "id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "valueZat" INTEGER NOT NULL,
    "toAddress" TEXT NOT NULL,
    "zip321" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "sessionId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "code" TEXT,
    "codeTries" INTEGER NOT NULL DEFAULT 0,
    "fundedTxid" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'taddr',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "refundTxid" TEXT,
    "refundedAt" TIMESTAMP(3),
    "codeSends" INTEGER NOT NULL DEFAULT 0,
    "linkAddress" TEXT,
    "seenTxid" TEXT,
    "seenAt" TIMESTAMP(3),
    "seenExpiry" INTEGER,

    CONSTRAINT "AuthChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserWatchlist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{"addresses":[]}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserWatchlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "email" TEXT,
    "discord" TEXT,
    "twitter" TEXT,
    "handle" TEXT,
    "userId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentClaim" (
    "id" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "txid" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "orderKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentNoteClaim" (
    "id" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "txid" TEXT NOT NULL,
    "noteRef" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "orderKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentNoteClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpVideoSwitch" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpVideoSwitch_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "RegistrationGate" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "open" BOOLEAN NOT NULL DEFAULT true,
    "reopensAt" TIMESTAMP(3),
    "message" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistrationGate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImProfile" (
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "avatarKind" TEXT NOT NULL DEFAULT 'gen',
    "avatarSeed" TEXT NOT NULL,
    "avatarData" TEXT,
    "presence" TEXT NOT NULL DEFAULT 'online',
    "doing" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ImBuddy" (
    "id" TEXT NOT NULL,
    "aId" TEXT NOT NULL,
    "bId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requestedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImBuddy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImMessage" (
    "id" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "ImMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Badge" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "tooltip" TEXT NOT NULL,
    "imageData" TEXT NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Badge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBadge" (
    "userId" TEXT NOT NULL,
    "badgeId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBadge_pkey" PRIMARY KEY ("userId","badgeId")
);

-- CreateTable
CREATE TABLE "ZeometryRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "teamKey" TEXT NOT NULL,
    "names" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "wave" INTEGER NOT NULL,
    "ship" TEXT NOT NULL,
    "seconds" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZeometryRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayPage" (
    "userId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "title" TEXT,
    "bio" TEXT,
    "amounts" JSONB,
    "memoHint" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayPage_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ZkylineRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "tenths" INTEGER,
    "seed" INTEGER,

    CONSTRAINT "ZkylineRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_address_key" ON "User"("address");

-- CreateIndex
CREATE UNIQUE INDEX "User_testnetAddress_key" ON "User"("testnetAddress");

-- CreateIndex
CREATE UNIQUE INDEX "User_nameKey_key" ON "User"("nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_token_key" ON "UserSession"("token");

-- CreateIndex
CREATE UNIQUE INDEX "UserAddress_address_key" ON "UserAddress"("address");

-- CreateIndex
CREATE INDEX "UserAddress_userId_network_idx" ON "UserAddress"("userId", "network");

-- CreateIndex
CREATE INDEX "AuthChallenge_status_idx" ON "AuthChallenge"("status");

-- CreateIndex
CREATE INDEX "AuthChallenge_userId_status_idx" ON "AuthChallenge"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AuthChallenge_network_nonce_key" ON "AuthChallenge"("network", "nonce");

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserWatchlist_userId_key" ON "UserWatchlist"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserState_userId_key" ON "UserState"("userId");

-- CreateIndex
CREATE INDEX "Feedback_createdAt_idx" ON "Feedback"("createdAt");

-- CreateIndex
CREATE INDEX "Feedback_readAt_idx" ON "Feedback"("readAt");

-- CreateIndex
CREATE INDEX "PaymentClaim_network_orderKey_idx" ON "PaymentClaim"("network", "orderKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentClaim_network_txid_key" ON "PaymentClaim"("network", "txid");

-- CreateIndex
CREATE INDEX "PaymentNoteClaim_network_txid_idx" ON "PaymentNoteClaim"("network", "txid");

-- CreateIndex
CREATE INDEX "PaymentNoteClaim_network_orderKey_idx" ON "PaymentNoteClaim"("network", "orderKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentNoteClaim_network_txid_noteRef_key" ON "PaymentNoteClaim"("network", "txid", "noteRef");

-- CreateIndex
CREATE UNIQUE INDEX "ImProfile_slug_key" ON "ImProfile"("slug");

-- CreateIndex
CREATE INDEX "ImBuddy_bId_idx" ON "ImBuddy"("bId");

-- CreateIndex
CREATE UNIQUE INDEX "ImBuddy_aId_bId_key" ON "ImBuddy"("aId", "bId");

-- CreateIndex
CREATE INDEX "ImMessage_toId_readAt_idx" ON "ImMessage"("toId", "readAt");

-- CreateIndex
CREATE INDEX "ImMessage_fromId_toId_createdAt_idx" ON "ImMessage"("fromId", "toId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Badge_key_key" ON "Badge"("key");

-- CreateIndex
CREATE INDEX "UserBadge_badgeId_idx" ON "UserBadge"("badgeId");

-- CreateIndex
CREATE INDEX "ZeometryRun_mode_createdAt_score_idx" ON "ZeometryRun"("mode", "createdAt", "score");

-- CreateIndex
CREATE INDEX "ZeometryRun_mode_teamKey_idx" ON "ZeometryRun"("mode", "teamKey");

-- CreateIndex
CREATE INDEX "ZeometryRun_userId_createdAt_idx" ON "ZeometryRun"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ZkylineRun_userId_startedAt_idx" ON "ZkylineRun"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "ZkylineRun_finishedAt_tenths_idx" ON "ZkylineRun"("finishedAt", "tenths");

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAddress" ADD CONSTRAINT "UserAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthChallenge" ADD CONSTRAINT "AuthChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWatchlist" ADD CONSTRAINT "UserWatchlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserState" ADD CONSTRAINT "UserState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "Badge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

