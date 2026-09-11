import { createNoopProviderSettingsPlugin } from '@/agents/providers/shared/createNoopProviderSettingsPlugin';

export const DEVIN_PROVIDER_SETTINGS_PLUGIN = createNoopProviderSettingsPlugin({
    providerId: 'devin',
    title: { key: 'settingsProviders.plugins.devin.title' },
    icon: { ionName: 'hardware-chip-outline', color: '#111827' },
});
