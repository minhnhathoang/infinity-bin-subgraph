import { Address, BigDecimal, log, BigInt } from "@graphprotocol/graph-ts";
import {
  PoolManager as PoolManagerABI,
  Initialize,
  Swap as SwapEvent,
  Mint,
  Burn,
} from "../generated/PoolManager/PoolManager";
import {
  LBPair,
  Swap,
  Token,
  Transfer,
} from "../generated/schema";
import {
  loadBin,
  loadLbPair,
  loadToken,
  loadBundle,
  loadPoolManager,
  loadTraderJoeHourData,
  loadTraderJoeDayData,
  loadTokenHourData,
  loadTokenDayData,
  loadSJoeDayData,
  loadUser,
  loadLBPairDayData,
  loadLBPairHourData,
  addLiquidityPosition,
  createLBPair,
  removeLiquidityPosition,
  loadTransaction,
  trackBin,
} from "./entities";
import {
  ADDRESS_ZERO,
  BIG_DECIMAL_ZERO,
  BIG_INT_1E4,
  BIG_INT_ONE,
  BIG_INT_ZERO,
} from "./constants";
import {
  formatTokenAmountByDecimals,
  getTrackedLiquidityUSD,
  getTrackedVolumeUSD,
  updateNativeInUsdPricing,
  updateTokensDerivedNative,
  safeDiv,
  decodeAmounts,
} from "./utils";

export function handleInitialize(event: Initialize): void {
  loadBundle();
  const lbPair = createLBPair(event.params, event.block);

  if (!lbPair) {
    return;
  }

  const poolManager = loadPoolManager();
  poolManager.pairCount = poolManager.pairCount.plus(BIG_INT_ONE);
  poolManager.save();
}

