import {BigInt, Address, Bytes, store, log} from '@graphprotocol/graph-ts'
import {
	LOG_CALL,
	LOG_JOIN,
	LOG_EXIT,
	LOG_SWAP,
	Transfer,
	GulpCall,
	LOG_COLLECTED_FUND, LOG_FINALIZE, Deposit, Withdraw
} from '../types/templates/Pool/Pool'
import {Pool as BPool} from '../types/templates/Pool/Pool'
import {
	Pool,
	PoolToken,
	PoolShare,
	Token
} from '../types/schema'
import {
	hexToDecimal,
	bigIntToDecimal,
	tokenToDecimal,
	createPoolShareEntity,
	createPoolTokenEntity,
	updatePoolLiquidity,
	ZERO_BD, getFactory, ONE_BI, ZERO_BI
} from './helpers'
import {SwapInfo, updateVolumeStats} from "./dayUpdates";

/************************************
 ********** Pool Controls ***********
 ************************************/

export function handleSetSwapFee(event: LOG_CALL): void {
	let poolId = event.address.toHex()
	let pool = Pool.load(poolId)
	let swapFee = hexToDecimal(event.params.data.toHexString().slice(-40), 18)
	pool.swapFee = swapFee
	pool.save()

}

export function handleSetController(event: LOG_CALL): void {
	let poolId = event.address.toHex()
	let pool = Pool.load(poolId)
	let controller = Address.fromString(event.params.data.toHexString().slice(-40))
	pool.controller = controller
	pool.save()

}

export function handleSetPublicSwap(event: LOG_CALL): void {
	let poolId = event.address.toHex()
	let pool = Pool.load(poolId)
	let publicSwap = event.params.data.toHexString().slice(-1) == '1'
	pool.publicSwap = publicSwap
	pool.save()

}

export function handleFaasFinalize(event: LOG_FINALIZE): void {
	let poolId = event.address.toHex()
	let pool = Pool.load(poolId)
	pool.finalized = true
	pool.publicSwap = true
	pool.swapFee
	let bindTokens = event.params.bindTokens;
	let bindDenorms = event.params.bindDenorms;
	let balances = event.params.balances;
	let tokensList: Array<Bytes> = [];
	for (let i = 0; i < bindTokens.length; ++i) {
		let bindToken = bindTokens[i];
		tokensList.push(Bytes.fromHexString(bindToken.toHexString()) as Bytes)

		let poolTokenId = poolId.concat('-').concat(bindToken.toHexString())
		let poolToken = createPoolTokenEntity(poolTokenId, poolId, bindToken.toHexString())
		poolToken.balance = tokenToDecimal(balances[i].toBigDecimal(), poolToken.decimals)
		poolToken.denormWeight = tokenToDecimal(bindDenorms[i].toBigDecimal(), 18)
		poolToken.save()
		pool.totalWeight = pool.totalWeight.plus(poolToken.denormWeight)
	}
	pool.swapFee = tokenToDecimal(event.params.swapFee.toBigDecimal(), 18)
	pool.version = event.params.version.toI32()
	pool.tokensList = tokensList
	pool.tokensCount = BigInt.fromI32(bindTokens.length)
	let factory = getFactory()
	factory.finalizedPoolCount = factory.finalizedPoolCount + 1
	if (pool.version == 2001) {
		factory.finalizedFaasPoolCount = factory.finalizedFaasPoolCount + 1
	}
	factory.save()

	updatePoolLiquidity(pool!)
}

export function handleFinalize(event: LOG_CALL): void {
	let poolId = event.address.toHex()
	let pool = Pool.load(poolId)
	// let balance = BigDecimal.fromString('100')
	pool.finalized = true
	pool.publicSwap = true
	// pool.totalShares = balance
	pool.save()

	/*
	let poolShareId = poolId.concat('-').concat(event.params.caller.toHex())
	let poolShare = PoolShare.load(poolShareId)
	if (poolShare == null) {
		createPoolShareEntity(poolShareId, poolId, event.params.caller.toHex())
		poolShare = PoolShare.load(poolShareId)
	}
	poolShare.balance = balance
	poolShare.save()
	*/

	let factory = getFactory()
	factory.finalizedPoolCount = factory.finalizedPoolCount + 1
	factory.save()

}

