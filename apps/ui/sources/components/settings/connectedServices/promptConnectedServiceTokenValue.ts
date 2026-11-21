import { Modal } from '@/modal';
import { t } from '@/text';

import type { ConnectedServiceId } from '@happier-dev/protocol';

import { resolveConnectedServiceApiKeyCopyKeys } from './model/resolveConnectedServiceApiKeyCopyKeys';

export type ConnectedServiceTokenKind = 'setup-token' | 'access-token' | 'api-key' | null;

export async function promptConnectedServiceTokenValue(
  tokenKind: ConnectedServiceTokenKind,
  serviceId?: ConnectedServiceId | null,
): Promise<string | null> {
  const apiKeyCopy = resolveConnectedServiceApiKeyCopyKeys(serviceId);
  const token = await Modal.prompt(
    tokenKind === 'setup-token'
      ? t('connectedServices.detail.prompts.setupTokenTitle')
      : tokenKind === 'access-token'
        ? t('connectedServices.detail.prompts.accessTokenTitle')
        : t('connectedServices.detail.prompts.apiKeyTitle'),
    tokenKind === 'setup-token'
      ? t('connectedServices.detail.prompts.setupTokenBody')
      : tokenKind === 'access-token'
        ? t('connectedServices.detail.prompts.accessTokenBody')
        : t(apiKeyCopy.bodyKey),
    {
      placeholder: tokenKind === 'setup-token'
        ? t('connectedServices.detail.prompts.setupTokenPlaceholder')
        : tokenKind === 'access-token'
          ? t('connectedServices.detail.prompts.accessTokenPlaceholder')
          : t(apiKeyCopy.placeholderKey),
      confirmText: t('common.save'),
      cancelText: t('common.cancel'),
    },
  );
  const value = typeof token === 'string' ? token.trim() : '';
  return value || null;
}
