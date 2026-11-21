import type { ConnectedServiceId } from '@happier-dev/protocol';

/**
 * Per-service copy keys for API-key connected services. The api-key prompt copy is NOT
 * token-kind-generic: key prefixes and vendor wording differ per service (e.g. Anthropic
 * `sk-ant-…` vs OpenCode Go `oc_sk-…`). Unmapped services fall back to the vendor-neutral
 * generic api-key copy.
 */
export type ConnectedServiceApiKeyCopyKeys = Readonly<{
    subtitleKey:
        | 'connectedServices.detail.apiKeySubtitleByService.openai'
        | 'connectedServices.detail.apiKeySubtitleByService.anthropic'
        | 'connectedServices.detail.apiKeySubtitleByService.opencodeGo'
        | 'connectedServices.detail.connectApiKeySubtitle';
    bodyKey:
        | 'connectedServices.detail.prompts.apiKeyByService.openai.body'
        | 'connectedServices.detail.prompts.apiKeyByService.anthropic.body'
        | 'connectedServices.detail.prompts.apiKeyByService.opencodeGo.body'
        | 'connectedServices.detail.prompts.apiKeyBody';
    placeholderKey:
        | 'connectedServices.detail.prompts.apiKeyByService.openai.placeholder'
        | 'connectedServices.detail.prompts.apiKeyByService.anthropic.placeholder'
        | 'connectedServices.detail.prompts.apiKeyByService.opencodeGo.placeholder'
        | 'connectedServices.detail.prompts.apiKeyPlaceholder';
}>;

const COPY_KEYS_BY_SERVICE: Partial<Record<ConnectedServiceId, ConnectedServiceApiKeyCopyKeys>> = {
    openai: {
        subtitleKey: 'connectedServices.detail.apiKeySubtitleByService.openai',
        bodyKey: 'connectedServices.detail.prompts.apiKeyByService.openai.body',
        placeholderKey: 'connectedServices.detail.prompts.apiKeyByService.openai.placeholder',
    },
    anthropic: {
        subtitleKey: 'connectedServices.detail.apiKeySubtitleByService.anthropic',
        bodyKey: 'connectedServices.detail.prompts.apiKeyByService.anthropic.body',
        placeholderKey: 'connectedServices.detail.prompts.apiKeyByService.anthropic.placeholder',
    },
    'opencode-go': {
        subtitleKey: 'connectedServices.detail.apiKeySubtitleByService.opencodeGo',
        bodyKey: 'connectedServices.detail.prompts.apiKeyByService.opencodeGo.body',
        placeholderKey: 'connectedServices.detail.prompts.apiKeyByService.opencodeGo.placeholder',
    },
};

const GENERIC_COPY_KEYS: ConnectedServiceApiKeyCopyKeys = {
    subtitleKey: 'connectedServices.detail.connectApiKeySubtitle',
    bodyKey: 'connectedServices.detail.prompts.apiKeyBody',
    placeholderKey: 'connectedServices.detail.prompts.apiKeyPlaceholder',
};

export function resolveConnectedServiceApiKeyCopyKeys(
    serviceId: ConnectedServiceId | null | undefined,
): ConnectedServiceApiKeyCopyKeys {
    return (serviceId ? COPY_KEYS_BY_SERVICE[serviceId] : undefined) ?? GENERIC_COPY_KEYS;
}
