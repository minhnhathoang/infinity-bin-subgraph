import {Address, BigDecimal, BigInt, log} from '@graphprotocol/graph-ts'
import {Burn as BurnEvent, Initialize, Mint as MintEvent, Swap as SwapEvent} from '../generated/PoolManager/PoolManager'
import {Burn, LBPair, Mint, Swap} from '../generated/schema'
import {BIG_DECIMAL_ZERO, BIG_INT_ONE, BIG_INT_ZERO} from './constants'
import {
  createLBPair, loadBin, loadLbPair, loadPoolManager, loadToken, loadTransaction,
  trackBins,
} from './entities'
import {
  decodeAmounts, formatTokenAmountByDecimals,
} from './utils'

export function handleInitialize(event: Initialize): void {
  const lbPair = createLBPair(event.params, event.block)

  if (!lbPair) {
    log.warning('[handleInitialize] can not create LBPair, tx: {}', [event.transaction.hash.toHexString()])
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

  // reset tvl aggregates until new amounts calculated
  const poolManager = loadPoolManager()

  const tokenX = loadToken(Address.fromString(lbPair.tokenX))
  const tokenY = loadToken(Address.fromString(lbPair.tokenY))

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
  lbPair.tokenXPrice = bin.priceX
  lbPair.tokenYPrice = bin.priceY
  lbPair.save()

  // PoolManager
  poolManager.txCount = poolManager.txCount.plus(BIG_INT_ONE)
  poolManager.save()

  // TokenX
  tokenX.txCount = tokenX.txCount.plus(BIG_INT_ONE)

  // TokenY
  tokenY.txCount = tokenY.txCount.plus(BIG_INT_ONE)

  tokenX.save()
  tokenY.save()

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

  // LBPair
  lbPair.txCount = lbPair.txCount.plus(BIG_INT_ONE)
  lbPair.reserveX = lbPair.reserveX.plus(totalAmountX)
  lbPair.reserveY = lbPair.reserveY.plus(totalAmountY)
  lbPair.save()

  // PoolManager
  poolManager.txCount = poolManager.txCount.plus(BIG_INT_ONE)
  poolManager.save()

  // TokenX
  tokenX.txCount = tokenX.txCount.plus(BIG_INT_ONE)
  tokenX.save()

  // TokenY
  tokenY.txCount = tokenY.txCount.plus(BIG_INT_ONE)
  tokenY.save()

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
  mint.amountX = totalAmountX
  mint.amountY = totalAmountY
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
  lbPair.save()

  // PoolManager
  poolManager.txCount = poolManager.txCount.plus(BIG_INT_ONE)
  poolManager.save()

  // TokenX
  tokenX.txCount = tokenX.txCount.plus(BIG_INT_ONE)
  tokenX.save()

  // TokenY
  tokenY.txCount = tokenY.txCount.plus(BIG_INT_ONE)
  tokenY.save()

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
  burn.logIndex = event.logIndex
  burn.save()
}
