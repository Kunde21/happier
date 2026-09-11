import type { DecryptedArtifact } from '@/sync/domains/artifacts/artifactTypes';

/** The single 0.2 decision for whether an approval belongs in Inbox attention. */
export function isOpenApprovalInboxArtifact(artifact: DecryptedArtifact): boolean {
    return artifact.header?.kind === 'approval_request.v1'
        && artifact.header.approvalStatus === 'open';
}
