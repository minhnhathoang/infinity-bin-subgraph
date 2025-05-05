import { Address, BigDecimal, log, BigInt } from "@graphprotocol/graph-ts";
import {
  TransferBatch,
} from "../generated/PositionManager/PositionManager";
import {
  LBPair,
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
  removeLiquidityPosition,
  loadTransaction,
  trackBin,
} from "./entities";
import {
  BIG_INT_ONE,
  BIG_DECIMAL_ZERO,
  BIG_INT_ZERO,
  ADDRESS_ZERO,
} from "./constants";
import {
  formatTokenAmountByDecimals,
  getTrackedLiquidityUSD,
  getTrackedVolumeUSD,
  updateNativeInUsdPricing,
  updateTokensDerivedNative,
  safeDiv,
} from "./utils";

export function handleTransferBatch(event: TransferBatch): void {
  const lbPair = loadLbPair(event.address.toHexString());
  if (!lbPair) {
    return;
  }

  lbPair.txCount = lbPair.txCount.plus(BIG_INT_ONE);
  lbPair.save();

  const poolManager = loadPoolManager();
  poolManager.txCount = poolManager.txCount.plus(BIG_INT_ONE);
  poolManager.save();

  loadTraderJoeHourData(event.block.timestamp, true);
  loadTraderJoeDayData(event.block.timestamp, true);
  loadLBPairDayData(event.block.timestamp, lbPair as LBPair, true);
  loadLBPairHourData(event.block.timestamp, lbPair as LBPair, true);

  const transaction = loadTransaction(event);

  for (let i = 0; i < event.params.amounts.length; i++) {
    removeLiquidityPosition(
      event.address,
      event.params.from,
      event.params.ids[i],
      event.params.amounts[i],
      event.block
    );
    addLiquidityPosition(
      event.address,
      event.params.to,
      event.params.ids[i],
      event.params.amounts[i],
      event.block
    );

    const isMint = ADDRESS_ZERO.equals(event.params.from);
    const isBurn = ADDRESS_ZERO.equals(event.params.to);

    // mint: increase bin totalSupply
    if (isMint) {
      trackBin(
        lbPair,
        event.params.ids[i].toU32(),
        BIG_DECIMAL_ZERO,
        BIG_DECIMAL_ZERO,
        BIG_DECIMAL_ZERO,
        BIG_DECIMAL_ZERO,
        event.params.amounts[i], // minted
        BIG_INT_ZERO
      );
    }

    // burn: decrease bin totalSupply
    if (isBurn) {
      trackBin(
        lbPair,
        event.params.ids[i].toU32(),
        BIG_DECIMAL_ZERO,
        BIG_DECIMAL_ZERO,
        BIG_DECIMAL_ZERO,
        BIG_DECIMAL_ZERO,
        BIG_INT_ZERO,
        event.params.amounts[i] // burned
      );
    }

    const transfer = new Transfer(
      transaction.id
        .concat("#")
        .concat(lbPair.txCount.toString())
        .concat("#")
        .concat(i.toString())
    );
    transfer.transaction = transaction.id;
    transfer.timestamp = event.block.timestamp.toI32();
    transfer.lbPair = lbPair.id;
    transfer.isBatch = true;
    transfer.batchIndex = i;
    transfer.isMint = isMint;
    transfer.isBurn = isBurn;
    transfer.binId = event.params.ids[i];
    transfer.amount = event.params.amounts[i];
    transfer.sender = event.params.sender;
    transfer.from = event.params.from;
    transfer.to = event.params.to;
    transfer.origin = event.transaction.from;
    transfer.logIndex = event.logIndex;

    transfer.save();
  }
}

