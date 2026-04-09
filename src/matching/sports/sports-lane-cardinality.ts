export const sportsLaneCardinalityValues = [
  "SINGLE",
  "PAIR",
  "TRI",
  "STRICT_ALL"
] as const;

export type SportsLaneCardinality = typeof sportsLaneCardinalityValues[number];

export const sportsLaneCardinalityPreferenceOrder = [
  "STRICT_ALL",
  "TRI",
  "PAIR",
  "SINGLE"
] as const satisfies readonly SportsLaneCardinality[];

export const toSportsCanonicalVenueSet = (venues: readonly string[]): string =>
  [...venues].sort((left, right) => left.localeCompare(right)).join("|");

export const buildSportsVenueCombinations = <TVenue extends string>(
  venues: readonly TVenue[],
  targetSize: number
): readonly (readonly TVenue[])[] => {
  if (targetSize <= 0 || targetSize > venues.length) {
    return [];
  }

  const combinations: TVenue[][] = [];
  const active: TVenue[] = [];

  const visit = (startIndex: number) => {
    if (active.length === targetSize) {
      combinations.push([...active]);
      return;
    }

    for (let index = startIndex; index < venues.length; index += 1) {
      active.push(venues[index]!);
      visit(index + 1);
      active.pop();
    }
  };

  visit(0);
  return combinations;
};

export const inferSportsLaneCardinalityFromVenueCount = (venueCount: number): SportsLaneCardinality => {
  if (venueCount <= 1) {
    return "SINGLE";
  }
  if (venueCount === 2) {
    return "PAIR";
  }
  if (venueCount === 3) {
    return "TRI";
  }
  return "STRICT_ALL";
};
