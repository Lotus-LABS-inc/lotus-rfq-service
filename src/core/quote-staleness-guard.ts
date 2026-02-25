export interface StalenessAwareQuote {
  expires_at: string;
  firm_until?: string;
  soft_refresh_flag: boolean;
}

export class QuoteStaleError extends Error {
  public constructor(public readonly reason: "QUOTE_EXPIRED" | "QUOTE_NOT_FIRM") {
    super(reason);
    this.name = "QuoteStaleError";
  }
}

export class QuoteStalenessGuard {
  public constructor(private readonly now: () => Date = () => new Date()) {}

  public isExpired(quote: StalenessAwareQuote): boolean {
    return new Date(quote.expires_at).getTime() <= this.now().getTime();
  }

  public isFirm(quote: StalenessAwareQuote): boolean {
    if (!quote.firm_until) {
      return true;
    }

    return new Date(quote.firm_until).getTime() > this.now().getTime();
  }

  public validateBeforeExecution(quote: StalenessAwareQuote): void {
    if (this.isExpired(quote)) {
      throw new QuoteStaleError("QUOTE_EXPIRED");
    }

    if (!this.isFirm(quote)) {
      throw new QuoteStaleError("QUOTE_NOT_FIRM");
    }
  }

  public filterValidQuotes<T extends StalenessAwareQuote>(quotes: readonly T[]): T[] {
    return quotes.filter((quote) => !this.isExpired(quote) && this.isFirm(quote));
  }
}
