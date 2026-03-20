import type { Logger } from "pino"
import { z } from "zod"

export interface MyriadCliValidationConfig {
  execFileImpl?: (
    file: string,
    args: readonly string[],
    options?: { cwd?: string }
  ) => Promise<{ stdout: string; stderr: string }>;
  logger?: Pick<Logger, "info" | "warn" | "error">;
  cwd?: string;
}

export interface MyriadCliMarketsListInput {
  state?: "open" | "closed" | "resolved";
  order?: "volume" | "volume_24h" | "liquidity" | "expires_at" | "published_at" | "featured";
  sort?: "asc" | "desc";
  limit?: number;
  keyword?: string;
}

const cliMarketSchema = z.record(z.string(), z.unknown())
const cliResponseSchema = z.array(cliMarketSchema)

const defaultExecFileImpl: NonNullable<MyriadCliValidationConfig["execFileImpl"]> = async (file, args, options) => {
  const childProcess = await import("node:child_process")
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    childProcess.execFile(file, args, { cwd: options?.cwd }, (error, stdout, stderr) => {
      if (error) {
        reject(error)
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

export class MyriadCliValidationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = "MyriadCliValidationError"
  }
}

export class MyriadCliValidation {
  private readonly execFileImpl: NonNullable<MyriadCliValidationConfig["execFileImpl"]>

  public constructor(private readonly config: MyriadCliValidationConfig = {}) {
    this.execFileImpl = config.execFileImpl ?? defaultExecFileImpl
  }

  public async listMarkets(input: MyriadCliMarketsListInput = {}): Promise<readonly Record<string, unknown>[]> {
    const args = ["markets", "list"]
    if (input.state) {
      args.push("--state", input.state)
    }
    if (input.order) {
      args.push("--order", input.order)
    }
    if (input.sort) {
      args.push("--sort", input.sort)
    }
    if (input.limit !== undefined) {
      args.push("--limit", String(input.limit))
    }
    if (input.keyword) {
      args.push("--keyword", input.keyword)
    }
    args.push("--json")

    this.config.logger?.info({ args }, "Running safe Myriad CLI validation command.")
    const { stdout } = await this.execFileImpl(
      "myriad",
      args,
      this.config.cwd ? { cwd: this.config.cwd } : undefined
    )

    let payload: unknown
    try {
      payload = JSON.parse(stdout)
    } catch (error) {
      throw new MyriadCliValidationError(`Myriad CLI returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }

    const parsed = cliResponseSchema.safeParse(payload)
    if (!parsed.success) {
      throw new MyriadCliValidationError("Myriad CLI returned malformed market discovery payload.")
    }

    return parsed.data
  }
}
