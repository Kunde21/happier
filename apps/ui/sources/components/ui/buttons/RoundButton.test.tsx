import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock(
        {
                    Platform: {
                        OS: 'web',
                    },
                    View: 'View',
                    Text: 'Text',
                    ActivityIndicator: 'ActivityIndicator',
                    Pressable: ({ children, ...props }: any) => React.createElement('Pressable', props, children),
                }
    );
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@/components/ui/text/Text', () => ({ Text: (props: React.Attributes & Record<string, unknown>) => React.createElement('Text', props) }));

describe('RoundButton', () => {
    it('forwards the press event to modifier-aware actions', async () => {
        const { RoundButton } = await import('./RoundButton');
        const onPress = vi.fn();
        const event = { nativeEvent: { metaKey: true } };
        const screen = await renderScreen(<RoundButton title="New session" testID="round-button" onPress={onPress} />);

        screen.findByTestId('round-button')?.props.onPress(event);

        expect(onPress).toHaveBeenCalledWith(event);
    });

    it('forwards testID to the Pressable', async () => {
        const { RoundButton } = await import('./RoundButton');
        const screen = await renderScreen(<RoundButton title="Hello" testID="round-button" />);
        const pressable = screen.findByTestId('round-button');
        if (!pressable) {
            throw new Error('Expected round button pressable to render');
        }
        expect(pressable.props.testID).toBe('round-button');
        expect(pressable.findByType('LinearGradient' as never).props.colors).toEqual(['#000000', '#020202']);
    });

    it('applies a reduced effective opacity when disabled', async () => {
        const { RoundButton } = await import('./RoundButton');
        const screen = await renderScreen(<RoundButton title="Disabled" disabled={true} testID="disabled-round-button" />);
        const pressable = screen.findByTestId('disabled-round-button');
        if (!pressable) {
            throw new Error('Expected disabled round button pressable to render');
        }
        const styleOutput = pressable.props.style({ pressed: false });
        const flattened = Array.isArray(styleOutput)
            ? styleOutput.reduce((acc: Record<string, unknown>, next: Record<string, unknown> | null | undefined) => ({ ...acc, ...(next ?? {}) }), {})
            : (styleOutput ?? {});
        expect(flattened.opacity).toBe(0.35);
    });

    it('uses a scoped default size while preserving the global large default', async () => {
        const { RoundButton, RoundButtonSizeScope } = await import('./RoundButton');
        const screen = await renderScreen(<>
            <RoundButton title="Global" testID="global-button" />
            <RoundButtonSizeScope size="normal">
                <RoundButton title="Footer" testID="footer-button" />
                <RoundButton title="Explicit" size="small" testID="explicit-button" />
            </RoundButtonSizeScope>
        </>);

        const flatten = (style: unknown): Record<string, unknown> => Array.isArray(style)
            ? style.reduce((result, entry) => ({ ...result, ...flatten(entry) }), {})
            : ((style as Record<string, unknown> | null | undefined) ?? {});
        const fontSizeFor = (testID: string) => flatten(
            screen.findByTestId(testID)?.findByType('Text').props.style,
        ).fontSize;
        expect(fontSizeFor('global-button')).toBe(21);
        expect(fontSizeFor('footer-button')).toBe(16);
        expect(fontSizeFor('explicit-button')).toBe(14);
    });
});
