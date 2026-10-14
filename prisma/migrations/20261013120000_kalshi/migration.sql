-- CreateTable
CREATE TABLE "KalshiMarket" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "side" "Side" NOT NULL,
    "seriesTicker" TEXT NOT NULL,
    "eventTicker" TEXT NOT NULL,
    "marketTicker" TEXT NOT NULL,
    "eventTitle" TEXT NOT NULL,
    "marketTitle" TEXT NOT NULL,
    "yesAsk" DOUBLE PRECISION,
    "yesBid" DOUBLE PRECISION,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KalshiMarket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KalshiCombo" (
    "id" TEXT NOT NULL,
    "legsKey" TEXT NOT NULL,
    "collectionTicker" TEXT NOT NULL,
    "eventTicker" TEXT NOT NULL,
    "marketTicker" TEXT NOT NULL,
    "legTickers" TEXT[],
    "yesAsk" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KalshiCombo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KalshiMarket_marketTicker_idx" ON "KalshiMarket"("marketTicker");

-- CreateIndex
CREATE UNIQUE INDEX "KalshiMarket_matchId_side_key" ON "KalshiMarket"("matchId", "side");

-- CreateIndex
CREATE UNIQUE INDEX "KalshiCombo_legsKey_key" ON "KalshiCombo"("legsKey");

-- AddForeignKey
ALTER TABLE "KalshiMarket" ADD CONSTRAINT "KalshiMarket_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

