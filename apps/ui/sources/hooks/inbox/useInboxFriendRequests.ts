import * as React from 'react';

import { useFriendsEnabled } from '@/hooks/server/useFriendsEnabled';
import { useFriendsIdentityReadiness } from '@/hooks/server/useFriendsIdentityReadiness';
import { useFriendRequests } from '@/sync/domains/state/storage';

type InboxFriendRequests = Readonly<{
    /** Whether the Inbox screen renders the friends section at all. */
    visible: boolean;
    requests: ReturnType<typeof useFriendRequests>;
}>;

const NO_FRIEND_REQUESTS: ReturnType<typeof useFriendRequests> = [];

/** One admission decision shared by the Inbox screen and navigation badge. */
export function useInboxFriendRequests(): InboxFriendRequests {
    const friendsEnabled = useFriendsEnabled();
    const identityReadiness = useFriendsIdentityReadiness();
    const requests = useFriendRequests();
    const visible = friendsEnabled && identityReadiness.isReady;

    return React.useMemo(
        () => ({ visible, requests: visible ? requests : NO_FRIEND_REQUESTS }),
        [requests, visible],
    );
}
