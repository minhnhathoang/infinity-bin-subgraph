import {Address, BigDecimal, BigInt, log} from '@graphprotocol/graph-ts'
import {Burn as BurnEvent, Initialize, Mint as MintEvent, Swap as SwapEvent} from '../generated/PoolManager/PoolManager'
import {Burn, LBPair, Mint, Swap, Token} from '../generated/schema'
import {BIG_DECIMAL_ZERO, BIG_INT_1E4, BIG_INT_ONE, BIG_INT_ZERO} from './constants'
import {
  createLBPair, loadBin, loadBundle, loadLbPair, loadLBPairDayData, loadLBPairHourData, loadPoolManager, loadToken,
  loadTokenDayData, loadTokenHourData, loadTraderJoeDayData, loadTraderJoeHourData, loadTransaction, loadUser,
  trackBins,
} from './entities'
import {
  decodeAmounts, formatTokenAmountByDecimals, getTrackedLiquidityUSD, getTrackedVolumeUSD, safeDiv,
  updateNativeInUsdPricing, updateTokensDerivedNative,
} from './utils'

export function handleInitialize(event: Initialize): void {
  loadBundle()
  const lbPair = createLBPair(event.params, event.block)

  if (!lbPair) {
    return
  }

  const poolManager = loadPoolManager()
  poolManager.pairCount = poolManager.pairCount.plus(BIG_INT_ONE)
  poolManager.save()
}

