import type { NetworkPublisherAdapter } from '../../../services/publisher/src/index.js';
import { FakeNetworkPublisherAdapter } from '../../../services/publisher/src/index.js';
import type { RuntimeConfig } from './runtime-config.js';

export interface PublisherCompositionOptions {
  youtube?: NetworkPublisherAdapter;
}

export function composePublisherAdapters(
  config: RuntimeConfig,
  options: PublisherCompositionOptions = {},
): NetworkPublisherAdapter[] {
  if (config.publisher.driver === 'fake') {
    return [new FakeNetworkPublisherAdapter({ network: 'youtube' })];
  }

  const youtube = options.youtube;
  if (!youtube || youtube.network !== 'youtube') {
    throw new Error('youtube publisher driver requires an explicit youtube adapter');
  }
  return [youtube];
}
