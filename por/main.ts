import {
	bytesToHex,
	ConsensusAggregationByFields,
	type CronPayload,
	handler,
	CronCapability,
	EVMClient,
	HTTPClient,
	type EVMLog,
	encodeCallMsg,
	getNetwork,
	type HTTPSendRequester,
	hexToBase64,
	LAST_FINALIZED_BLOCK_NUMBER,
	median,
	Runner,
	type Runtime,
	TxStatus,
	ok,
} from '@chainlink/cre-sdk'
import { type Address, decodeFunctionResult, encodeFunctionData, zeroAddress } from 'viem'
import { z } from 'zod'
import { IERC20 } from '../contracts/abi'
import {
	encodeAbiParameters,
	parseAbiParameters,
  } from "viem";

const configSchema = z.object({
	schedule: z.string(),
	porUrl: z.string(),
	geminiModel: z.string(),
	evms: z.array(
		z.object({
			tokenAddress: z.string(),
			porAddress: z.string(),
			chainSelectorName: z.string(),
			gasLimit: z.string(),
		}),
	),
})

type Config = z.infer<typeof configSchema>

interface PORResponse {
	accountName: string
	totalTrust: number
	totalToken: number
	ripcord: boolean
	updatedAt: string
}

interface ReserveInfo {
	lastUpdated: Date
	totalReserve: number
}

interface RiskAnalysis {
	riskScore: bigint
}

interface GeminiApiResponse {
	candidates: {
	  content: {
		parts: { text: string }[];
	  };
	}[];
	responseId: string;
  }

// Utility function to safely stringify objects with bigints
const safeJsonStringify = (obj: any): string =>
	JSON.stringify(obj, (_, value) => (typeof value === 'bigint' ? value.toString() : value), 2)

// HTTP capability that fetches the reserve info from the POR API
const fetchReserveInfo = (sendRequester: HTTPSendRequester, config: Config): ReserveInfo => {
	const response = sendRequester.sendRequest({ method: 'GET', url: config.porUrl }).result()

	if (response.statusCode !== 200) {
		throw new Error(`HTTP request failed with status: ${response.statusCode}`)
	}

	const responseText = Buffer.from(response.body).toString('utf-8')
	const porResp: PORResponse = JSON.parse(responseText)

	if (porResp.ripcord) {
		throw new Error('ripcord is true')
	}

	return {
		lastUpdated: new Date(porResp.updatedAt),
		totalReserve: porResp.totalToken,
	}
}
// HTTP capability that fetches the reserve info from the POR API
const fetchRiskAnalysis = 
(geminiApiKey: string, totalReserveScaled: bigint, totalSupply: bigint) => 
	(sendRequester: HTTPSendRequester, config: Config): RiskAnalysis => {

	const systemPrompt = `You are a risk analyst. You will receive two numbers:
- TotalSupply: total token supply, scaled to 18 decimal places (raw integer).
- TotalReserveScaled: total reserved/collateral amount, scaled to 18 decimal places (raw integer).

Compute coverage as: coverage = TotalReserveScaled / TotalSupply (both are same scale, so this is the reserve-to-supply ratio).

Apply this risk scale exactly:
- If coverage >= 1.2: riskScore = 0
- Else: riskScore = min(100, round(((1.2 - coverage) / 1.2) * 100))

Respond with the risk score as structured JSON only, no other text or markdown.

Output format (valid JSON only):
{"riskScore": <integer>}`

	const userPrompt = `TotalSupply: ${totalSupply}
TotalReserveScaled: ${totalReserveScaled}

Compute coverage = TotalReserveScaled / TotalSupply, then apply the risk scale. Return JSON: {"riskScore": <integer>}`

    // Compose the structured instruction + content for deterministic JSON output
    // See https://ai.google.dev/gemini-api/docs/structured-output?example=recipe#rest_2
    const dataToSend = {
		system_instruction: { parts: [{ text: systemPrompt }] },
		contents: [
		  {
			parts: [
			  {
				text: userPrompt,
			  },
			],
		  },
		],
		generationConfig: {
			responseMimeType: "application/json",
			responseJsonSchema: {
				type: "object",
				properties: {
					riskScore: {
						type: "integer",
						description: "Risk score from 0 (lowest risk) to 100 (highest risk).",
						minimum: 0,
						maximum: 100,
					},
				},
				required: ["riskScore"],
			},
		},
	  };
  
	  // Encode request body as base64 (required by CRE HTTP capability)
	  const bodyBytes = new TextEncoder().encode(JSON.stringify(dataToSend));
	  const body = Buffer.from(bodyBytes).toString("base64");
  
	  const req = {
		url: `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent`,
		method: "POST" as const,
		body,
		headers: {
		  "Content-Type": "application/json",
		  "x-goog-api-key": geminiApiKey,
		},
		cacheSettings: {
		  store: true,
		  maxAge: "60s",
		},
	  };
  
	  // Perform the request within CRE infra; result() yields the response
	  const resp = sendRequester.sendRequest(req).result();
	  const bodyText = new TextDecoder().decode(resp.body);
  
	  if (!ok(resp)) throw new Error(`HTTP request failed with status: ${resp.statusCode}. Error :${bodyText}`);
  
	  // Parse and extract the model text
	  const externalResp = JSON.parse(bodyText) as GeminiApiResponse;
  
	  const text = externalResp?.candidates?.[0]?.content?.parts?.[0]?.text;
	  if (!text) throw new Error("Malformed LLM response: missing candidates[0].content.parts[0].text");

	  const parsed = JSON.parse(text.trim()) as RiskAnalysis;
	  
	  return { riskScore: parsed.riskScore };
}