export function handleRebind(event: LOG_CALL): void {
	let poolId = event.address.toHex()
	let pool = Pool.load(poolId)
	let tokenBytes = Bytes.fromHexString(event.params.data.toHexString().slice(34, 74)) as Bytes
	let tokensList = pool.tokensList || []
	if (tokensList.indexOf(tokenBytes) == -1) {
		tokensList.push(tokenBytes)
	}
	pool.tokensList = tokensList
	pool.tokensCount = BigInt.fromI32(tokensList.length)

	let address = Address.fromString(event.params.data.toHexString().slice(34, 74))
	let denormWeight = hexToDecimal(event.params.data.toHexString().slice(138), 18)

	let poolTokenId = poolId.concat('-').concat(address.toHexString())
	let poolToken = PoolToken.load(poolTokenId)
	if (poolToken == null) {
		createPoolTokenEntity(poolTokenId, poolId, address.toHexString())
		poolToken = PoolToken.load(poolTokenId)
		pool.totalWeight += denormWeight
	} else {
		let oldWeight = poolToken.denormWeight
		if (denormWeight > oldWeight) {
			pool.totalWeight = pool.totalWeight + (denormWeight - oldWeight)
		} else {
			pool.totalWeight = pool.totalWeight - (oldWeight - denormWeight)
		}
	}

	let balance = hexToDecimal(event.params.data.toHexString().slice(74, 138), poolToken.decimals)

	poolToken.balance = balance
	poolToken.denormWeight = denormWeight
	poolToken.save()

	if (balance.equals(ZERO_BD)) pool.active = false
	pool.save()

	updatePoolLiquidity(pool!)
}

export function handleUnbind(event: LOG_CALL): void {
	let poolId = event.address.toHex()
	let pool = Pool.load(poolId)
	let tokenBytes = Bytes.fromHexString(event.params.data.toHexString().slice(-40)) as Bytes
	let tokensList = pool.tokensList || []
	let index = tokensList.indexOf(tokenBytes)
	tokensList.splice(index, 1)
	pool.tokensList = tokensList
	pool.tokensCount = BigInt.fromI32(tokensList.length)


	let address = Address.fromString(event.params.data.toHexString().slice(-40))
	let poolTokenId = poolId.concat('-').concat(address.toHexString())
	let poolToken = PoolToken.load(poolTokenId)
	// pool.totalWeight -= poolToken.denormWeight
	pool.save()
	store.remove('PoolToken', poolTokenId)

}

export function handleGulp(call: GulpCall): void {
	let poolId = call.to.toHexString()
	let pool = Pool.load(poolId)

	let address = call.inputs.token.toHexString()

	let bpool = BPool.bind(Address.fromString(poolId))
	let balanceCall = bpool.try_getBalance(Address.fromString(address))

	let poolTokenId = poolId.concat('-').concat(address)
	let poolToken = PoolToken.load(poolTokenId)

	if (poolToken != null) {
		let balance = ZERO_BD
		if (!balanceCall.reverted) {
			balance = bigIntToDecimal(balanceCall.value, poolToken.decimals)
		}
		poolToken.balance = balance
		poolToken.save()
	}

	updatePoolLiquidity(pool!)
}

/************************************
 ********** JOINS & EXITS ***********
 ************************************/

export function handleJoinPool(event: LOG_JOIN): void {
	let poolId = event.address.toHex()
	let pool = Pool.load(poolId)
	pool.joinsCount += BigInt.fromI32(1)
	// pool.save()

	let address = event.params.tokenIn.toHex()
	let poolTokenId = poolId.concat('-').concat(address.toString())
	let poolToken = PoolToken.load(poolTokenId)
	let tokenAmountIn = tokenToDecimal(event.params.tokenAmountIn.toBigDecimal(), poolToken.decimals)
	let newAmount = poolToken.balance.plus(tokenAmountIn)
	poolToken.balance = newAmount
	poolToken.save()

	updatePoolLiquidity(pool!)
}

export function handleExitPool(event: LOG_EXIT): void {
	let poolId = event.address.toHex()

	let address = event.params.tokenOut.toHex()
	let poolTokenId = poolId.concat('-').concat(address.toString())
	let poolToken = PoolToken.load(poolTokenId)
	let tokenAmountOut = tokenToDecimal(event.params.tokenAmountOut.toBigDecimal(), poolToken.decimals)
	let newAmount = poolToken.balance.minus(tokenAmountOut)
	poolToken.balance = newAmount
	poolToken.save()

	let pool = Pool.load(poolId)
	pool.exitsCount += BigInt.fromI32(1)
	if (newAmount.equals(ZERO_BD)) pool.active = false
	// pool.save()

	updatePoolLiquidity(pool!)
}

/************************************
 ************** SWAPS ***************
 ************************************/

