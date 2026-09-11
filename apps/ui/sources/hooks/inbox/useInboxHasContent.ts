import { useSharedInboxContentModel } from '@/components/inbox/useInboxContentModel';

// Hook to check if inbox has content to show
export function useInboxHasContent(): boolean {
    return useSharedInboxContentModel().hasContent;
}
