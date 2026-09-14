export type DistributionValidationIssue = {
  field: string;
  code: string;
  message: string;
};

export type DistributionValidationResult = {
  valid: boolean;
  issues: DistributionValidationIssue[];
};

export type DistributionSubmissionResult = {
  providerReference: string;
  status: string;
};

export type DistributionSubmissionStatus = {
  providerReference: string;
  status: string;
  platforms?: Array<{
    platformCode: string;
    status: string;
    externalPlatformId?: string | null;
    externalUrl?: string | null;
  }>;
};

/**
 * Future Phase-2 distributor seam only.
 *
 * Phase 09 intentionally ships no implementation, credentials, HTTP client,
 * provider SDK, scheduler or worker that invokes this interface.
 */
export interface DistributorProvider {
  validateRelease(releaseId: string): Promise<DistributionValidationResult>;
  submitRelease(
    releaseId: string,
    idempotencyKey: string
  ): Promise<DistributionSubmissionResult>;
  getSubmissionStatus(providerReference: string): Promise<DistributionSubmissionStatus>;
  updateRelease(
    providerReference: string,
    releaseId: string
  ): Promise<DistributionSubmissionResult>;
  requestTakedown(
    providerReference: string,
    reason?: string
  ): Promise<DistributionSubmissionResult>;
}