export function handleSwap(event: SwapEvent): void {
  const lbPair = loadLbPair(event.params.id.toHexString())

  if (!lbPair) {
    log.warning('[handleSwap] LBPair not detected: {} ', [event.params.id.toHexString()])
    return
  }

  // update pricing
  updateNativeInUsdPricing()
  updateTokensDerivedNative(lbPair)

  // price bundle
  const bundle = loadBundle()

  // reset tvl aggregates until new amounts calculated
  const poolManager = loadPoolManager()
  poolManager.totalValueLockedNative = poolManager.totalValueLockedNative.minus(lbPair.totalValueLockedNative)

  const tokenX = loadToken(Address.fromString(lbPair.tokenX))
  const tokenY = loadToken(Address.fromString(lbPair.tokenY))
  const tokenXPriceUSD = tokenX.derivedNative.times(bundle.nativePriceUSD)
  const tokenYPriceUSD = tokenY.derivedNative.times(bundle.nativePriceUSD)

  let amountXIn: BigInt
  let amountYIn: BigInt
  let amountXOut: BigInt
  let amountYOut: BigInt
  if (event.params.amount0 < BIG_INT_ZERO) {
    amountXIn = event.params.amount0.neg()
    amountYIn = BIG_INT_ZERO
    amountXOut = BIG_INT_ZERO
    amountYOut = event.params.amount1
  } else {
    amountXIn = BIG_INT_ZERO
    amountYIn = event.params.amount1.neg()
    amountXOut = event.params.amount0
    amountYOut = BIG_INT_ZERO
  }

  const fmtAmountXIn = formatTokenAmountByDecimals(amountXIn, tokenX.decimals)
  const fmtAmountYIn = formatTokenAmountByDecimals(amountYIn, tokenY.decimals)
  const fmtAmountXOut = formatTokenAmountByDecimals(amountXOut, tokenX.decimals)
  const fmtAmountYOut = formatTokenAmountByDecimals(amountYOut, tokenY.decimals)

  const fee = BigInt.fromI32(event.params.fee)
  const totalFeesX = formatTokenAmountByDecimals(amountXIn.times(fee).div(BIG_INT_1E4), tokenX.decimals)
  const totalFeesY = formatTokenAmountByDecimals(amountYIn.times(fee).div(BIG_INT_1E4), tokenY.decimals)
  const feesUSD = totalFeesX
    .times(tokenX.derivedNative.times(bundle.nativePriceUSD))
    .plus(totalFeesY.times(tokenY.derivedNative.times(bundle.nativePriceUSD)))

  const amountXTotal = fmtAmountXIn.plus(fmtAmountXOut)
  const amountYTotal = fmtAmountYIn.plus(fmtAmountYOut)

  const trackedVolumeUSD = getTrackedVolumeUSD(amountXTotal, tokenX as Token, amountYTotal, tokenY as Token)
  const trackedVolumeNative = safeDiv(trackedVolumeUSD, bundle.nativePriceUSD)

  // Bin
  trackBins(lbPair as LBPair, lbPair.activeId, event.params.activeId, tokenX.decimals, tokenY.decimals)
  const bin = loadBin(lbPair as LBPair, event.params.activeId)

  // LBPair
  lbPair.activeId = event.params.activeId
  lbPair.txCount = lbPair.txCount.plus(BIG_INT_ONE)
  lbPair.reserveX = lbPair.reserveX.plus(fmtAmountXIn).minus(fmtAmountXOut)
  if (lbPair.reserveX.lt(BIG_DECIMAL_ZERO)) {
    log.warning('[handleSwap] reserveX < 0 {}, fmtAmountXIn {}, fmtAmountXOut {}',
      [lbPair.reserveX.toString(), fmtAmountXIn.toString(), fmtAmountXOut.toString()])
  }
  lbPair.reserveY = lbPair.reserveY.plus(fmtAmountYIn).minus(fmtAmountYOut)
  if (lbPair.reserveY.lt(BIG_DECIMAL_ZERO)) {
    log.warning('[handleSwap] reserveY < 0 {}, fmtAmountYIn {}, fmtAmountYOut {}',
      [lbPair.reserveY.toString(), fmtAmountYIn.toString(), fmtAmountYOut.toString()])
  }
  lbPair.totalValueLockedUSD =
    getTrackedLiquidityUSD(lbPair.reserveX, tokenX as Token, lbPair.reserveY, tokenY as Token)
  lbPair.totalValueLockedNative = safeDiv(lbPair.totalValueLockedUSD, bundle.nativePriceUSD)
  lbPair.tokenXPrice = bin.priceX
  lbPair.tokenYPrice = bin.priceY
  lbPair.volumeTokenX = lbPair.volumeTokenX.plus(amountXTotal)
  lbPair.volumeTokenY = lbPair.volumeTokenY.plus(amountYTotal)
  lbPair.volumeUSD = lbPair.volumeUSD.plus(trackedVolumeUSD)
  lbPair.feesTokenX = lbPair.feesTokenX.plus(totalFeesX)
  lbPair.feesTokenY = lbPair.feesTokenY.plus(totalFeesY)
  lbPair.feesUSD = lbPair.feesUSD.plus(feesUSD)
  lbPair.save()

  // LBPairHourData
  const lbPairHourData = loadLBPairHourData(event.block.timestamp, lbPair as LBPair, true)
  lbPairHourData.volumeTokenX = lbPairHourData.volumeTokenX.plus(amountXTotal)
  lbPairHourData.volumeTokenY = lbPairHourData.volumeTokenY.plus(amountYTotal)
  lbPairHourData.volumeUSD = lbPairHourData.volumeUSD.plus(trackedVolumeUSD)
  lbPairHourData.feesUSD = lbPairHourData.feesUSD.plus(feesUSD)
  lbPairHourData.save()

  // LBPairDayData
  const lbPairDayData = loadLBPairDayData(event.block.timestamp, lbPair as LBPair, true)
  lbPairDayData.volumeTokenX = lbPairDayData.volumeTokenX.plus(amountXTotal)
  lbPairDayData.volumeTokenY = lbPairDayData.volumeTokenY.plus(amountYTotal)
  lbPairDayData.volumeUSD = lbPairDayData.volumeUSD.plus(trackedVolumeUSD)
  lbPairDayData.feesUSD = lbPairDayData.feesUSD.plus(feesUSD)
  lbPairDayData.save()

  // PoolManager
  poolManager.txCount = poolManager.txCount.plus(BIG_INT_ONE)
  poolManager.volumeUSD = poolManager.volumeUSD.plus(trackedVolumeUSD)
  poolManager.volumeNative = poolManager.volumeNative.plus(trackedVolumeNative)
  poolManager.totalValueLockedNative = poolManager.totalValueLockedNative.plus(lbPair.totalValueLockedNative)
  poolManager.totalValueLockedUSD = poolManager.totalValueLockedNative.times(bundle.nativePriceUSD)
  poolManager.feesUSD = poolManager.feesUSD.plus(feesUSD)
  poolManager.feesNative = safeDiv(poolManager.feesUSD, bundle.nativePriceUSD)
  poolManager.save()

  // TraderJoeHourData
  const traderJoeHourData = loadTraderJoeHourData(event.block.timestamp, true)
  traderJoeHourData.volumeNative = traderJoeHourData.volumeNative.plus(trackedVolumeNative)
  traderJoeHourData.volumeUSD = traderJoeHourData.volumeUSD.plus(trackedVolumeUSD)
  traderJoeHourData.feesUSD = traderJoeHourData.feesUSD.plus(feesUSD)
  traderJoeHourData.save()

  // TraderJoeDayData
  const traderJoeDayData = loadTraderJoeDayData(event.block.timestamp, true)
  traderJoeDayData.volumeNative = traderJoeDayData.volumeNative.plus(trackedVolumeNative)
  traderJoeDayData.volumeUSD = traderJoeDayData.volumeUSD.plus(trackedVolumeUSD)
  traderJoeDayData.feesUSD = traderJoeDayData.feesUSD.plus(feesUSD)
  traderJoeDayData.save()

  // TokenX
  tokenX.txCount = tokenX.txCount.plus(BIG_INT_ONE)
  tokenX.volume = tokenX.volume.plus(amountXTotal)
  tokenX.volumeUSD = tokenX.volumeUSD.plus(trackedVolumeUSD)
  tokenX.totalValueLocked = tokenX.totalValueLocked
    .plus(fmtAmountXIn)
    .minus(fmtAmountXOut)
  tokenX.totalValueLockedUSD = tokenX.totalValueLockedUSD.plus(tokenX.totalValueLocked.times(tokenXPriceUSD))
  const feesUsdX = totalFeesX.times(tokenX.derivedNative.times(bundle.nativePriceUSD))
  tokenX.feesUSD = tokenX.feesUSD.plus(feesUsdX)

  // TokenY
  tokenY.txCount = tokenY.txCount.plus(BIG_INT_ONE)
  tokenY.volume = tokenY.volume.plus(amountYTotal)
  tokenY.volumeUSD = tokenY.volumeUSD.plus(trackedVolumeUSD)
  tokenY.totalValueLocked = tokenY.totalValueLocked
    .plus(fmtAmountYIn)
    .minus(fmtAmountYOut)
  tokenY.totalValueLockedUSD = tokenY.totalValueLockedUSD.plus(tokenY.totalValueLocked.times(tokenYPriceUSD))
  const feesUsdY = totalFeesY.times(tokenY.derivedNative.times(bundle.nativePriceUSD))
  tokenY.feesUSD = tokenY.feesUSD.plus(feesUsdY)

  tokenX.save()
  tokenY.save()

  // TokenXHourData
  const tokenXHourData = loadTokenHourData(event.block.timestamp, tokenX as Token, true)
  tokenXHourData.volume = tokenXHourData.volume.plus(amountXTotal)
  tokenXHourData.volumeNative = tokenXHourData.volumeNative.plus(trackedVolumeNative)
  tokenXHourData.volumeUSD = tokenXHourData.volumeUSD.plus(trackedVolumeUSD)
  tokenXHourData.feesUSD = tokenXHourData.feesUSD.plus(feesUsdX)
  tokenXHourData.save()

  // TokenYHourData
  const tokenYHourData = loadTokenHourData(event.block.timestamp, tokenY as Token, true)
  tokenYHourData.volume = tokenYHourData.volume.plus(amountYTotal)
  tokenYHourData.volumeNative = tokenYHourData.volumeNative.plus(trackedVolumeNative)
  tokenYHourData.volumeUSD = tokenYHourData.volumeUSD.plus(trackedVolumeUSD)
  tokenYHourData.feesUSD = tokenYHourData.feesUSD.plus(feesUsdY)
  tokenYHourData.save()

  // TokenXDayData
  const tokenXDayData = loadTokenDayData(event.block.timestamp, tokenX as Token, true)
  tokenXDayData.volume = tokenXDayData.volume.plus(amountXTotal)
  tokenXDayData.volumeNative = tokenXDayData.volumeNative.plus(trackedVolumeNative)
  tokenXDayData.volumeUSD = tokenXDayData.volumeUSD.plus(trackedVolumeUSD)
  tokenXDayData.feesUSD = tokenXDayData.feesUSD.plus(feesUsdX)
  tokenXDayData.save()

  // TokenYDayData
  const tokenYDayData = loadTokenDayData(event.block.timestamp, tokenY as Token, true)
  tokenYDayData.volume = tokenYDayData.volume.plus(amountYTotal)
  tokenYDayData.volumeNative = tokenYDayData.volumeNative.plus(trackedVolumeNative)
  tokenYDayData.volumeUSD = tokenYDayData.volumeUSD.plus(trackedVolumeUSD)
  tokenYDayData.feesUSD = tokenYDayData.feesUSD.plus(feesUsdY)
  tokenYDayData.save()

  // User
  loadUser(event.params.sender)

  // Transaction
  const transaction = loadTransaction(event)

  // Swap
  const swap = new Swap(transaction.id.concat('#').concat(lbPair.txCount.toString()))
  swap.transaction = transaction.id
  swap.timestamp = event.block.timestamp.toI32()
  swap.lbPair = lbPair.id
  swap.sender = event.params.sender
  swap.recipient = event.params.sender
  swap.origin = event.transaction.from
  swap.activeId = event.params.activeId
  swap.amountXIn = fmtAmountXIn
  swap.amountXOut = fmtAmountXOut
  swap.amountYIn = fmtAmountYIn
  swap.amountYOut = fmtAmountYOut
  swap.amountUSD = trackedVolumeUSD
  swap.feesTokenX = totalFeesX
  swap.feesTokenY = totalFeesY
  swap.feesUSD = feesUSD
  swap.logIndex = event.logIndex
  swap.save()
}

