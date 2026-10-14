-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('SCHEDULED', 'LIVE', 'FINISHED', 'POSTPONED', 'CANCELLED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "Side" AS ENUM ('HOME', 'DRAW', 'AWAY');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('TEAM', 'PLAYER', 'LEAGUE', 'MATCH');

-- CreateEnum
CREATE TYPE "ComboKind" AS ENUM ('SINGLE_SPORT', 'MIXED');

-- CreateEnum
CREATE TYPE "ComboStrategy" AS ENUM ('TOP', 'DIVERSIFIED');

-- CreateEnum
CREATE TYPE "ComboStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'WON', 'LOST', 'VOID');

-- CreateEnum
CREATE TYPE "LegResult" AS ENUM ('PENDING', 'WON', 'LOST', 'VOID');

-- CreateTable
CREATE TABLE "Sport" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hasDraw" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Sport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "League" (
    "id" TEXT NOT NULL,
    "sportId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "tour" TEXT,
    "logo" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "League_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "sportId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normName" TEXT NOT NULL,
    "logo" TEXT,
    "country" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "sportId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normKey" TEXT NOT NULL,
    "tour" TEXT,
    "country" TEXT,
    "hand" TEXT,
    "birthDate" TIMESTAMP(3),
    "photo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalId" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "externalId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalId_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "sportId" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "season" TEXT,
    "round" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "statusDetail" TEXT,
    "homeTeamId" TEXT,
    "awayTeamId" TEXT,
    "homePlayerId" TEXT,
    "awayPlayerId" TEXT,
    "homeName" TEXT NOT NULL,
    "awayName" TEXT NOT NULL,
    "homeLogo" TEXT,
    "awayLogo" TEXT,
    "homeScore" INTEGER,
    "awayScore" INTEGER,
    "winner" "Side",
    "surface" TEXT,
    "neutralVenue" BOOLEAN NOT NULL DEFAULT false,
    "bestOf" INTEGER,
    "primarySource" TEXT NOT NULL,
    "isHistorical" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankingSnapshot" (
    "id" TEXT NOT NULL,
    "sportId" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "leagueId" TEXT,
    "entityType" "EntityType" NOT NULL,
    "entityKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logo" TEXT,
    "groupName" TEXT,
    "position" INTEGER NOT NULL,
    "points" DOUBLE PRECISION,
    "played" INTEGER,
    "wins" INTEGER,
    "draws" INTEGER,
    "losses" INTEGER,
    "goalsFor" INTEGER,
    "goalsAgainst" INTEGER,
    "homeRecord" JSONB,
    "awayRecord" JSONB,
    "form" TEXT,
    "season" TEXT,
    "source" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RankingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "H2HRecord" (
    "id" TEXT NOT NULL,
    "sportId" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "keyLow" TEXT NOT NULL,
    "keyHigh" TEXT NOT NULL,
    "meetings" INTEGER NOT NULL DEFAULT 0,
    "lowWins" INTEGER NOT NULL DEFAULT 0,
    "highWins" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "lastMeetingAt" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "H2HRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormSnapshot" (
    "id" TEXT NOT NULL,
    "sportId" TEXT NOT NULL,
    "entityKey" TEXT NOT NULL,
    "results" TEXT NOT NULL,
    "sample" INTEGER NOT NULL,
    "details" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EloRating" (
    "id" TEXT NOT NULL,
    "sportId" TEXT NOT NULL,
    "entityKey" TEXT NOT NULL,
    "surface" TEXT NOT NULL DEFAULT 'overall',
    "rating" DOUBLE PRECISION NOT NULL,
    "matches" INTEGER NOT NULL DEFAULT 0,
    "lastMatchAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EloRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prediction" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "eligible" BOOLEAN NOT NULL,
    "reason" TEXT,
    "pHome" DOUBLE PRECISION,
    "pDraw" DOUBLE PRECISION,
    "pAway" DOUBLE PRECISION,
    "pick" "Side",
    "pickProb" DOUBLE PRECISION,
    "components" JSONB,
    "dataQuality" JSONB,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Prediction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchOdds" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "bookmaker" TEXT NOT NULL,
    "home" DOUBLE PRECISION,
    "draw" DOUBLE PRECISION,
    "away" DOUBLE PRECISION,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchOdds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Combo" (
    "id" TEXT NOT NULL,
    "kind" "ComboKind" NOT NULL,
    "sportId" TEXT,
    "size" INTEGER NOT NULL,
    "requestedSize" INTEGER NOT NULL,
    "strategy" "ComboStrategy" NOT NULL,
    "signature" TEXT NOT NULL,
    "combinedProb" DOUBLE PRECISION NOT NULL,
    "combinedOdds" DOUBLE PRECISION,
    "legsPriced" INTEGER NOT NULL DEFAULT 0,
    "minLegProb" DOUBLE PRECISION NOT NULL,
    "timezone" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "firstLegStartsAt" TIMESTAMP(3) NOT NULL,
    "lastLegStartsAt" TIMESTAMP(3) NOT NULL,
    "status" "ComboStatus" NOT NULL DEFAULT 'ACTIVE',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastConfirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "Combo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComboLeg" (
    "id" TEXT NOT NULL,
    "comboId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "sportId" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "pick" "Side" NOT NULL,
    "prob" DOUBLE PRECISION NOT NULL,
    "odds" DOUBLE PRECISION,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "result" "LegResult" NOT NULL DEFAULT 'PENDING',
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "ComboLeg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiCallLog" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "params" TEXT,
    "httpStatus" INTEGER,
    "ok" BOOLEAN NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "error" TEXT,
    "remainingDay" INTEGER,
    "remainingMinute" INTEGER,
    "calledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiCallLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderQuota" (
    "id" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "windowType" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "limit" INTEGER NOT NULL,
    "reportedRemaining" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderQuota_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "summary" JSONB,
    "error" TEXT,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BacktestResult" (
    "id" TEXT NOT NULL,
    "sportId" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "sample" INTEGER NOT NULL,
    "accuracy" DOUBLE PRECISION NOT NULL,
    "brier" DOUBLE PRECISION NOT NULL,
    "logLoss" DOUBLE PRECISION NOT NULL,
    "baselineAccuracy" DOUBLE PRECISION NOT NULL,
    "calibration" JSONB NOT NULL,
    "periodFrom" TIMESTAMP(3),
    "periodTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BacktestResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeyValue" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeyValue_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "League_sportId_priority_idx" ON "League"("sportId", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "League_sportId_key_key" ON "League"("sportId", "key");

-- CreateIndex
CREATE INDEX "Team_sportId_normName_idx" ON "Team"("sportId", "normName");

-- CreateIndex
CREATE INDEX "Player_sportId_normKey_idx" ON "Player"("sportId", "normKey");

-- CreateIndex
CREATE INDEX "ExternalId_entityType_entityId_idx" ON "ExternalId"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalId_provider_scope_entityType_externalId_key" ON "ExternalId"("provider", "scope", "entityType", "externalId");

-- CreateIndex
CREATE INDEX "Match_sportId_startsAt_idx" ON "Match"("sportId", "startsAt");

-- CreateIndex
CREATE INDEX "Match_startsAt_status_idx" ON "Match"("startsAt", "status");

-- CreateIndex
CREATE INDEX "Match_homeTeamId_awayTeamId_idx" ON "Match"("homeTeamId", "awayTeamId");

-- CreateIndex
CREATE INDEX "Match_homePlayerId_awayPlayerId_idx" ON "Match"("homePlayerId", "awayPlayerId");

-- CreateIndex
CREATE INDEX "Match_leagueId_startsAt_idx" ON "Match"("leagueId", "startsAt");

-- CreateIndex
CREATE INDEX "RankingSnapshot_sportId_scopeKey_snapshotDate_idx" ON "RankingSnapshot"("sportId", "scopeKey", "snapshotDate");

-- CreateIndex
CREATE INDEX "RankingSnapshot_entityKey_idx" ON "RankingSnapshot"("entityKey");

-- CreateIndex
CREATE UNIQUE INDEX "RankingSnapshot_scopeKey_entityKey_snapshotDate_key" ON "RankingSnapshot"("scopeKey", "entityKey", "snapshotDate");

-- CreateIndex
CREATE INDEX "H2HRecord_stale_fetchedAt_idx" ON "H2HRecord"("stale", "fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "H2HRecord_sportId_keyLow_keyHigh_key" ON "H2HRecord"("sportId", "keyLow", "keyHigh");

-- CreateIndex
CREATE UNIQUE INDEX "FormSnapshot_sportId_entityKey_key" ON "FormSnapshot"("sportId", "entityKey");

-- CreateIndex
CREATE UNIQUE INDEX "EloRating_sportId_entityKey_surface_key" ON "EloRating"("sportId", "entityKey", "surface");

-- CreateIndex
CREATE UNIQUE INDEX "Prediction_matchId_key" ON "Prediction"("matchId");

-- CreateIndex
CREATE INDEX "Prediction_eligible_pickProb_idx" ON "Prediction"("eligible", "pickProb");

-- CreateIndex
CREATE UNIQUE INDEX "MatchOdds_matchId_provider_bookmaker_key" ON "MatchOdds"("matchId", "provider", "bookmaker");

-- CreateIndex
CREATE INDEX "Combo_status_kind_sportId_size_idx" ON "Combo"("status", "kind", "sportId", "size");

-- CreateIndex
CREATE INDEX "Combo_generatedAt_idx" ON "Combo"("generatedAt");

-- CreateIndex
CREATE INDEX "Combo_signature_status_idx" ON "Combo"("signature", "status");

-- CreateIndex
CREATE INDEX "ComboLeg_matchId_idx" ON "ComboLeg"("matchId");

-- CreateIndex
CREATE INDEX "ComboLeg_result_idx" ON "ComboLeg"("result");

-- CreateIndex
CREATE UNIQUE INDEX "ComboLeg_comboId_matchId_key" ON "ComboLeg"("comboId", "matchId");

-- CreateIndex
CREATE INDEX "ApiCallLog_provider_calledAt_idx" ON "ApiCallLog"("provider", "calledAt");

-- CreateIndex
CREATE INDEX "ApiCallLog_ok_calledAt_idx" ON "ApiCallLog"("ok", "calledAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderQuota_providerKey_windowType_key" ON "ProviderQuota"("providerKey", "windowType");

-- CreateIndex
CREATE INDEX "JobRun_name_startedAt_idx" ON "JobRun"("name", "startedAt");

-- CreateIndex
CREATE INDEX "BacktestResult_sportId_createdAt_idx" ON "BacktestResult"("sportId", "createdAt");

-- AddForeignKey
ALTER TABLE "League" ADD CONSTRAINT "League_sportId_fkey" FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_sportId_fkey" FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_sportId_fkey" FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_sportId_fkey" FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchOdds" ADD CONSTRAINT "MatchOdds_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboLeg" ADD CONSTRAINT "ComboLeg_comboId_fkey" FOREIGN KEY ("comboId") REFERENCES "Combo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboLeg" ADD CONSTRAINT "ComboLeg_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
