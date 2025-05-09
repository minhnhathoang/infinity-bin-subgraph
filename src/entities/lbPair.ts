import {BigInt, Bytes, ethereum} from '@graphprotocol/graph-ts'
import {Initialize__Params} from '../../generated/PoolManager/PoolManager'
import {LBPair} from '../../generated/schema'
import {BIG_DECIMAL_1E4, BIG_DECIMAL_ZERO, BIG_INT_ZERO, POOLMANAGER_ADDRESS} from '../constants'
import {decodeBinStep} from '../utils'
import {trackBin} from './bin'
import {loadToken} from './token'

export function loadLbPair(id: string): LBPair | null {
  const lbPair = LBPair.load(id)
  return lbPair
}

// should only be used when Initialize event is detected
export function createLBPair(
  initialize: Initialize__Params,
  block: ethereum.Block,
): LBPair | null {
  const tokenX = loadToken(initialize.currency0)
  const tokenY = loadToken(initialize.currency1)

  const lbPair = new LBPair(initialize.id.toHexString())

  lbPair.factory = POOLMANAGER_ADDRESS.toHexString()
  lbPair.name = tokenX.symbol
    .concat('-')
    .concat(tokenY.symbol)
  lbPair.tokenX = tokenX.id
  lbPair.tokenY = tokenY.id
  lbPair.hooks = initialize.hooks.toHexString()
  lbPair.parameters = initialize.parameters
  lbPair.hooksRegistration = Bytes.fromUint8Array(initialize.parameters.slice(30, 32))
  lbPair.binStep = decodeBinStep(initialize.parameters)
  lbPair.activeId = initialize.activeId
  lbPair.baseFeePct = BigInt.fromI32(initialize.fee).toBigDecimal().div(BIG_DECIMAL_1E4)

  lbPair.reserveX = BIG_DECIMAL_ZERO
  lbPair.reserveY = BIG_DECIMAL_ZERO
  lbPair.totalValueLockedNative = BIG_DECIMAL_ZERO
  lbPair.totalValueLockedUSD = BIG_DECIMAL_ZERO
  lbPair.tokenXPrice = BIG_DECIMAL_ZERO
  lbPair.tokenYPrice = BIG_DECIMAL_ZERO
  lbPair.tokenXPriceUSD = BIG_DECIMAL_ZERO
  lbPair.tokenYPriceUSD = BIG_DECIMAL_ZERO
  lbPair.volumeTokenX = BIG_DECIMAL_ZERO
  lbPair.volumeTokenY = BIG_DECIMAL_ZERO
  lbPair.volumeUSD = BIG_DECIMAL_ZERO
  lbPair.untrackedVolumeUSD = BIG_DECIMAL_ZERO
  lbPair.txCount = BIG_INT_ZERO
  lbPair.feesTokenX = BIG_DECIMAL_ZERO
  lbPair.feesTokenY = BIG_DECIMAL_ZERO
  lbPair.feesUSD = BIG_DECIMAL_ZERO
  lbPair.liquidityProviderCount = BIG_INT_ZERO

  lbPair.timestamp = block.timestamp
  lbPair.block = block.number

  // generate Bin
  trackBin(
    lbPair,
    initialize.activeId,
    BIG_DECIMAL_ZERO,
    BIG_DECIMAL_ZERO,
    BIG_DECIMAL_ZERO,
    BIG_DECIMAL_ZERO,
    BIG_INT_ZERO,
    BIG_INT_ZERO,
  )

  lbPair.save()

  return lbPair as LBPair
}
