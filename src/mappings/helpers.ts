import {
	BigDecimal,
	Address,
	BigInt,
	Bytes,
	dataSource,
	ethereum
} from '@graphprotocol/graph-ts'
import {
	Pool,
	User,
	PoolToken,
	PoolShare,
	Token,
	Balancer
} from '../types/schema'
import {BTokenBytes} from '../types/templates/Pool/BTokenBytes'
import {BToken} from '../types/templates/Pool/BToken'

export let ZERO_BD = BigDecimal.fromString('0')
export let ZERO_BI = BigInt.fromI32(0)
export let ONE_BI = BigInt.fromI32(1)
export let ONE_BD = BigDecimal.fromString('1')
export let BI_18 = BigInt.fromI32(18)
let network = dataSource.network()

export let WETH: string = (network == 'mainnet')
	? '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
	: '0xd0a1e359811322d97991e03f863a0c30c2cf029c'
export let VALUE: string = (network == 'mainnet')
	? '0x49e833337ece7afe375e44f4e3e8481029218e5c'
	: '0x49e833337ece7afe375e44f4e3e8481029218e5c'
export let USD: string = (network == 'mainnet')
	? '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' // USDC
	: '0x1528f3fcc26d13f7079325fb78d9442607781c8c' // DAI

export let DAI: string = (network == 'mainnet')
	? '0x6b175474e89094c44da98b954eedeac495271d0f' // DAI
	: '0x1528f3fcc26d13f7079325fb78d9442607781c8c' // DAI

export function getFactory(): Balancer | null {
	return Balancer.load('1')
}

export function hexToDecimal(hexString: string, decimals: i32): BigDecimal {
	let bytes = Bytes.fromHexString(hexString).reverse() as Bytes
	let bi = BigInt.fromUnsignedBytes(bytes)
	let scale = BigInt.fromI32(10).pow(decimals as u8).toBigDecimal()
	return bi.divDecimal(scale)
}

export function bigIntToDecimal(amount: BigInt, decimals: i32): BigDecimal {
	let scale = BigInt.fromI32(10).pow(decimals as u8).toBigDecimal()
	return amount.toBigDecimal().div(scale)
}

export function maxBigDecimal(o1: BigDecimal, o2: BigDecimal): BigDecimal {
	return o1.gt(o2) ? o1 : o2
}

export function maxBigInt(o1: BigInt, o2: BigInt): BigInt {
	return o1.gt(o2) ? o1 : o2
}

export function minBigDecimal(o1: BigDecimal, o2: BigDecimal): BigDecimal {
	return o1.lt(o2) ? o1 : o2
}

export function minBigInt(o1: BigInt, o2: BigInt): BigInt {
	return o1.lt(o2) ? o1 : o2
}

export function tokenToDecimal(amount: BigDecimal, decimals: i32): BigDecimal {
	let scale = BigInt.fromI32(10).pow(decimals as u8).toBigDecimal()
	return amount.div(scale)
}

export function createPoolShareEntity(id: string, pool: string, user: string): void {
	let poolShare = new PoolShare(id)

	createUserEntity(user)

	poolShare.userAddress = user
	poolShare.poolId = pool
	poolShare.balance = ZERO_BD
	poolShare.stakeBalance = ZERO_BD
	poolShare.totalBalance = ZERO_BD
	poolShare.save()
}

