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

export const WNATIVE_ADDRESS = Address.fromString('{{ wnative_address }}')
export const NATIVE_SYMBOL = '{{ native_symbol }}'
export const NATIVE_NAME = '{{ native_name }}'

export const POOLMANAGER_ADDRESS = Address.fromString('{{ pool_manager_address }}')
export const POSITION_MANAGER_ADDRESS = Address.fromString('{{ position_manager_address }}')
export const MULTICALL3_ADDRESS = Address.fromString('{{ multicall3_address }}')
export const JOE_DEX_LENS_ADDRESS = Address.fromString('{{ joe_dex_lens_address }}')
export const JOE_DEX_LENS_USD_DECIMALS = BigDecimal.fromString('1e{{ joe_dex_lens_usd_decimals }}')
