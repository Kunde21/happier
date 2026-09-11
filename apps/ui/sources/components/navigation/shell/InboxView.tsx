import * as React from 'react';
import { ScrollView, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Header } from '@/components/navigation/Header';
import { InboxContent } from '@/components/inbox/InboxContent';
import {
    useSharedInboxContentModel,
    type InboxContentModel,
} from '@/components/inbox/useInboxContentModel';
import { useLayoutMaxWidth } from '@/components/ui/layout/layout';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.background.canvas,
    },
    headerTitle: {
        fontSize: 17,
        color: theme.colors.chrome.header.foreground,
        ...Typography.default('semiBold'),
    },
    scrollContent: {
        flexGrow: 1,
        width: '100%',
        alignSelf: 'center',
    },
}));

function InboxHeaderTitle() {
    return <Text style={styles.headerTitle}>{t('tabs.inbox')}</Text>;
}

const InboxViewContent = React.memo(function InboxViewContent(props: Readonly<{ model: InboxContentModel }>) {
    const model = props.model;
    const contentMaxWidth = useLayoutMaxWidth();
    const scrollContentStyle = React.useMemo(
        () => [styles.scrollContent, { maxWidth: contentMaxWidth }],
        [contentMaxWidth],
    );
    return (
        <View style={styles.container}>
            <Header
                title={<InboxHeaderTitle />}
                headerLeft={() => null}
                headerRight={() => null}
                headerShadowVisible={false}
                headerTransparent
            />
            <ScrollView contentContainerStyle={scrollContentStyle}>
                <InboxContent model={model} presentation="screen" />
            </ScrollView>
        </View>
    );
});

export const InboxView = React.memo(function InboxView() {
    const model = useSharedInboxContentModel();
    return <InboxViewContent model={model} />;
});
