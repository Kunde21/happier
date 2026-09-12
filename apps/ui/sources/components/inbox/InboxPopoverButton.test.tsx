import * as React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import type { InboxContentModel } from './useInboxContentModel';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

const capture = vi.hoisted(() => ({
    popoverProps: null as Record<string, unknown> | null,
    contentProps: null as Record<string, unknown> | null,
}));

vi.mock('@/components/ui/popover', () => ({
    Popover: (props: Record<string, unknown> & {
        children: (layout: { maxHeight: number; maxWidth: number }) => React.ReactNode;
    }) => {
        capture.popoverProps = props;
        return React.createElement('Popover', props, props.children({ maxHeight: 600, maxWidth: 500 }));
    },
}));

vi.mock('@/components/ui/overlays/FloatingOverlay', () => ({
    FloatingOverlay: (props: Record<string, unknown>) => (
        React.createElement('FloatingOverlay', props, props.children as React.ReactNode)
    ),
}));

vi.mock('./InboxContent', () => ({
    InboxContent: (props: Record<string, unknown>) => {
        capture.contentProps = props;
        return React.createElement('InboxContent', props);
    },
}));

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});

describe('InboxPopoverButton', () => {
    it('opens the shared Inbox content and dismisses before opening the full Inbox', async () => {
        const openInbox = vi.fn();
        const model = {
            hasContent: true,
            openInbox,
        } as never;
        const { InboxPopoverButton } = await import('./InboxPopoverButton');
        const screen = await renderScreen(
            <InboxPopoverButton
                model={model}
                buttonSize={32}
                iconSize={18}
                testID="test-inbox-trigger"
            />,
        );

        expect(screen.findByTestId('test-inbox-trigger')?.props.accessibilityState).toEqual({ expanded: false });
        await act(async () => {
            await screen.findByTestId('test-inbox-trigger')?.props.onPress({
                currentTarget: {
                    getBoundingClientRect: () => ({ left: 100, top: 40, width: 32, height: 32 }),
                },
            });
        });

        expect(screen.findByTestId('test-inbox-trigger')?.props.accessibilityState).toEqual({ expanded: true });
        expect(capture.popoverProps).toMatchObject({
            open: true,
            placement: 'bottom',
            boundaryRef: null,
            maxWidthCap: 420,
            maxHeightCap: 560,
        });
        expect(capture.contentProps).toMatchObject({ model, presentation: 'popover' });
        expect(capture.contentProps?.onBeforeNavigate).toEqual(expect.any(Function));
        expect(screen.getTextContent()).not.toContain('tabs.inbox');

        await screen.pressByTestIdAsync('inbox.open_full');

        expect(openInbox).toHaveBeenCalledTimes(1);
        expect(screen.findAllByType('Popover' as never)).toHaveLength(0);
        expect(screen.findByTestId('test-inbox-trigger')?.props.accessibilityState).toEqual({ expanded: false });
    });

    it('lets Inbox item navigation dismiss the popover without changing the model owner', async () => {
        const model = { hasContent: false, openInbox: vi.fn() } as unknown as InboxContentModel;
        const { InboxPopoverButton } = await import('./InboxPopoverButton');
        const screen = await renderScreen(
            <InboxPopoverButton
                model={model}
                buttonSize={32}
                iconSize={18}
            />,
        );

        await screen.pressByTestIdAsync('sidebar-inbox-button');
        expect(capture.contentProps?.model).toBe(model);

        await act(async () => {
            (capture.contentProps?.onBeforeNavigate as (() => void) | undefined)?.();
        });
        expect(screen.findAllByType('Popover' as never)).toHaveLength(0);
        expect(model.openInbox).not.toHaveBeenCalled();
    });
});