export function handleMint(event: MintEvent): void {
  const lbPair = loadLbPair(event.params.id.toHexString())
  const poolManager = loadPoolManager()

  if (!lbPair) {
    log.error('[handleMint] returning because LBPair not detected: {} ', [event.params.id.toHexString()])
    return
  }

  // update pricing
  updateNativeInUsdPricing()
  updateTokensDerivedNative(lbPair)

  // price bundle
  const bundle = loadBundle()

  const tokenX = loadToken(Address.fromString(lbPair.tokenX))
  const tokenY = loadToken(Address.fromString(lbPair.tokenY))

  let totalAmountX = BigDecimal.zero()
  let totalAmountY = BigDecimal.zero()

  // track bins
  let minId = event.params.ids[0].toI32()
  let maxId = event.params.ids[0].toI32()
  for (let i = 0; i < event.params.ids.length; i++) {
    const id = event.params.ids[i].toI32()
    if (id < minId) {
      minId = id
    } else if (id > maxId) {
      maxId = id
    }
    const amounts = decodeAmounts(event.params.amounts[i])
    const amountX = formatTokenAmountByDecimals(amounts[0], tokenX.decimals)
    const amountY = formatTokenAmountByDecimals(amounts[1], tokenY.decimals)
    log.debug("[handleMint] id: {} amountX: {} amountY: {}", [id.toString(), amountX.toString(), amountY.toString()])

    totalAmountX = totalAmountX.plus(amountX)
    totalAmountY = totalAmountY.plus(amountY)
  }
  trackBins(lbPair, minId, maxId, tokenX.decimals, tokenY.decimals)

  const compositionFeeAmounts = decodeAmounts(event.params.compositionFeeAmount)
  const feeAmountsToProtocol = decodeAmounts(event.params.feeAmountToProtocol)
  const feeAmountToProtocolX = formatTokenAmountByDecimals(feeAmountsToProtocol[0], tokenX.decimals)
  const feeAmountToProtocolY = formatTokenAmountByDecimals(feeAmountsToProtocol[1], tokenY.decimals)
  const feesUSD = feeAmountToProtocolX
    .times(tokenX.derivedNative.times(bundle.nativePriceUSD))
    .plus(feeAmountToProtocolY.times(tokenY.derivedNative.times(bundle.nativePriceUSD)))

  // reset tvl aggregates until new amounts calculated
  poolManager.totalValueLockedNative = poolManager.totalValueLockedNative.minus(lbPair.totalValueLockedNative)

  // LBPair
  lbPair.txCount = lbPair.txCount.plus(BIG_INT_ONE)
  lbPair.reserveX = lbPair.reserveX.plus(totalAmountX)
  lbPair.reserveY = lbPair.reserveY.plus(totalAmountY)

  lbPair.totalValueLockedNative = lbPair.reserveX
    .times(tokenX.derivedNative)
    .plus(lbPair.reserveY.times(tokenY.derivedNative))
  lbPair.totalValueLockedUSD = lbPair.totalValueLockedNative.times(bundle.nativePriceUSD)
  lbPair.save()

  // PoolManager
  poolManager.totalValueLockedNative = poolManager.totalValueLockedNative.plus(lbPair.totalValueLockedNative)
  poolManager.totalValueLockedUSD = poolManager.totalValueLockedNative.times(bundle.nativePriceUSD)
  poolManager.feesUSD = poolManager.feesUSD.plus(feesUSD)
  poolManager.feesNative = safeDiv(poolManager.feesUSD, bundle.nativePriceUSD)
  poolManager.txCount = poolManager.txCount.plus(BIG_INT_ONE)
  poolManager.save()

  loadLBPairHourData(event.block.timestamp, lbPair as LBPair, true)
  loadLBPairDayData(event.block.timestamp, lbPair as LBPair, true)
  loadTraderJoeHourData(event.block.timestamp, true)
  loadTraderJoeDayData(event.block.timestamp, true)

  // TokenX
  tokenX.txCount = tokenX.txCount.plus(BIG_INT_ONE)
  tokenX.totalValueLocked = tokenX.totalValueLocked.plus(totalAmountX)
  tokenX.totalValueLockedUSD = tokenX.totalValueLocked.times(tokenX.derivedNative.times(bundle.nativePriceUSD))
  tokenX.save()

  // TokenY
  tokenY.txCount = tokenY.txCount.plus(BIG_INT_ONE)
  tokenY.totalValueLocked = tokenY.totalValueLocked.plus(totalAmountY)
  tokenY.totalValueLockedUSD = tokenY.totalValueLocked.times(tokenY.derivedNative.times(bundle.nativePriceUSD))
  tokenY.save()

  loadTokenHourData(event.block.timestamp, tokenX as Token, true)
  loadTokenHourData(event.block.timestamp, tokenY as Token, true)
  loadTokenDayData(event.block.timestamp, tokenX as Token, true)
  loadTokenDayData(event.block.timestamp, tokenY as Token, true)

  // User
  loadUser(event.params.sender)

  // Transaction
  const transaction = loadTransaction(event)

  // Mint
  const mint = new Mint(transaction.id.concat('#').concat(lbPair.txCount.toString()))
  mint.transaction = transaction.id
  mint.timestamp = event.block.timestamp.toI32()
  mint.lbPair = lbPair.id
  mint.sender = event.params.sender
  mint.recipient = event.params.sender
  mint.origin = event.transaction.from
  mint.idsCount = event.params.ids.length
  mint.minId = minId
  mint.maxId = maxId
  mint.salt = event.params.salt
  mint.compositionFeeAmountX = formatTokenAmountByDecimals(compositionFeeAmounts[0], tokenX.decimals)
  mint.compositionFeeAmountY = formatTokenAmountByDecimals(compositionFeeAmounts[1], tokenY.decimals)
  mint.feeAmountToProtocolX = feeAmountToProtocolX
  mint.feeAmountToProtocolY = feeAmountToProtocolY
  mint.amountX = totalAmountX
  mint.amountY = totalAmountY
  mint.amountUSD = getTrackedLiquidityUSD(totalAmountX, tokenX, totalAmountY, tokenY)
  mint.logIndex = event.logIndex
  mint.save()
}

