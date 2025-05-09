import {BigDecimal, BigInt, Bytes} from '@graphprotocol/graph-ts'
import {BIG_DECIMAL_ZERO, BIG_INT_ZERO} from '../constants'

export function formatDecimalsToExponent(decimals: BigInt): BigDecimal {
  return BigDecimal.fromString('1' + '0'.repeat(decimals.toI32()))
}

export function formatTokenAmountByDecimals(
  tokenAmount: BigInt,
  exchangeDecimals: BigInt,
): BigDecimal {
  if (exchangeDecimals === BIG_INT_ZERO) {
    return tokenAmount.toBigDecimal()
  }
  return tokenAmount.divDecimal(formatDecimalsToExponent(exchangeDecimals))
}

export function safeDiv(amount0: BigDecimal, amount1: BigDecimal): BigDecimal {
  if (amount1.equals(BIG_DECIMAL_ZERO)) {
    return BIG_DECIMAL_ZERO
  } else {
    return amount0.div(amount1)
  }
}

export function decodeAmounts(amounts: Bytes): Array<BigInt> {
  const amountsXBytes = amounts.slice(16, 32)
  amountsXBytes.reverse()
  const amountsX = changetype<BigInt>(amountsXBytes)

  const amountsYBytes = amounts.slice(0, 16)
  amountsYBytes.reverse()
  const amountsY = changetype<BigInt>(amountsYBytes)

  return [amountsX, amountsY]
}

export function decodeBinStep(parameters: Bytes): BigInt {
  // [16 - 31[: binSteps (16 bits)
  const binStepsBytes = parameters.slice(28, 30)
  binStepsBytes.reverse()
  return changetype<BigInt>(binStepsBytes)
}

export * from './pricing'