export function createPoolTokenEntity(id: string, pool: string, address: string): PoolToken {
	let tokenContract = BToken.bind(Address.fromString(address))
	let tokenBytes = BTokenBytes.bind(Address.fromString(address))
	let symbol = ''
	let name = ''
	let decimals = 18

	// COMMENT THE LINES BELOW OUT FOR LOCAL DEV ON KOVAN

	let symbolCall = tokenContract.try_symbol()
	let nameCall = tokenContract.try_name()
	let decimalCall = tokenContract.try_decimals()

	if (symbolCall.reverted) {
		let symbolBytesCall = tokenBytes.try_symbol()
		if (!symbolBytesCall.reverted) {
			symbol = symbolBytesCall.value.toString()
		}
	} else {
		symbol = symbolCall.value
	}

	if (nameCall.reverted) {
		let nameBytesCall = tokenBytes.try_name()
		if (!nameBytesCall.reverted) {
			name = nameBytesCall.value.toString()
		}
	} else {
		name = nameCall.value
	}

	if (!decimalCall.reverted) {
		decimals = decimalCall.value
	}

	// COMMENT THE LINES ABOVE OUT FOR LOCAL DEV ON KOVAN

	// !!! COMMENT THE LINES BELOW OUT FOR NON-LOCAL DEPLOYMENT
	// This code allows Symbols to be added when testing on local Kovan
	/*
	if(address == '0xd0a1e359811322d97991e03f863a0c30c2cf029c')
		symbol = 'WETH';
	else if(address == '0x1528f3fcc26d13f7079325fb78d9442607781c8c')
		symbol = 'DAI'
	else if(address == '0xef13c0c8abcaf5767160018d268f9697ae4f5375')
		symbol = 'MKR'
	else if(address == '0x2f375e94fc336cdec2dc0ccb5277fe59cbf1cae5')
		symbol = 'USDC'
	else if(address == '0x1f1f156e0317167c11aa412e3d1435ea29dc3cce')
		symbol = 'BAT'
	else if(address == '0x86436bce20258a6dcfe48c9512d4d49a30c4d8c4')
		symbol = 'SNX'
	else if(address == '0x8c9e6c40d3402480ace624730524facc5482798c')
		symbol = 'REP'
	*/
	// !!! COMMENT THE LINES ABOVE OUT FOR NON-LOCAL DEPLOYMENT
	let token = Token.load(address);
	if (token == null) {
		token = new Token(address)
		token.name = name
		token.symbol = symbol
		token.decimals = decimals
		token.poolTokenId = ''
		token.priceUSD = address === USD || address == DAI ? ONE_BD : ZERO_BD
		token.poolLiquidity = ZERO_BD
		token.totalLiquidity = ZERO_BD
		token.tradeVolume = ZERO_BD
		token.tradeVolumeUSD = ZERO_BD
		token.collectedFundToken = ZERO_BD
		token.collectedFundTokenUSD = ZERO_BD
		token.txCount = ZERO_BI
		token.save()
	}
	let poolToken = new PoolToken(id)
	poolToken.poolId = pool
	poolToken.address = address
	poolToken.name = name
	poolToken.symbol = symbol
	poolToken.decimals = decimals
	poolToken.priceUSD = token.priceUSD
	poolToken.balance = ZERO_BD
	poolToken.denormWeight = ZERO_BD
	poolToken.volume = ZERO_BD
	poolToken.reserveUSD = ZERO_BD
	poolToken.volumeUSD = ZERO_BD
	poolToken.save()
	return poolToken

}

