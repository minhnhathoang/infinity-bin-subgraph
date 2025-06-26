import {BigDecimal, BigInt} from '@graphprotocol/graph-ts'
import { Token} from '../../generated/schema'
import {BIG_DECIMAL_ONE} from '../constants'

const BASIS_POINT_MAX = new BigDecimal(BigInt.fromI32(10_000))
const REAL_SHIFT = 8388608

function pow(base: BigDecimal, exp: i64): BigDecimal {
  let absExp = exp < 0 ? -exp : exp;
  let result = BigDecimal.fromString("1");
  let b = base;
  while (absExp > 0) {
    if ((absExp & 1) == 1) {
      result = result.times(b);
    }
    b = b.times(b);
    absExp >>= 1;
  }
  return exp < 0 ? BigDecimal.fromString("1").div(result) : result;
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
  const BIN_STEP = new BigDecimal(binStep)

  // compute bpVal = (1 + binStep / 10_000)
  const bpVal = BIG_DECIMAL_ONE.plus(BIN_STEP.div(BASIS_POINT_MAX))

  // compute bpVal ** (id - 8388608)
  const exp: i64 = i64(binId) - REAL_SHIFT
  let result = pow(bpVal, exp)

  // get price in terms of tokenY
  const tokenYDecimals = BigDecimal.fromString(`1e${tokenY.decimals.toI32()}`)
  const tokenXDecimals = BigDecimal.fromString(`1e${tokenX.decimals.toI32()}`)

  return result.times(tokenXDecimals).div(tokenYDecimals)
}