export function handleSwap(event: SwapEvent): void {
  const lbPair = loadLbPair(event.params.id.toHexString());

  if (!lbPair) {
    log.warning("[handleSwap] LBPair not detected: {} ", [
      event.params.id.toHexString(),
    ]);
    return;
  }

  // update pricing
  updateNativeInUsdPricing();
  updateTokensDerivedNative(lbPair);

  // price bundle
  const bundle = loadBundle();

  // reset tvl aggregates until new amounts calculated
  const poolManager = loadPoolManager();
  poolManager.totalValueLockedNative = poolManager.totalValueLockedNative.minus(
    lbPair.totalValueLockedNative
  );

  const tokenX = loadToken(Address.fromString(lbPair.tokenX));
  const tokenY = loadToken(Address.fromString(lbPair.tokenY));
  const tokenXPriceUSD = tokenX.derivedNative.times(bundle.nativePriceUSD);
  const tokenYPriceUSD = tokenY.derivedNative.times(bundle.nativePriceUSD);

  // const swapForY = event.params.swapForY;
  const tokenIn = tokenX;
  const tokenOut = tokenY;

  var amountXIn : BigInt;
  var amountYIn : BigInt;
  var amountXOut : BigInt;
  var amountYOut : BigInt;
  if (event.params.amount0 < BIG_INT_ZERO) {
    amountXIn = -event.params.amount0;
    amountYIn = BIG_INT_ZERO;
    amountXOut = BIG_INT_ZERO;
    amountYOut = event.params.amount1;
  } else {
    amountXIn = BIG_INT_ZERO;
    amountYIn = -event.params.amount1;
    amountXOut = event.params.amount0;
    amountYOut = BIG_INT_ZERO;
  }

  const fmtAmountXIn = formatTokenAmountByDecimals(amountXIn, tokenIn.decimals);
  const fmtAmountYIn = formatTokenAmountByDecimals(
    amountYIn,
    tokenOut.decimals
  );
  const fmtAmountXOut = formatTokenAmountByDecimals(
    amountXOut,
    tokenIn.decimals
  );
  const fmtAmountYOut = formatTokenAmountByDecimals(
    amountYOut,
    tokenOut.decimals
  );

  const fee = BigInt.fromI32(event.params.fee);
  const totalFeesX = formatTokenAmountByDecimals(
    amountXIn * fee / BIG_INT_1E4,
    tokenIn.decimals
  );
  const totalFeesY = formatTokenAmountByDecimals(
    amountYIn * fee / BIG_INT_1E4,
    tokenOut.decimals
  );
  const feesUSD = totalFeesX
    .times(tokenIn.derivedNative.times(bundle.nativePriceUSD))
    .plus(totalFeesY.times(tokenY.derivedNative.times(bundle.nativePriceUSD)));

  const amountXTotal = fmtAmountXIn.plus(fmtAmountXOut);
  const amountYTotal = fmtAmountYIn.plus(fmtAmountYOut);

  const trackedVolumeUSD = getTrackedVolumeUSD(
    amountXTotal,
    tokenX as Token,
    amountYTotal,
    tokenY as Token
  );
  const trackedVolumeNative = safeDiv(trackedVolumeUSD, bundle.nativePriceUSD);

  // Bin
  const bin = trackBin(
    lbPair as LBPair,
    event.params.activeId,
    fmtAmountXIn,
    fmtAmountXOut,
    fmtAmountYIn,
    fmtAmountYOut,
    BIG_INT_ZERO,
    BIG_INT_ZERO
  );

  // LBPair
  lbPair.activeId = event.params.activeId;
  lbPair.txCount = lbPair.txCount.plus(BIG_INT_ONE);
  lbPair.reserveX = lbPair.reserveX.plus(fmtAmountXIn).minus(fmtAmountXOut);
  lbPair.reserveY = lbPair.reserveY.plus(fmtAmountYIn).minus(fmtAmountYOut);
  lbPair.totalValueLockedUSD = getTrackedLiquidityUSD(
    lbPair.reserveX,
    tokenX as Token,
    lbPair.reserveY,
    tokenY as Token
  );
  lbPair.totalValueLockedNative = safeDiv(
    lbPair.totalValueLockedUSD,
    bundle.nativePriceUSD
  );
  lbPair.tokenXPrice = bin.priceX;
  lbPair.tokenYPrice = bin.priceY;
  lbPair.volumeTokenX = lbPair.volumeTokenX.plus(amountXTotal);
  lbPair.volumeTokenY = lbPair.volumeTokenY.plus(amountYTotal);
  lbPair.volumeUSD = lbPair.volumeUSD.plus(trackedVolumeUSD);
  lbPair.feesTokenX = lbPair.feesTokenX.plus(totalFeesX);
  lbPair.feesTokenY = lbPair.feesTokenY.plus(totalFeesY);
  lbPair.feesUSD = lbPair.feesUSD.plus(feesUSD);
  lbPair.save();

  // LBPairHourData
  const lbPairHourData = loadLBPairHourData(
    event.block.timestamp,
    lbPair as LBPair,
    true
  );
  lbPairHourData.volumeTokenX = lbPairHourData.volumeTokenX.plus(amountXTotal);
  lbPairHourData.volumeTokenY = lbPairHourData.volumeTokenY.plus(amountYTotal);
  lbPairHourData.volumeUSD = lbPairHourData.volumeUSD.plus(trackedVolumeUSD);
  lbPairHourData.feesUSD = lbPairHourData.feesUSD.plus(feesUSD);
  lbPairHourData.save();

  // LBPairDayData
  const lbPairDayData = loadLBPairDayData(
    event.block.timestamp,
    lbPair as LBPair,
    true
  );
  lbPairDayData.volumeTokenX = lbPairDayData.volumeTokenX.plus(amountXTotal);
  lbPairDayData.volumeTokenY = lbPairDayData.volumeTokenY.plus(amountYTotal);
  lbPairDayData.volumeUSD = lbPairDayData.volumeUSD.plus(trackedVolumeUSD);
  lbPairDayData.feesUSD = lbPairDayData.feesUSD.plus(feesUSD);
  lbPairDayData.save();

  // PoolManager
  poolManager.txCount = poolManager.txCount.plus(BIG_INT_ONE);
  poolManager.volumeUSD = poolManager.volumeUSD.plus(trackedVolumeUSD);
  poolManager.volumeNative = poolManager.volumeNative.plus(trackedVolumeNative);
  poolManager.totalValueLockedNative = poolManager.totalValueLockedNative.plus(
    lbPair.totalValueLockedNative
  );
  poolManager.totalValueLockedUSD = poolManager.totalValueLockedNative.times(
    bundle.nativePriceUSD
  );
  poolManager.feesUSD = poolManager.feesUSD.plus(feesUSD);
  poolManager.feesNative = safeDiv(poolManager.feesUSD, bundle.nativePriceUSD);
  poolManager.save();

  // TraderJoeHourData
  const traderJoeHourData = loadTraderJoeHourData(event.block.timestamp, true);
  traderJoeHourData.volumeNative = traderJoeHourData.volumeNative.plus(
    trackedVolumeNative
  );
  traderJoeHourData.volumeUSD = traderJoeHourData.volumeUSD.plus(
    trackedVolumeUSD
  );
  traderJoeHourData.feesUSD = traderJoeHourData.feesUSD.plus(feesUSD);
  traderJoeHourData.save();

  // TraderJoeDayData
  const traderJoeDayData = loadTraderJoeDayData(event.block.timestamp, true);
  traderJoeDayData.volumeNative = traderJoeDayData.volumeNative.plus(
    trackedVolumeNative
  );
  traderJoeDayData.volumeUSD = traderJoeDayData.volumeUSD.plus(
    trackedVolumeUSD
  );
  traderJoeDayData.feesUSD = traderJoeDayData.feesUSD.plus(feesUSD);
  traderJoeDayData.save();

  // TokenX
  tokenX.txCount = tokenX.txCount.plus(BIG_INT_ONE);
  tokenX.volume = tokenX.volume.plus(amountXTotal);
  tokenX.volumeUSD = tokenX.volumeUSD.plus(trackedVolumeUSD);
  tokenX.totalValueLocked = tokenX.totalValueLocked
    .plus(fmtAmountXIn)
    .minus(fmtAmountXOut);
  tokenX.totalValueLockedUSD = tokenX.totalValueLockedUSD.plus(
    tokenX.totalValueLocked.times(tokenXPriceUSD)
  );
  const feesUsdX = totalFeesX.times(
    tokenIn.derivedNative.times(bundle.nativePriceUSD)
  );
  tokenX.feesUSD = tokenX.feesUSD.plus(feesUsdX);

  // TokenY
  tokenY.txCount = tokenY.txCount.plus(BIG_INT_ONE);
  tokenY.volume = tokenY.volume.plus(amountYTotal);
  tokenY.volumeUSD = tokenY.volumeUSD.plus(trackedVolumeUSD);
  tokenY.totalValueLocked = tokenY.totalValueLocked
    .plus(fmtAmountYIn)
    .minus(fmtAmountYOut);
  tokenY.totalValueLockedUSD = tokenY.totalValueLockedUSD.plus(
    tokenY.totalValueLocked.times(tokenYPriceUSD)
  );
  const feesUsdY = totalFeesY.times(
    tokenY.derivedNative.times(bundle.nativePriceUSD)
  );
  tokenY.feesUSD = tokenY.feesUSD.plus(feesUsdY);

  tokenX.save();
  tokenY.save();

  // TokenXHourData
  const tokenXHourData = loadTokenHourData(
    event.block.timestamp,
    tokenX as Token,
    true
  );
  tokenXHourData.volume = tokenXHourData.volume.plus(amountXTotal);
  tokenXHourData.volumeNative = tokenXHourData.volumeNative.plus(trackedVolumeNative);
  tokenXHourData.volumeUSD = tokenXHourData.volumeUSD.plus(trackedVolumeUSD);
  tokenXHourData.feesUSD = tokenXHourData.feesUSD.plus(feesUsdX);
  tokenXHourData.save();

  // TokenYHourData
  const tokenYHourData = loadTokenHourData(
    event.block.timestamp,
    tokenY as Token,
    true
  );
  tokenYHourData.volume = tokenYHourData.volume.plus(amountYTotal);
  tokenYHourData.volumeNative = tokenYHourData.volumeNative.plus(trackedVolumeNative);
  tokenYHourData.volumeUSD = tokenYHourData.volumeUSD.plus(trackedVolumeUSD);
  tokenYHourData.feesUSD = tokenYHourData.feesUSD.plus(feesUsdY);
  tokenYHourData.save();

  // TokenXDayData
  const tokenXDayData = loadTokenDayData(
    event.block.timestamp,
    tokenX as Token,
    true
  );
  tokenXDayData.volume = tokenXDayData.volume.plus(amountXTotal);
  tokenXDayData.volumeNative = tokenXDayData.volumeNative.plus(trackedVolumeNative);
  tokenXDayData.volumeUSD = tokenXDayData.volumeUSD.plus(trackedVolumeUSD);
  tokenXDayData.feesUSD = tokenXDayData.feesUSD.plus(feesUsdX);
  tokenXDayData.save();

  // TokenYDayData
  const tokenYDayData = loadTokenDayData(
    event.block.timestamp,
    tokenY as Token,
    true
  );
  tokenYDayData.volume = tokenYDayData.volume.plus(amountYTotal);
  tokenYDayData.volumeNative = tokenYDayData.volumeNative.plus(trackedVolumeNative);
  tokenYDayData.volumeUSD = tokenYDayData.volumeUSD.plus(trackedVolumeUSD);
  tokenYDayData.feesUSD = tokenYDayData.feesUSD.plus(feesUsdY);
  tokenYDayData.save();

  // User
  loadUser(event.params.sender);

  // Transaction
  const transaction = loadTransaction(event);

  // Swap
  const swap = new Swap(
    transaction.id.concat("#").concat(lbPair.txCount.toString())
  );
  swap.transaction = transaction.id;
  swap.timestamp = event.block.timestamp.toI32();
  swap.lbPair = lbPair.id;
  swap.sender = event.params.sender;
  swap.recipient = event.params.sender;
  swap.origin = event.transaction.from;
  swap.activeId = event.params.activeId;
  swap.amountXIn = fmtAmountXIn;
  swap.amountXOut = fmtAmountXOut;
  swap.amountYIn = fmtAmountYIn;
  swap.amountYOut = fmtAmountYOut;
  swap.amountUSD = trackedVolumeUSD;
  swap.feesTokenX = totalFeesX;
  swap.feesTokenY = totalFeesY;
  swap.feesUSD = feesUSD;
  swap.logIndex = event.logIndex;
  swap.save();
}