export function updatePoolLiquidity(pool: Pool): void {
	if (pool == null) {
		throw new Error("Pool must be not null")
	}
	let id = pool.id
	// let pool = Pool.load(id)
	let tokensList: Array<Bytes> = pool.tokensList

	if (!tokensList || pool.tokensCount.lt(BigInt.fromI32(2)) || !pool.publicSwap) return

	// Find pool liquidity

	let hasPrice = false
	let hasUsdPrice = false
	let poolLiquidity = ZERO_BD

	if (tokensList.includes(Address.fromString(USD))) {
		let usdPoolTokenId = id.concat('-').concat(USD)
		let usdPoolToken = PoolToken.load(usdPoolTokenId)
		poolLiquidity = usdPoolToken.balance.div(usdPoolToken.denormWeight).times(pool.totalWeight)
		hasPrice = true
		hasUsdPrice = true
	} else if (tokensList.includes(Address.fromString(DAI))) {
		let usdPoolTokenId = id.concat('-').concat(DAI)
		let usdPoolToken = PoolToken.load(usdPoolTokenId)
		poolLiquidity = usdPoolToken.balance.div(usdPoolToken.denormWeight).times(pool.totalWeight)
		hasPrice = true
		hasUsdPrice = true
	} else if (tokensList.includes(Address.fromString(VALUE))) {
		let valueToken = Token.load(VALUE)
		if (valueToken !== null && valueToken.priceUSD.gt(ZERO_BD)) {
			let poolTokenId = id.concat('-').concat(VALUE)
			let poolToken = PoolToken.load(poolTokenId)
			poolLiquidity = valueToken.priceUSD.times(poolToken.balance).div(poolToken.denormWeight).times(pool.totalWeight)
			hasPrice = true
		}
	} else if (tokensList.includes(Address.fromString(WETH))) {
		let wethToken = Token.load(WETH)
		if (wethToken !== null && wethToken.priceUSD.gt(ZERO_BD)) {
			let poolTokenId = id.concat('-').concat(WETH)
			let poolToken = PoolToken.load(poolTokenId)
			poolLiquidity = wethToken.priceUSD.times(poolToken.balance).div(poolToken.denormWeight).times(pool.totalWeight)
			hasPrice = true
		}
	}

	// Create or update token price
	let liquidity = ZERO_BD
	let denormWeight = ZERO_BD

	let poolTokens: Array<PoolToken> = [];
	let tokens: Array<Token> = [];
	for (let i: i32 = 0; i < tokensList.length; i++) {
		let tokenId = tokensList[i].toHexString()
		let token = Token.load(tokenId)
		let poolTokenId = id.concat('-').concat(tokenId)
		let poolToken = PoolToken.load(poolTokenId)
		if (hasPrice) {
			if (
				(token.poolTokenId == poolTokenId || poolLiquidity.gt(token.poolLiquidity)) &&
				(tokenId != VALUE.toString() || (pool.tokensCount.equals(BigInt.fromI32(2)) && hasUsdPrice))
			) {
				if (poolToken.balance.gt(ZERO_BD)) {
					token.priceUSD = poolLiquidity.div(pool.totalWeight).times(poolToken.denormWeight).div(poolToken.balance)
				}
				token.poolLiquidity = poolLiquidity
				token.poolTokenId = poolTokenId
			}
		}
		if (poolToken.denormWeight.gt(denormWeight) && token.priceUSD.gt(ZERO_BD)) {
			denormWeight = poolToken.denormWeight
			liquidity = token.priceUSD.times(poolToken.balance).div(poolToken.denormWeight).times(pool.totalWeight)
		}
		poolTokens.push(poolToken!)
		tokens.push(token!)
	}
	for (let i = 0; i < poolTokens.length; i++) {
		let poolToken = poolTokens[i]
		let token = tokens[i]
		let reserveUsd = liquidity.div(pool.totalWeight).times(poolToken.denormWeight)
		token.totalLiquidity = token.totalLiquidity.minus(poolToken.reserveUSD).plus(reserveUsd)
		poolToken.reserveUSD = reserveUsd
		if (poolToken.balance.gt(ZERO_BD)) {
			poolToken.priceUSD = reserveUsd.div(poolToken.balance)
			if (token.priceUSD.equals(ZERO_BD)) {
				token.priceUSD = poolToken.priceUSD
				token.poolLiquidity = reserveUsd
				token.poolTokenId = poolToken.poolId
			}
		}
		token.save()
		poolToken.save()
	}
	let factory = getFactory()
	factory.totalLiquidity = factory.totalLiquidity.minus(pool.liquidity).plus(liquidity)
	if (pool.version == 2001) {
		factory.totalFaasLiquidity = factory.totalFaasLiquidity.minus(pool.liquidity).plus(liquidity)
	}
	factory.txCount = factory.txCount.plus(ONE_BI)
	factory.save()
	pool.liquidity = liquidity
	pool.save()
}

export function createUserEntity(address: string): void {
	if (User.load(address) == null) {
		let user = new User(address)
		user.save()
	}
}