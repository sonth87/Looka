export type SecurityLevel = 'HIGH_SECURITY' | 'BALANCED' | 'CONVENIENCE';

export interface ThresholdConfig {
  matchThreshold: number;
  ambiguityMargin: number;
}

export class ThresholdPolicy {
  public static getThreshold(level: SecurityLevel): ThresholdConfig {
    switch (level) {
      case 'HIGH_SECURITY':
        return { matchThreshold: 0.75, ambiguityMargin: 0.05 };
      case 'CONVENIENCE':
        return { matchThreshold: 0.55, ambiguityMargin: 0.05 };
      case 'BALANCED':
      default:
        return { matchThreshold: 0.65, ambiguityMargin: 0.05 };
    }
  }
}
