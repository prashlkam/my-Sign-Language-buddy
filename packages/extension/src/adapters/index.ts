import type { PlatformAdapter } from '@slb/core';
import { MeetAdapter } from './meet';
import { ZoomWebAdapter } from './zoom-web';
import { GenericAdapter } from './generic';

export { MeetAdapter, ZoomWebAdapter, GenericAdapter };

/**
 * Pick an adapter for the current page. Falls back to the generic adapter,
 * which always works — an unrecognised page should still get captions.
 */
export function detectAdapter(host: string = location.hostname): PlatformAdapter {
  if (host.endsWith('meet.google.com')) return new MeetAdapter();
  if (host.endsWith('zoom.us')) return new ZoomWebAdapter();
  return new GenericAdapter();
}