export function handleSwap(event: LOG_SWAP): void {
	let poolId = event.address.toHex()
	let pool = Pool.load(poolId)

	let tokenInId = event.params.tokenIn.toHex()
	let tokenIn = Token.load(tokenInId)
	let poolTokenInId = poolId.concat('-').concat(tokenInId.toString())
	let poolTokenIn = PoolToken.load(poolTokenInId)
	let tokenAmountIn = tokenToDecimal(event.params.tokenAmountIn.toBigDecimal(), poolTokenIn.decimals)
	let newAmountIn = poolTokenIn.balance.plus(tokenAmountIn)
	poolTokenIn.balance = newAmountIn


	let tokenOutId = event.params.tokenOut.toHex()
	let tokenOut = Token.load(tokenOutId)
	let poolTokenOutId = poolId.concat('-').concat(tokenOutId.toString())
	let poolTokenOut = PoolToken.load(poolTokenOutId)
	let tokenAmountOut = tokenToDecimal(event.params.tokenAmountOut.toBigDecimal(), poolTokenOut.decimals)
	let newAmountOut = poolTokenOut.balance.minus(tokenAmountOut)
	poolTokenOut.balance = newAmountOut

	let totalSwapVolume = pool.totalSwapVolume
	let totalSwapFee = pool.totalSwapFee
	let liquidity = pool.liquidity

	let swapValue = tokenOut.priceUSD.times(tokenAmountOut)
	let swapFeeValue = swapValue.times(pool.swapFee)
	totalSwapVolume = totalSwapVolume.plus(swapValue)
	totalSwapFee = totalSwapFee.plus(swapFeeValue)

	tokenIn.tradeVolume = tokenIn.tradeVolume.plus(tokenAmountIn)
	let tokenAmountInUSD = tokenAmountIn.times(tokenIn.priceUSD);
	tokenIn.tradeVolumeUSD = tokenIn.tradeVolumeUSD.plus(tokenAmountInUSD)

	tokenOut.tradeVolume = tokenOut.tradeVolume.plus(tokenAmountOut)
	let tokenAmountOutUSD = tokenAmountOut.times(tokenOut.priceUSD);
	tokenOut.tradeVolumeUSD = tokenOut.tradeVolumeUSD.plus(tokenAmountOutUSD)


	poolTokenIn.volume = poolTokenIn.volume.plus(tokenAmountIn)
	poolTokenIn.volumeUSD = poolTokenIn.volumeUSD.plus(tokenAmountInUSD)

	poolTokenOut.volume = poolTokenOut.volume.plus(tokenAmountOut)
	poolTokenOut.volumeUSD = poolTokenOut.volumeUSD.plus(tokenAmountOutUSD)

	tokenIn.txCount = tokenIn.txCount.plus(ONE_BI)
	tokenOut.txCount = tokenOut.txCount.plus(ONE_BI)
	tokenIn.save()
	tokenOut.save()
	poolTokenIn.save()
	poolTokenOut.save()
	pool.totalSwapVolume = totalSwapVolume
	pool.totalSwapFee = totalSwapFee


	pool.swapsCount += BigInt.fromI32(1)
	if (newAmountIn.equals(ZERO_BD) || newAmountOut.equals(ZERO_BD)) {
		pool.active = false
	}
	updatePoolLiquidity(pool!)
	updateVolumeStats(pool!, new SwapInfo(event, swapValue, swapFeeValue))
}

/************************************
 *********** POOL SHARES ************
 ************************************/

