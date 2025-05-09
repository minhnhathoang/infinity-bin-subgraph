import {Address, BigDecimal, BigInt} from '@graphprotocol/graph-ts'

export const ADDRESS_ZERO = Address.fromString(
  '0x0000000000000000000000000000000000000000',
)

export const BIG_DECIMAL_1E4 = BigDecimal.fromString('1e4')
export const BIG_DECIMAL_1E10 = BigDecimal.fromString('1e10')
export const BIG_DECIMAL_1E18 = BigDecimal.fromString('1e18')
export const BIG_DECIMAL_ZERO = BigDecimal.fromString('0')
export const BIG_DECIMAL_ONE = BigDecimal.fromString('1')
export const BIG_DECIMAL_HUNDRED = BigDecimal.fromString('100')

export const BIG_INT_1E4 = BigInt.fromI32(1000)
export const BIG_INT_ONE = BigInt.fromI32(1)
export const BIG_INT_ZERO = BigInt.fromI32(0)
export const NULL_CALL_RESULT_VALUE =
  '0x0000000000000000000000000000000000000000000000000000000000000001'

export const WNATIVE_ADDRESS = Address.fromString('0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c')
export const NATIVE_SYMBOL = 'BNB'
export const NATIVE_NAME = 'Binance Coin'

export const POOLMANAGER_ADDRESS = Address.fromString('0xC697d2898e0D09264376196696c51D7aBbbAA4a9')
export const MULTICALL3_ADDRESS = Address.fromString('0xcA11bde05977b3631167028862bE2a173976CA11')
export const JOE_DEX_LENS_ADDRESS = Address.fromString('0x0A5077D8dc51e27Ad536847b0CF558165BA9AD1b')
export const JOE_DEX_LENS_USD_DECIMALS = BigDecimal.fromString('1e18')
