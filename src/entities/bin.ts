import {Address, BigDecimal, BigInt, Bytes, ethereum, log} from '@graphprotocol/graph-ts'
import {Bin, LBPair} from '../../generated/schema'
import {BIG_DECIMAL_ONE, BIG_DECIMAL_ZERO, BIG_INT_ZERO, MULTICALL3_ADDRESS, POOLMANAGER_ADDRESS} from '../constants'
import {formatTokenAmountByDecimals, getPriceYOfBin} from '../utils'
import {loadToken} from './token'

export function loadBin(lbPair: LBPair, binId: i32): Bin {
  const id = lbPair.id.concat('#').concat(binId.toString())
  let bin = Bin.load(id)

  if (!bin) {
    const tokenX = loadToken(Address.fromString(lbPair.tokenX))
    const tokenY = loadToken(Address.fromString(lbPair.tokenY))

    bin = new Bin(id)
    bin.lbPair = lbPair.id
    bin.binId = binId as u32
    bin.reserveX = BIG_DECIMAL_ZERO
    bin.reserveY = BIG_DECIMAL_ZERO
    bin.liquidity = BIG_INT_ZERO
    bin.totalSupply = BIG_INT_ZERO
    bin.priceY = getPriceYOfBin(binId, lbPair.binStep, tokenX, tokenY) // each bin has a determined price
    bin.priceX = BIG_DECIMAL_ONE.div(bin.priceY)
    bin.liquidityProviders = []
    bin.liquidityProviderCount = BIG_INT_ZERO
  }

  return bin
}

export function trackBin(
  lbPair: LBPair,
  binId: i32,
  amountXIn: BigDecimal,
  amountXOut: BigDecimal,
  amountYIn: BigDecimal,
  amountYOut: BigDecimal,
  minted: BigInt,
  burned: BigInt,
): Bin {
  const bin = loadBin(lbPair, binId)

  bin.totalSupply = bin.totalSupply.plus(minted).minus(burned)
  bin.reserveX = bin.reserveX.plus(amountXIn).minus(amountXOut)
  bin.reserveY = bin.reserveY.plus(amountYIn).minus(amountYOut)
  bin.save()

  return bin as Bin
}

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
const getBinSelector = Bytes.fromHexString('0x4580c3c5') // getBin(bytes32,uint24)

export function trackBins(
  lbPair: LBPair,
  fromBinId: i32,
  toBinId: i32,
  tokenXDecimals: BigInt,
  tokenYDecimals: BigInt,
): void {
  if (fromBinId > toBinId) {
    let tmp = fromBinId
    fromBinId = toBinId
    toBinId = tmp
  }

  log.info("[trackBins] batch call fromBinId: {}, toBinId: {}, length: {}", [fromBinId.toString(), toBinId.toString(), (toBinId - fromBinId + 1).toString()])
  const calls = new Array<ethereum.Tuple>(toBinId - fromBinId + 1)
  for (let i = 0; i < calls.length; i++) {
    calls[i] = changetype<ethereum.Tuple>([
      ethereum.Value.fromAddress(POOLMANAGER_ADDRESS),
      ethereum.Value.fromBytes(
        getBinSelector.concat(ethereum.encode(ethereum.Value.fromTuple(changetype<ethereum.Tuple>([
          ethereum.Value.fromFixedBytes(Bytes.fromHexString(lbPair.id)),
          ethereum.Value.fromI32(fromBinId + i),
        ])))!),
      ),
    ])
  }
  const multicallResult = multicall3.try_aggregate(calls)

  if (multicallResult.reverted) {
    return
  }

  const binResults = multicallResult.value[1].toBytesArray()
  for (let i = 0; i < binResults.length; i++) {
    const binResult = binResults[i]
    const decoded = ethereum.decode('(uint128,uint128,uint256,uint256)', binResult)
    if (decoded === null) { continue }
    const tuple = decoded.toTuple()
    const binId = fromBinId + i
    const bin = loadBin(lbPair, binId)
    bin.reserveX = formatTokenAmountByDecimals(tuple[0].toBigInt(), tokenXDecimals)
    bin.reserveY = formatTokenAmountByDecimals(tuple[1].toBigInt(), tokenYDecimals)
    bin.liquidity = tuple[2].toBigInt()
    bin.totalSupply = tuple[3].toBigInt()
    bin.save()
  }
}