export function handleMint(event: Mint): void {
  const lbPair = loadLbPair(event.params.id.toHexString());
  const poolManager = loadPoolManager();

  if (!lbPair) {
    log.error(
      "[handleMint] returning because LBPair not detected: {} ",
      [event.params.id.toHexString()]
    );
    return;
  }

  // update pricing
  updateNativeInUsdPricing();
  updateTokensDerivedNative(lbPair);

  // price bundle
  const bundle = loadBundle();

  const tokenX = loadToken(Address.fromString(lbPair.tokenX));
  const tokenY = loadToken(Address.fromString(lbPair.tokenY));

  const totalAmountX = BigDecimal.fromString("0");
  const totalAmountY = BigDecimal.fromString("0");

  for (let i = 0; i < event.params.ids.length; i++) {
    const bidId = event.params.ids[i];

    const amounts = decodeAmounts(event.params.amounts[i]);
    const amountX = formatTokenAmountByDecimals(amounts[0], tokenX.decimals);
    const amountY = formatTokenAmountByDecimals(amounts[1], tokenY.decimals);

    totalAmountX.plus(amountX);
    totalAmountY.plus(amountY);

    trackBin(
      lbPair,
      bidId.toI32(),
      amountX, // amountXIn
      BIG_DECIMAL_ZERO,
      amountY, // amountYIn
      BIG_DECIMAL_ZERO,
      BIG_INT_ZERO,
      BIG_INT_ZERO
    );
  }

  // reset tvl aggregates until new amounts calculated
  poolManager.totalValueLockedNative = poolManager.totalValueLockedNative.minus(
    lbPair.totalValueLockedNative
  );

  // LBPair
  lbPair.txCount = lbPair.txCount.plus(BIG_INT_ONE);
  lbPair.reserveX = lbPair.reserveX.plus(totalAmountX);
  lbPair.reserveY = lbPair.reserveY.plus(totalAmountY);

  lbPair.totalValueLockedNative = lbPair.reserveX
    .times(tokenX.derivedNative)
    .plus(lbPair.reserveY.times(tokenY.derivedNative));
  lbPair.totalValueLockedUSD = lbPair.totalValueLockedNative.times(
    bundle.nativePriceUSD
  );

  // get tracked liquidity - will be 0 if neither is in whitelist
  let trackedLiquidityNative: BigDecimal;
  if (bundle.nativePriceUSD.notEqual(BIG_DECIMAL_ZERO)) {
    trackedLiquidityNative = safeDiv(
      getTrackedLiquidityUSD(
        lbPair.reserveX,
        tokenX as Token,
        lbPair.reserveY,
        tokenY as Token
      ),
      bundle.nativePriceUSD
    );
  } else {
    trackedLiquidityNative = BIG_DECIMAL_ZERO;
  }
  lbPair.save();

  // PoolManager
  poolManager.totalValueLockedNative = poolManager.totalValueLockedNative.plus(
    lbPair.totalValueLockedNative
  );
  poolManager.totalValueLockedUSD = poolManager.totalValueLockedNative.times(
    bundle.nativePriceUSD
  );
  poolManager.txCount = poolManager.txCount.plus(BIG_INT_ONE);
  poolManager.save();

  loadLBPairHourData(event.block.timestamp, lbPair as LBPair, true);
  loadLBPairDayData(event.block.timestamp, lbPair as LBPair, true);
  loadTraderJoeHourData(event.block.timestamp, true);
  loadTraderJoeDayData(event.block.timestamp, true);

  // TokenX
  tokenX.txCount = tokenX.txCount.plus(BIG_INT_ONE);
  tokenX.totalValueLocked = tokenX.totalValueLocked.plus(totalAmountX);
  tokenX.totalValueLockedUSD = tokenX.totalValueLocked.times(
    tokenX.derivedNative.times(bundle.nativePriceUSD)
  );
  tokenX.save();

  // TokenY
  tokenY.txCount = tokenY.txCount.plus(BIG_INT_ONE);
  tokenY.totalValueLocked = tokenY.totalValueLocked.plus(totalAmountY);
  tokenY.totalValueLockedUSD = tokenY.totalValueLocked.times(
    tokenY.derivedNative.times(bundle.nativePriceUSD)
  );
  tokenY.save();

  loadTokenHourData(event.block.timestamp, tokenX as Token, true);
  loadTokenHourData(event.block.timestamp, tokenY as Token, true);
  loadTokenDayData(event.block.timestamp, tokenX as Token, true);
  loadTokenDayData(event.block.timestamp, tokenY as Token, true);

  // User
  loadUser(event.params.sender);
}