const updateReserves = (
	runtime: Runtime<Config>,
	totalReserveScaled: bigint,
	totalSupply: bigint,
	riskScore: bigint,
): string => {
	const evmConfig = runtime.config.evms[0]
	const network = getNetwork({
		chainFamily: 'evm',
		chainSelectorName: evmConfig.chainSelectorName,
		isTestnet: true,
	})

	if (!network) {
		throw new Error(`Network not found for chain selector name: ${evmConfig.chainSelectorName}`)
	}

	const evmClient = new EVMClient(network.chainSelector.selector)

	runtime.log(
		`Updating reserves totalSupply ${totalSupply.toString()} totalReserveScaled ${totalReserveScaled.toString()}`,
	)

	  // Encode alert data as ABI parameters
	  const reportData = encodeAbiParameters(
		parseAbiParameters(
		  "uint256 totalMinted, uint256 totalReserve, uint256 riskScore"
		),
		[totalSupply, totalReserveScaled, riskScore]
	  );

	// Step 1: Generate report using consensus capability
	const reportResponse = runtime
		.report({
			encodedPayload: hexToBase64(reportData),
			encoderName: 'evm',
			signingAlgo: 'ecdsa',
			hashingAlgo: 'keccak256',
		})
		.result()

	const resp = evmClient
		.writeReport(runtime, {
			receiver: evmConfig.porAddress,
			report: reportResponse,
			gasConfig: {
				gasLimit: evmConfig.gasLimit,
			},
		})
		.result()

	const txStatus = resp.txStatus

	if (txStatus !== TxStatus.SUCCESS) {
		throw new Error(`Failed to write report: ${resp.errorMessage || txStatus}`)
	}

	const txHash = resp.txHash || new Uint8Array(32)

	runtime.log(`Write report transaction succeeded at txHash: ${bytesToHex(txHash)}`)

	return bytesToHex(txHash)
}

const getOffChainReserves = (runtime: Runtime<Config>): bigint => {
	runtime.log(`fetching por url ${runtime.config.porUrl}`)

	const httpCapability = new HTTPClient()
	const reserveInfo = httpCapability
		.sendRequest(
			runtime,
			fetchReserveInfo,
			ConsensusAggregationByFields<ReserveInfo>({
				lastUpdated: median,
				totalReserve: median,
			}),
		)(runtime.config)
		.result()

	runtime.log(`ReserveInfo ${safeJsonStringify(reserveInfo)}`)

	const totalReserveScaled = BigInt(reserveInfo.totalReserve * 1e18)
	runtime.log(`TotalReserveScaled ${totalReserveScaled.toString()}`)

	return totalReserveScaled;
}

const getOnChainSupply = (runtime: Runtime<Config>): bigint => {
	const evms = runtime.config.evms
	let totalSupply = 0n

	for (const evmConfig of evms) {
		const network = getNetwork({
			chainFamily: 'evm',
			chainSelectorName: evmConfig.chainSelectorName,
			isTestnet: true,
		})

		if (!network) {
			throw new Error(`Network not found for chain selector name: ${evmConfig.chainSelectorName}`)
		}

		const evmClient = new EVMClient(network.chainSelector.selector)

		// Encode the contract call data for totalSupply
		const callData = encodeFunctionData({
			abi: IERC20,
			functionName: 'totalSupply',
			args: [],
		})

		const contractCall = evmClient
			.callContract(runtime, {
				call: encodeCallMsg({
					from: zeroAddress,
					to: evmConfig.tokenAddress as Address,
					data: callData,
				})
			})
			.result()

		// Decode the result
		const supply = decodeFunctionResult({
			abi: IERC20,
			functionName: 'totalSupply',
			data: bytesToHex(contractCall.data),
		})

		totalSupply += supply
	}

	runtime.log(`TotalSupply ${totalSupply.toString()}`)
	return totalSupply
	

}

const getRiskScore = (runtime: Runtime<Config>, totalReserveScaled: bigint,totalSupply: bigint): bigint => {
	const httpCapability = new HTTPClient()
	const geminiApiKey = runtime.getSecret({ id: "GEMINI_API_KEY" }).result();

	const riskAnalysis = httpCapability
	.sendRequest(
		runtime,
		fetchRiskAnalysis(geminiApiKey.value, totalReserveScaled, totalSupply),
		ConsensusAggregationByFields<RiskAnalysis>({
			riskScore: median,
		}),
	)(runtime.config)
	.result()

	runtime.log(`RiskScore ${riskAnalysis.riskScore}`)
	
	return riskAnalysis.riskScore;
}


const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
	if (!payload.scheduledExecutionTime) {
		throw new Error('Scheduled execution time is required')
	}

	runtime.log('Running CronTrigger')

	const totalReserve = getOffChainReserves(runtime)
	const totalSupply = getOnChainSupply(runtime)
	const riskScore = getRiskScore(runtime, totalReserve, totalSupply)
	const txnHash = updateReserves(runtime, totalReserve,totalSupply, riskScore)

	runtime.log('Finished CronTrigger')

	return `${totalReserve} ${totalSupply} ${riskScore} ${txnHash}`
}

const initWorkflow = (config: Config) => {
	const cronTrigger = new CronCapability()

	return [
		handler(
			cronTrigger.trigger({
				schedule: config.schedule,
			}),
			onCronTrigger,
		)
	]
}

export async function main() {
	const runner = await Runner.newRunner<Config>({
		configSchema,
	})
	await runner.run(initWorkflow)
}
