import * as React from 'react';
import { Platform, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { GlassPanel } from '@/components/ui/glass/GlassPanel';
import { layout } from '@/components/ui/layout/layout';
import { resolveTrustedWebSafeAreaBottomInset } from '@/utils/platform/webSafeAreaInset';
import { resolveFloatingTabBarBottomPadding } from './floatingTabBarBottomInset';

/**
 * Floating, rounded iOS-26-style chrome shell for the bottom tab bars.
 *
 * Centers a capsule that floats above the safe-area inset and fills it with the
 * shared `GlassPanel` (tiered Liquid Glass / blur / solid material + glass rim +
 * inner shadow + cast shadow). This component owns only the floating *position*:
 * the side gutters, top/bottom gaps, and content max-width. Bars pass their tab
 * row as `children` plus the bottom safe-area inset.
 */
// Tuned to match the iOS 26 Liquid Glass tab bar: a capsule that *sizes to its
// content* and floats centered (deliberate negative space on the sides) rather
// than spanning the full width. `FLOATING_SIDE_GUTTER` is the minimum breathing
// room so a wide bar never touches the screen edges; the bar shrink-wraps its
// tabs and only compresses if it would exceed that bound.
// Large radius → clamps to a full capsule at any bar height (matches the iOS 26 /
// Instagram fully-rounded floating bar).
const TAB_BAR_RADIUS = 999;
const FLOATING_SIDE_GUTTER = 16;
const FLOATING_TOP_GAP = 6;
// Capsule inner padding. Combined with the active-highlight inset (CockpitTabBar/
// TabBar `activePill`: left/right 4, top/bottom 3) this sets the gap from the
// capsule rim to a selected tab at the edge: H = 2 + 4 = 6, V = 1 + 3 = 4.
const PILL_PADDING_VERTICAL = 1;
const PILL_PADDING_HORIZONTAL = 2;

const styles = StyleSheet.create({
    positioner: {
        alignItems: 'center',
        paddingHorizontal: FLOATING_SIDE_GUTTER,
        paddingTop: FLOATING_TOP_GAP,
        backgroundColor: 'transparent',
    },
    pill: {
        paddingHorizontal: PILL_PADDING_HORIZONTAL,
        paddingVertical: PILL_PADDING_VERTICAL,
    },
});

export type FloatingTabBarSurfaceProps = Readonly<{
    children: React.ReactNode;
    bottomInset: number;
    /**
     * The bar sits on an opaque reserved band (in-flow cockpit chrome). The band
     * itself is painted by the chrome host so it can fade independently; this flag
     * only softens the cast shadow, which reads too strong over the opaque band.
     */
    opaqueBand?: boolean;
    testID?: string;
}>;

export const FloatingTabBarSurface = React.memo(function FloatingTabBarSurface(props: FloatingTabBarSurfaceProps) {
    // On web the bottom safe-area inset is only trustworthy on iOS browsers (see
    // webSafeAreaInset.ts): Firefox Android reports the on-screen nav bar as the bottom inset
    // even though the viewport never extends under it, which used to leave a dead band under
    // the floating capsule.
    const trustedBottomInset = Platform.OS === 'web'
        ? resolveTrustedWebSafeAreaBottomInset(props.bottomInset)
        : props.bottomInset;
    const bottomPadding = resolveFloatingTabBarBottomPadding(trustedBottomInset, Platform.OS === 'ios');

    return (
        <View
            pointerEvents="box-none"
            style={[styles.positioner, { paddingBottom: bottomPadding }]}
        >
            <GlassPanel
                testID={props.testID}
                radius={TAB_BAR_RADIUS}
                maxWidth={layout.maxWidth}
                softShadow={props.opaqueBand === true}
                style={styles.pill}
            >
                {props.children}
            </GlassPanel>
        </View>
    );
});