export function handleBurn(event: Burn): void {
  const lbPair = loadLbPair(event.params.id.toHexString());
  const poolManager = loadPoolManager();

  if (!lbPair) {
    log.warning("[handleBurn] LBPair not detected: {} ", [
      event.params.id.toHexString(),
    ]);
    return;
  }

  // update pricing
  updateNativeInUsdPricing();
  updateTokensDerivedNative(lbPair);

  // price bundle
  const bundle = loadBundle();

  const tokenX = loadToken(Address.fromString(lbPair.tokenX));
  const tokenY = loadToken(Address.fromString(lbPair.tokenY));

  // track bins
  for (let i = 0; i < event.params.amounts.length; i++) {
    const val = event.params.amounts[i];
    const amounts = decodeAmounts(val);
    const fmtAmountX = formatTokenAmountByDecimals(amounts[0], tokenX.decimals);
    const fmtAmountY = formatTokenAmountByDecimals(amounts[1], tokenY.decimals);

    trackBin(
      lbPair,
      event.params.ids[i].toU32(),
      BIG_DECIMAL_ZERO,
      fmtAmountX, // amountXOut
      BIG_DECIMAL_ZERO,
      fmtAmountY, // amountYOut
      BIG_INT_ZERO,
      BIG_INT_ZERO
    );
  }

  // total amounts
  const totalAmountX = event.params.amounts
    .reduce((acc, val) => acc.plus(decodeAmounts(val)[0]), BIG_INT_ZERO)
    .toBigDecimal();
  const totalAmountY = event.params.amounts
    .reduce((acc, val) => acc.plus(decodeAmounts(val)[1]), BIG_INT_ZERO)
    .toBigDecimal();

  // reset tvl aggregates until new amounts calculated
  poolManager.totalValueLockedNative = poolManager.totalValueLockedNative.minus(
    lbPair.totalValueLockedNative
  );

  // LBPair
  lbPair.txCount = lbPair.txCount.plus(BIG_INT_ONE);
  lbPair.reserveX = lbPair.reserveX.minus(totalAmountX);
  lbPair.reserveY = lbPair.reserveY.minus(totalAmountY);

  lbPair.totalValueLockedNative = lbPair.reserveX
    .times(tokenX.derivedNative)
    .plus(lbPair.reserveY.times(tokenY.derivedNative));
  lbPair.totalValueLockedUSD = lbPair.totalValueLockedNative.times(
    bundle.nativePriceUSD
  );

  // get tracked liquidity - will be 0 if neither is in whitelist
  let trackedLiquidityNative: BigDecimal;
  if (bundle.nativePriceUSD.notEqual(BIG_DECIMAL_ZERO)) {
    trackedLiquidityNative = safeDiv(
      getTrackedLiquidityUSD(
        lbPair.reserveX,
        tokenX as Token,
        lbPair.reserveY,
        tokenY as Token
      ),
      bundle.nativePriceUSD
    );
  } else {
    trackedLiquidityNative = BIG_DECIMAL_ZERO;
  }
  lbPair.save();

  // PoolManager
  poolManager.totalValueLockedNative = poolManager.totalValueLockedNative.plus(
    lbPair.totalValueLockedNative
  );
  poolManager.totalValueLockedUSD = poolManager.totalValueLockedNative.times(
    bundle.nativePriceUSD
  );
  poolManager.txCount = poolManager.txCount.plus(BIG_INT_ONE);
  poolManager.save();

  loadLBPairHourData(event.block.timestamp, lbPair as LBPair, true);
  loadLBPairDayData(event.block.timestamp, lbPair as LBPair, true);
  loadTraderJoeHourData(event.block.timestamp, true);
  loadTraderJoeDayData(event.block.timestamp, true);

  // TokenX
  tokenX.txCount = tokenX.txCount.plus(BIG_INT_ONE);
  tokenX.totalValueLocked = tokenX.totalValueLocked.minus(totalAmountX);
  tokenX.totalValueLockedUSD = tokenX.totalValueLocked.times(
    tokenX.derivedNative.times(bundle.nativePriceUSD)
  );
  tokenX.save();

  // TokenY
  tokenY.txCount = tokenY.txCount.plus(BIG_INT_ONE);
  tokenY.totalValueLocked = tokenY.totalValueLocked.minus(totalAmountY);
  tokenY.totalValueLockedUSD = tokenY.totalValueLocked.times(
    tokenY.derivedNative.times(bundle.nativePriceUSD)
  );
  tokenY.save();

  loadTokenHourData(event.block.timestamp, tokenX as Token, true);
  loadTokenHourData(event.block.timestamp, tokenY as Token, true);
  loadTokenDayData(event.block.timestamp, tokenX as Token, true);
  loadTokenDayData(event.block.timestamp, tokenY as Token, true);

  // User
  loadUser(event.params.sender);
}