export function handleTransfer(event: Transfer): void {
	let poolId = event.address.toHex()

	let ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

	let isMint = event.params.src.toHex() == ZERO_ADDRESS
	let isBurn = event.params.dst.toHex() == ZERO_ADDRESS

	let poolShareFromId = poolId.concat('-').concat(event.params.src.toHex())
	let poolShareFrom = PoolShare.load(poolShareFromId)
	let poolShareFromBalance = poolShareFrom == null ? ZERO_BD : poolShareFrom.totalBalance

	let poolShareToId = poolId.concat('-').concat(event.params.dst.toHex())
	let poolShareTo = PoolShare.load(poolShareToId)
	let poolShareToBalance = poolShareTo == null ? ZERO_BD : poolShareTo.totalBalance

	let pool = Pool.load(poolId)

	let poolShareAmount = tokenToDecimal(event.params.amt.toBigDecimal(), 18);
	if (isMint) {
		if (poolShareTo == null) {
			createPoolShareEntity(poolShareToId, poolId, event.params.dst.toHex())
			poolShareTo = PoolShare.load(poolShareToId)
		}
		poolShareTo.balance += poolShareAmount
		poolShareTo.totalBalance += poolShareAmount
		poolShareTo.save()
		pool.totalShares += poolShareAmount
	} else if (isBurn) {
		if (poolShareFrom == null) {
			createPoolShareEntity(poolShareFromId, poolId, event.params.src.toHex())
			poolShareFrom = PoolShare.load(poolShareFromId)
		}
		poolShareFrom.balance -= poolShareAmount
		poolShareFrom.totalBalance -= poolShareAmount
		if (poolShareFrom.totalBalance.le(ZERO_BD)) {
			store.remove('PoolShare', poolShareFrom.id)
		} else {
			poolShareFrom.save()
		}
		pool.totalShares -= poolShareAmount
	} else {
		if (poolShareTo == null) {
			createPoolShareEntity(poolShareToId, poolId, event.params.dst.toHex())
			poolShareTo = PoolShare.load(poolShareToId)
		}
		poolShareTo.balance += poolShareAmount
		poolShareTo.totalBalance += poolShareAmount
		poolShareTo.save()

		if (poolShareFrom == null) {
			createPoolShareEntity(poolShareFromId, poolId, event.params.src.toHex())
			poolShareFrom = PoolShare.load(poolShareFromId)
		}
		poolShareFrom.balance -= poolShareAmount
		poolShareFrom.totalBalance -= poolShareAmount
		if (poolShareFrom.totalBalance.le(ZERO_BD)) {
			store.remove('PoolShare', poolShareFrom.id)
		} else {
			poolShareFrom.save()
		}
	}

	if (
		poolShareTo !== null
		&& poolShareTo.totalBalance.notEqual(ZERO_BD)
		&& poolShareToBalance.equals(ZERO_BD)
	) {
		pool.holdersCount += BigInt.fromI32(1)
	}

	if (
		poolShareFrom !== null
		&& poolShareFrom.totalBalance.equals(ZERO_BD)
		&& poolShareFromBalance.notEqual(ZERO_BD)
	) {
		pool.holdersCount -= BigInt.fromI32(1)
	}

	pool.save()
}

export function handleLogCollectedFund(event: LOG_COLLECTED_FUND): void {
	let poolId = event.address.toHex()
	let tokenId = event.params.collectedToken.toHex()
	let poolTokenId = poolId.concat('-').concat(tokenId.toString())
	let poolToken = PoolToken.load(poolTokenId)
	if (poolToken == null) {
		return
	}

	let bpool = BPool.bind(Address.fromString(poolId))
	let balanceCall = bpool.try_getBalance(Address.fromString(tokenId));

	let balance = ZERO_BD
	if (!balanceCall.reverted) {
		balance = bigIntToDecimal(balanceCall.value, poolToken.decimals)
	}
	poolToken.balance = balance
	poolToken.save()

	let collectedFundAmount = tokenToDecimal(event.params.collectedAmount.toBigDecimal(), poolToken.decimals)

	let token = Token.load(tokenId)
	if (token == null) {
		return;
	}

	let factory = getFactory()
	let collectedFundUSD = token.priceUSD.times(collectedFundAmount)
	factory.totalCollectedFund = factory.totalCollectedFund.plus(collectedFundUSD)
	factory.save()
	token.collectedFundToken = token.collectedFundToken.plus(collectedFundAmount)
	token.collectedFundTokenUSD = token.collectedFundTokenUSD.plus(collectedFundUSD)
}

export function handleDeposit(event: Deposit): void {
	let poolId = event.address.toHex()


	let account = event.params.account.toHex();
	let poolShareId = poolId.concat('-').concat(account)
	let poolShare = PoolShare.load(poolShareId)

	if (poolShare == null) {
		createPoolShareEntity(poolShareId, poolId, account)
		poolShare = PoolShare.load(poolShareId)
	}
	let amount = tokenToDecimal(event.params.amount.toBigDecimal(), 18);
	poolShare.stakeBalance = poolShare.stakeBalance.plus(amount)
	poolShare.totalBalance = poolShare.totalBalance.plus(amount)
	poolShare.save();
}

export function handleWithdraw(event: Withdraw): void {
	let poolId = event.address.toHex()
	let account = event.params.account.toHex();
	let poolShareId = poolId.concat('-').concat(account)
	let poolShare = PoolShare.load(poolShareId)
	if (poolShare == null) {
		createPoolShareEntity(poolShareId, poolId, account)
		poolShare = PoolShare.load(poolShareId)
	}
	let amount = tokenToDecimal(event.params.amount.toBigDecimal(), 18);
	poolShare.stakeBalance = poolShare.stakeBalance.minus(amount)
	poolShare.totalBalance = poolShare.totalBalance.minus(amount)
	poolShare.save()
}