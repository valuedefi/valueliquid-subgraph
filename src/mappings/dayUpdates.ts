import {BigDecimal, ethereum} from '@graphprotocol/graph-ts'
import {
	Pool,
} from '../types/schema'
import {getFactory} from './helpers'

export class SwapInfo {
	constructor(public readonly event: ethereum.Event,
							public readonly swapValue: BigDecimal,
							public swapFeeValue: BigDecimal) {
	}
}

export function updateVolumeStats(pool: Pool, swapStat: SwapInfo): void {
	let factory = getFactory()
	factory.totalSwapVolume = factory.totalSwapVolume.plus(swapStat.swapValue)
	factory.totalSwapFee = factory.totalSwapFee.plus(swapStat.swapFeeValue)
	factory.save()
}
