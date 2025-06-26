import {TransferBatch} from '../generated/PositionManager/PositionManager'
import {LBPair, Transfer} from '../generated/schema'
import {ADDRESS_ZERO, BIG_INT_ONE, MULTICALL3_ADDRESS, POOLMANAGER_ADDRESS, POSITION_MANAGER_ADDRESS} from './constants'
import {
  addLiquidityPosition,
  loadLbPair,
  loadLBPairDayData,
  loadLBPairHourData,
  loadPoolManager,
  loadTraderJoeDayData,
  loadTraderJoeHourData,
  loadTransaction,
  removeLiquidityPosition,
} from './entities'
import {Address, Bytes, ethereum, log} from "@graphprotocol/graph-ts";

class Multicall3 extends ethereum.SmartContract {
  static bind(address: Address): Multicall3 {
    return new Multicall3('Multicall3', address)
  }

  try_aggregate(
    calls: Array<ethereum.Tuple>,
  ): ethereum.CallResult<Array<ethereum.Value>> {
    return super.tryCall(
      'aggregate',
      'aggregate((address,bytes)[]):(uint256,bytes[])',
      [ethereum.Value.fromTupleArray(calls)],
    )
  }
}

const multicall3 = Multicall3.bind(MULTICALL3_ADDRESS)
const getPositionsSelector = Bytes.fromHexString('0x99fbab88')

export function handleTransferBatch(event: TransferBatch): void {
  const lbPair = loadLbPair(event.address.toHexString())
  if (!lbPair) {
    return
  }

  lbPair.txCount = lbPair.txCount.plus(BIG_INT_ONE)
  lbPair.save()

  const poolManager = loadPoolManager()
  poolManager.txCount = poolManager.txCount.plus(BIG_INT_ONE)
  poolManager.save()

  loadTraderJoeHourData(event.block.timestamp, true)
  loadTraderJoeDayData(event.block.timestamp, true)
  loadLBPairDayData(event.block.timestamp, lbPair as LBPair, true)
  loadLBPairHourData(event.block.timestamp, lbPair as LBPair, true)

  const transaction = loadTransaction(event)

  const calls = new Array<ethereum.Tuple>(event.params.ids.length)
  for (let i = 0; i < calls.length; i++) {
    calls[i] = changetype<ethereum.Tuple>([
      ethereum.Value.fromAddress(POSITION_MANAGER_ADDRESS),
      ethereum.Value.fromBytes(
        getPositionsSelector.concat(ethereum.encode(ethereum.Value.fromUnsignedBigInt(event.params.ids[i]))!),
      ),
    ])
  }
  const multicallResult = multicall3.try_aggregate(calls)

  if (multicallResult.reverted) {
    log.error("[handleTransferBatch] multicall3 reverted", [])
    return
  }

  const positionResults = multicallResult.value[1].toBytesArray()

  for (let i = 0; i < event.params.amounts.length; i++) {
    let positionResult = positionResults[i]
    const decoded = ethereum.decode('(tuple(address,address,address,address,uint24,bytes32),uint24)', positionResult)
    if (decoded === null) {
      log.error("[handleTransferBatch] decoded is null for position: {}", [positionResult.toHexString()])
      continue
    }

    let binId = decoded.toTuple()[1].toBigInt()

    removeLiquidityPosition(
      event.address,
      event.params.from,
      binId,
      event.params.amounts[i],
      event.block,
    )
    addLiquidityPosition(
      event.address,
      event.params.to,
      binId,
      event.params.amounts[i],
      event.block,
    )

    const isMint = ADDRESS_ZERO.equals(event.params.from)
    const isBurn = ADDRESS_ZERO.equals(event.params.to)

    const transfer = new Transfer(
      transaction.id
        .concat('#')
        .concat(lbPair.txCount.toString())
        .concat('#')
        .concat(i.toString()),
    )
    transfer.transaction = transaction.id
    transfer.timestamp = event.block.timestamp.toI32()
    transfer.lbPair = lbPair.id
    transfer.isBatch = true
    transfer.batchIndex = i
    transfer.isMint = isMint
    transfer.isBurn = isBurn
    transfer.binId = binId
    transfer.amount = event.params.amounts[i]
    transfer.sender = event.params.sender
    transfer.from = event.params.from
    transfer.to = event.params.to
    transfer.origin = event.transaction.from
    transfer.logIndex = event.logIndex

    transfer.save()
  }
}
