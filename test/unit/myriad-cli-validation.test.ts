import { describe, expect, it, vi } from "vitest"

import { MyriadCliValidation, MyriadCliValidationError } from "../../src/integrations/myriad/myriad-cli-validation.js"

describe("MyriadCliValidation", () => {
  it("runs safe read-only markets list commands with json output", async () => {
    const execFileImpl = vi.fn(async () => ({
      stdout: JSON.stringify([{ id: 1, slug: "market-1" }]),
      stderr: ""
    }))

    const validation = new MyriadCliValidation({ execFileImpl })
    const result = await validation.listMarkets({ state: "open", order: "volume", sort: "desc", limit: 5, keyword: "election" })

    expect(execFileImpl).toHaveBeenCalledWith(
      "myriad",
      ["markets", "list", "--state", "open", "--order", "volume", "--sort", "desc", "--limit", "5", "--keyword", "election", "--json"],
      undefined
    )
    expect(result).toEqual([{ id: 1, slug: "market-1" }])
  })

  it("fails closed on malformed cli json", async () => {
    const validation = new MyriadCliValidation({
      execFileImpl: vi.fn(async () => ({ stdout: "{bad json", stderr: "" }))
    })

    await expect(validation.listMarkets()).rejects.toBeInstanceOf(MyriadCliValidationError)
  })
})
