import {Address, BigDecimal, BigInt} from '@graphprotocol/graph-ts'
import {DexLens} from '../../generated/PoolManager/DexLens'
import {LBPair, Token} from '../../generated/schema'
import {
  BIG_DECIMAL_1E18, BIG_DECIMAL_ONE, BIG_DECIMAL_ZERO, JOE_DEX_LENS_ADDRESS, JOE_DEX_LENS_USD_DECIMALS, WNATIVE_ADDRESS,
} from '../constants'
import {loadBundle, loadToken} from '../entities'

export function getNativePriceInUSD(): BigDecimal {
  const dexLens = DexLens.bind(JOE_DEX_LENS_ADDRESS)

  const priceUsdResult = dexLens.try_getTokenPriceUSD(WNATIVE_ADDRESS)

  if (priceUsdResult.reverted) {
    return BIG_DECIMAL_ZERO
  }

  return priceUsdResult.value
    .toBigDecimal()
    .div(JOE_DEX_LENS_USD_DECIMALS)
}

export function getTokenPriceInNative(token: Token): BigDecimal {
  const dexLens = DexLens.bind(JOE_DEX_LENS_ADDRESS)

  const tokenAddress = Address.fromString(token.id)

  const priceInNativeResult = dexLens.try_getTokenPriceNative(tokenAddress)

  if (priceInNativeResult.reverted) {
    return BIG_DECIMAL_ZERO
  }

  return priceInNativeResult.value
    .toBigDecimal()
    .div(BIG_DECIMAL_1E18)
}

/**
 * Updates nativePriceUSD pricing
 */
export function updateNativeInUsdPricing(): void {
  const bundle = loadBundle()
  bundle.nativePriceUSD = getNativePriceInUSD()
  bundle.save()
}

/**
 * Updates and tokenX/tokenY derivedNative pricing
 * @param {LBPair} lbPair
 */
export function updateTokensDerivedNative(lbPair: LBPair): void {
  const tokenX = loadToken(Address.fromString(lbPair.tokenX))
  const tokenY = loadToken(Address.fromString(lbPair.tokenY))

  tokenX.derivedNative = getTokenPriceInNative(tokenX)
  tokenY.derivedNative = getTokenPriceInNative(tokenY)

  const bundle = loadBundle()
  const tokenXPriceUSD = tokenX.derivedNative.times(bundle.nativePriceUSD)
  const tokenYPriceUSD = tokenY.derivedNative.times(bundle.nativePriceUSD)
  lbPair.tokenXPriceUSD = tokenXPriceUSD
  lbPair.tokenYPriceUSD = tokenYPriceUSD

  tokenX.save()
  tokenY.save()
  lbPair.save()
}

/**
 * Returns the liquidity in USD
 * - Liquidity is tracked for all tokens
 *
 * @param tokenXAmount
 * @param tokenX
 * @param tokenYAmount
 * @param tokenY
 * @returns
 */
export function getTrackedLiquidityUSD(
  tokenXAmount: BigDecimal,
  tokenX: Token,
  tokenYAmount: BigDecimal,
  tokenY: Token,
): BigDecimal {
  const bundle = loadBundle()
  const priceXUSD = tokenX.derivedNative.times(bundle.nativePriceUSD)
  const priceYUSD = tokenY.derivedNative.times(bundle.nativePriceUSD)

  return tokenXAmount.times(priceXUSD).plus(tokenYAmount.times(priceYUSD))
}

/**
 * Returns the volume in USD by taking the average of both amounts
 * - Volume is tracked for all tokens
 *
 * @param tokenXAmount
 * @param tokenX
 * @param tokenYAmount
 * @param tokenY
 * @returns
 */
export function getTrackedVolumeUSD(
  tokenXAmount: BigDecimal,
  tokenX: Token,
  tokenYAmount: BigDecimal,
  tokenY: Token,
): BigDecimal {
  const bundle = loadBundle()
  const priceXUSD = tokenX.derivedNative.times(bundle.nativePriceUSD)
  const priceYUSD = tokenY.derivedNative.times(bundle.nativePriceUSD)

  return tokenXAmount
    .times(priceXUSD)
    .plus(tokenYAmount.times(priceYUSD))
    .div(BigDecimal.fromString('2'))
}

/**
 * Returns the price of the bin given its id and bin step
 * (1 + binStep / 10_000) ** (id - 8388608)
 *
 * @param { number } binId
 * @param { BigInt } binStep
 * @param { Token } tokenX
 * @param { Token } tokenY
 */
export function getPriceYOfBin(
  binId: number,
  binStep: BigInt,
  tokenX: Token,
  tokenY: Token,
): BigDecimal {
  const BASIS_POINT_MAX = new BigDecimal(BigInt.fromI32(10_000))
  const BIN_STEP = new BigDecimal(binStep)
  const REAL_SHIFT = 8388608

  // compute bpVal = (1 + binStep / 10_000)
  const bpVal = BIG_DECIMAL_ONE.plus(BIN_STEP.div(BASIS_POINT_MAX))

  // compute bpVal ** (id - 8388608)
  const loop = binId - REAL_SHIFT
  const isPositive = loop > 0

  let result = BIG_DECIMAL_ONE

  for (let i = 0; i < Math.abs(loop); i++) {
    if (isPositive) {
      result = result.times(bpVal)
    } else {
      result = result.div(bpVal)
    }
  }

  // get price in terms of tokenY
  const tokenYDecimals = BigDecimal.fromString(`1e${tokenY.decimals.toI32()}`)
  const tokenXDecimals = BigDecimal.fromString(`1e${tokenX.decimals.toI32()}`)

  return result.times(tokenXDecimals).div(tokenYDecimals)
}
