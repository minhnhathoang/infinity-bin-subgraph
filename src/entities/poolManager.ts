import {Address} from '@graphprotocol/graph-ts'
import {PoolManager} from '../../generated/schema'
import {BIG_INT_ZERO, POOLMANAGER_ADDRESS} from '../constants'

export function loadPoolManager(id: Address = POOLMANAGER_ADDRESS): PoolManager {
  let poolManager = PoolManager.load(id.toHexString())

  if (!poolManager) {
    poolManager = new PoolManager(id.toHexString())
    poolManager.pairCount = BIG_INT_ZERO
    poolManager.txCount = BIG_INT_ZERO
    poolManager.tokenCount = BIG_INT_ZERO

    poolManager.save()
  }

  return poolManager as PoolManager
}