export function handleBurn(event: BurnEvent): void {
  const lbPair = loadLbPair(event.params.id.toHexString())
  const poolManager = loadPoolManager()

  if (!lbPair) {
    log.warning('[handleBurn] LBPair not detected: {} ', [event.params.id.toHexString()])
    return
  }

  // update pricing
  updateNativeInUsdPricing()
  updateTokensDerivedNative(lbPair)

  // price bundle
  const bundle = loadBundle()

  const tokenX = loadToken(Address.fromString(lbPair.tokenX))
  const tokenY = loadToken(Address.fromString(lbPair.tokenY))

  let totalAmountX = BigDecimal.zero()
  let totalAmountY = BigDecimal.zero()

  // track bins
  let minId = event.params.ids[0].toI32()
  let maxId = event.params.ids[0].toI32()
  for (let i = 0; i < event.params.ids.length; i++) {
    const id = event.params.ids[i].toI32()
    if (id < minId) {
      minId = id
    } else if (id > maxId) {
      maxId = id
    }
    const amounts = decodeAmounts(event.params.amounts[i])
    const amountX = formatTokenAmountByDecimals(amounts[0], tokenX.decimals)
    const amountY = formatTokenAmountByDecimals(amounts[1], tokenY.decimals)

    totalAmountX = totalAmountX.plus(amountX)
    totalAmountY = totalAmountY.plus(amountY)
  }
  trackBins(lbPair, minId, maxId, tokenX.decimals, tokenY.decimals)

  // reset tvl aggregates until new amounts calculated
  poolManager.totalValueLockedNative = poolManager.totalValueLockedNative.minus(lbPair.totalValueLockedNative)

  // LBPair
  lbPair.txCount = lbPair.txCount.plus(BIG_INT_ONE)
  lbPair.reserveX = lbPair.reserveX.minus(totalAmountX)
  if (lbPair.reserveX.lt(BIG_DECIMAL_ZERO)) {
    log.warning('[handleBurn] LBPair reserveX < 0: {}, totalAmountX: {}',
      [lbPair.reserveX.toString(), totalAmountX.toString()])
  }
  lbPair.reserveY = lbPair.reserveY.minus(totalAmountY)
  if (lbPair.reserveY.lt(BIG_DECIMAL_ZERO)) {
    log.warning('[handleBurn] LBPair reserveY < 0: {}, totalAmountY: {}',
      [lbPair.reserveY.toString(), totalAmountY.toString()])
  }

  lbPair.totalValueLockedNative = lbPair.reserveX
    .times(tokenX.derivedNative)
    .plus(lbPair.reserveY.times(tokenY.derivedNative))
  lbPair.totalValueLockedUSD = lbPair.totalValueLockedNative.times(bundle.nativePriceUSD)
  lbPair.save()

  // PoolManager
  poolManager.totalValueLockedNative = poolManager.totalValueLockedNative.plus(lbPair.totalValueLockedNative)
  poolManager.totalValueLockedUSD = poolManager.totalValueLockedNative.times(bundle.nativePriceUSD)
  poolManager.txCount = poolManager.txCount.plus(BIG_INT_ONE)
  poolManager.save()

  loadLBPairHourData(event.block.timestamp, lbPair as LBPair, true)
  loadLBPairDayData(event.block.timestamp, lbPair as LBPair, true)
  loadTraderJoeHourData(event.block.timestamp, true)
  loadTraderJoeDayData(event.block.timestamp, true)

  // TokenX
  tokenX.txCount = tokenX.txCount.plus(BIG_INT_ONE)
  tokenX.totalValueLocked = tokenX.totalValueLocked.minus(totalAmountX)
  tokenX.totalValueLockedUSD = tokenX.totalValueLocked.times(tokenX.derivedNative.times(bundle.nativePriceUSD))
  tokenX.save()

  // TokenY
  tokenY.txCount = tokenY.txCount.plus(BIG_INT_ONE)
  tokenY.totalValueLocked = tokenY.totalValueLocked.minus(totalAmountY)
  tokenY.totalValueLockedUSD = tokenY.totalValueLocked.times(tokenY.derivedNative.times(bundle.nativePriceUSD))
  tokenY.save()

  loadTokenHourData(event.block.timestamp, tokenX as Token, true)
  loadTokenHourData(event.block.timestamp, tokenY as Token, true)
  loadTokenDayData(event.block.timestamp, tokenX as Token, true)
  loadTokenDayData(event.block.timestamp, tokenY as Token, true)

  // User
  loadUser(event.params.sender)

  // Transaction
  const transaction = loadTransaction(event)

  // Burn
  const burn = new Burn(transaction.id.concat('#').concat(lbPair.txCount.toString()))
  burn.transaction = transaction.id
  burn.timestamp = event.block.timestamp.toI32()
  burn.lbPair = lbPair.id
  burn.sender = event.params.sender
  burn.recipient = event.params.sender
  burn.origin = event.transaction.from
  burn.idsCount = event.params.ids.length
  burn.minId = minId
  burn.maxId = maxId
  burn.salt = event.params.salt
  burn.amountX = totalAmountX
  burn.amountY = totalAmountY
  burn.amountUSD = getTrackedLiquidityUSD(totalAmountX, tokenX, totalAmountY, tokenY)
  burn.logIndex = event.logIndex
  burn.save()
}
